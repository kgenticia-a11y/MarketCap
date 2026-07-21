"""Investment memos + thesis tracking.

The memo endpoints live under /memos; the two scenario-by-id endpoints live
under /dcf (a scenario id is globally unique, so the memo id is redundant in
the path). Ownership is enforced on every route by filtering on
user_id = current user — a memo belonging to someone else is indistinguishable
from a missing one (404), never a 403 that would leak existence.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app import models, schemas, auth
from app.config import settings
from app.database import get_db
from app.services import market_data

logger = logging.getLogger(__name__)

router = APIRouter(tags=["memos"])


def _get_memo(memo_id: int, user: models.User, db: Session) -> models.InvestmentMemo:
    memo = (
        db.query(models.InvestmentMemo)
        .filter_by(id=memo_id, user_id=user.id)
        .first()
    )
    if not memo:
        raise HTTPException(404, "Memo not found")
    return memo


async def _current_price(ticker: str) -> float:
    """Fetch the live quote for a ticker; 502 if market data is unavailable."""
    try:
        quote = await market_data.get_quote(ticker)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception:
        logger.exception("quote failed for %s", ticker)
        raise HTTPException(502, "Market data unavailable.")
    price = quote.get("price")
    if price is None or price <= 0:
        raise HTTPException(502, "Market data unavailable.")
    return float(price)


# ── Memo CRUD ────────────────────────────────────────────────────────────


@router.get("/memos/performance", response_model=list[schemas.MemoPerformanceRow])
async def memo_performance(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Aggregate view of every published memo for the current user.

    Fans out one quote per unique ticker (deduped), then folds current price,
    days-since-memo, checkpoint count, and a price trail (memo → each
    checkpoint → current) into a single row per memo.
    """
    memos = (
        db.query(models.InvestmentMemo)
        .filter(models.InvestmentMemo.user_id == current_user.id)
        .filter(models.InvestmentMemo.status == "published")
        .filter(models.InvestmentMemo.published_at.isnot(None))
        .filter(models.InvestmentMemo.price_at_memo.isnot(None))
        .order_by(models.InvestmentMemo.published_at.desc())
        .all()
    )
    if not memos:
        return []

    tickers = sorted({m.ticker for m in memos})
    prices: dict[str, float] = {}
    for ticker in tickers:
        try:
            quote = await market_data.get_quote(ticker)
        except Exception:
            logger.warning("performance: quote failed for %s", ticker)
            continue
        p = quote.get("price")
        if p and p > 0:
            prices[ticker] = float(p)

    checkpoints_by_memo: dict[int, list[models.ThesisCheckpoint]] = {}
    if memos:
        rows = (
            db.query(models.ThesisCheckpoint)
            .filter(models.ThesisCheckpoint.memo_id.in_([m.id for m in memos]))
            .order_by(models.ThesisCheckpoint.checked_at)
            .all()
        )
        for r in rows:
            checkpoints_by_memo.setdefault(r.memo_id, []).append(r)

    now = datetime.now(timezone.utc)
    out: list[schemas.MemoPerformanceRow] = []
    for memo in memos:
        published_at = memo.published_at
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        current_price = prices.get(memo.ticker)
        pct = None
        if current_price is not None and memo.price_at_memo:
            pct = round((current_price - memo.price_at_memo) / memo.price_at_memo * 100, 2)

        memo_checkpoints = checkpoints_by_memo.get(memo.id, [])
        last_ck = memo_checkpoints[-1] if memo_checkpoints else None
        last_ck_at = None
        days_since_reflection = None
        if last_ck:
            last_ck_at = last_ck.checked_at
            if last_ck_at.tzinfo is None:
                last_ck_at = last_ck_at.replace(tzinfo=timezone.utc)
            days_since_reflection = max(0, (now - last_ck_at).days)
        elif published_at:
            days_since_reflection = max(0, (now - published_at).days)

        series = [memo.price_at_memo] + [c.price_at_check for c in memo_checkpoints]
        if current_price is not None:
            series.append(current_price)

        out.append(schemas.MemoPerformanceRow(
            memo_id=memo.id,
            ticker=memo.ticker,
            recommendation=memo.recommendation,
            published_at=published_at,
            price_at_memo=memo.price_at_memo,
            price_target=memo.price_target,
            current_price=current_price,
            pct_change=pct,
            days_since_memo=max(0, (now - published_at).days),
            checkpoints_count=len(memo_checkpoints),
            last_checkpoint_at=last_ck_at,
            days_since_last_reflection=days_since_reflection,
            price_series=series,
        ))

    # Sort worst-first so painful memos surface — that's where the learning is.
    out.sort(key=lambda r: (r.pct_change if r.pct_change is not None else 0))
    return out


@router.post("/memos", response_model=schemas.MemoOut, status_code=201)
def create_memo(
    body: schemas.MemoCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    memo = models.InvestmentMemo(user_id=current_user.id, ticker=body.ticker.upper())
    db.add(memo)
    db.commit()
    db.refresh(memo)
    return memo


@router.get("/memos", response_model=list[schemas.MemoOut])
def list_memos(
    status: Optional[schemas.MemoStatus] = Query(None),
    ticker: Optional[str] = Query(None, min_length=1, max_length=10,
                                  pattern=r"^[A-Za-z0-9.\-]+$"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    q = db.query(models.InvestmentMemo).filter_by(user_id=current_user.id)
    if status:
        q = q.filter(models.InvestmentMemo.status == status)
    else:
        # Archived memos are soft-deleted — hidden unless explicitly requested.
        q = q.filter(models.InvestmentMemo.status != "archived")
    if ticker:
        q = q.filter(models.InvestmentMemo.ticker == ticker.upper())
    return q.order_by(models.InvestmentMemo.updated_at.desc()).all()


@router.get("/memos/{memo_id}", response_model=schemas.MemoDetailOut)
def get_memo(
    memo_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    memo = (
        db.query(models.InvestmentMemo)
        .options(
            joinedload(models.InvestmentMemo.moat),
            joinedload(models.InvestmentMemo.comps),
            joinedload(models.InvestmentMemo.scenarios),
        )
        .filter_by(id=memo_id, user_id=current_user.id)
        .first()
    )
    if not memo:
        raise HTTPException(404, "Memo not found")
    return memo


@router.patch("/memos/{memo_id}", response_model=schemas.MemoOut)
def update_memo(
    memo_id: int,
    body: schemas.MemoUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    memo = _get_memo(memo_id, current_user, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(memo, field, value)
    db.commit()
    db.refresh(memo)
    return memo


@router.post("/memos/{memo_id}/publish", response_model=schemas.MemoOut)
async def publish_memo(
    memo_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    memo = _get_memo(memo_id, current_user, db)
    if memo.status == "published":
        return memo  # idempotent — republishing never moves the snapshot
    if memo.status == "archived":
        raise HTTPException(400, "Memo is archived. Restore it before publishing.")

    missing = [
        name for name, value in (
            ("thesis_summary", memo.thesis_summary),
            ("recommendation", memo.recommendation),
            ("price_target",   memo.price_target),
        ) if not value
    ]
    if missing:
        raise HTTPException(400, f"Cannot publish: missing {', '.join(missing)}")

    price = await _current_price(memo.ticker)
    memo.status = "published"
    # First publish stamps the permanent reference point for thesis tracking.
    if memo.published_at is None:
        memo.published_at = datetime.now(timezone.utc)
        memo.price_at_memo = price
    db.commit()
    db.refresh(memo)
    return memo


@router.delete("/memos/{memo_id}", status_code=204)
def archive_memo(
    memo_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    """Soft delete — the memo (and its history) stays in the database."""
    memo = _get_memo(memo_id, current_user, db)
    memo.status = "archived"
    db.commit()


# ── Moat scorecard / comps (1:1 upserts) ─────────────────────────────────


@router.put("/memos/{memo_id}/moat", response_model=schemas.MoatScorecardOut)
def upsert_moat(
    memo_id: int,
    body: schemas.MoatScorecardUpsert,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    memo = _get_memo(memo_id, current_user, db)
    row = db.query(models.MoatScorecard).filter_by(memo_id=memo.id).first()
    if not row:
        row = models.MoatScorecard(memo_id=memo.id)
        db.add(row)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    try:
        db.commit()
    except IntegrityError:
        # Concurrent PUTs raced on the unique memo_id — retry as an update.
        db.rollback()
        row = db.query(models.MoatScorecard).filter_by(memo_id=memo.id).first()
        if not row:
            raise HTTPException(500, "Failed to save scorecard")
        for field, value in body.model_dump().items():
            setattr(row, field, value)
        db.commit()
    db.refresh(row)
    return row


@router.put("/memos/{memo_id}/comps", response_model=schemas.CompsAnalysisOut)
def upsert_comps(
    memo_id: int,
    body: schemas.CompsAnalysisUpsert,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    memo = _get_memo(memo_id, current_user, db)
    row = db.query(models.CompsAnalysis).filter_by(memo_id=memo.id).first()
    if not row:
        row = models.CompsAnalysis(memo_id=memo.id)
        db.add(row)
    row.peer_tickers = body.peer_tickers
    row.notes = body.notes
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        row = db.query(models.CompsAnalysis).filter_by(memo_id=memo.id).first()
        if not row:
            raise HTTPException(500, "Failed to save comps")
        row.peer_tickers = body.peer_tickers
        row.notes = body.notes
        db.commit()
    db.refresh(row)
    return row


# ── DCF scenarios ────────────────────────────────────────────────────────


@router.post("/memos/{memo_id}/dcf", response_model=schemas.DcfScenarioOut, status_code=201)
def add_dcf_scenario(
    memo_id: int,
    body: schemas.DcfScenarioCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    memo = _get_memo(memo_id, current_user, db)
    count = db.query(models.DcfScenario).filter_by(memo_id=memo.id).count()
    if count >= 10:
        raise HTTPException(400, "A memo can hold at most 10 DCF scenarios.")
    scenario = models.DcfScenario(memo_id=memo.id, **body.model_dump())
    db.add(scenario)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"A scenario named {body.scenario_name!r} already exists on this memo.")
    db.refresh(scenario)
    return scenario


def _get_scenario(scenario_id: int, user: models.User, db: Session) -> models.DcfScenario:
    scenario = (
        db.query(models.DcfScenario)
        .join(models.InvestmentMemo)
        .filter(models.DcfScenario.id == scenario_id,
                models.InvestmentMemo.user_id == user.id)
        .first()
    )
    if not scenario:
        raise HTTPException(404, "Scenario not found")
    return scenario


@router.patch("/dcf/{scenario_id}", response_model=schemas.DcfScenarioOut)
def update_dcf_scenario(
    scenario_id: int,
    body: schemas.DcfScenarioUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    scenario = _get_scenario(scenario_id, current_user, db)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(scenario, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "A scenario with that name already exists on this memo.")
    db.refresh(scenario)
    return scenario


@router.delete("/dcf/{scenario_id}", status_code=204)
def delete_dcf_scenario(
    scenario_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    scenario = _get_scenario(scenario_id, current_user, db)
    db.delete(scenario)
    db.commit()


# ── Thesis checkpoints ───────────────────────────────────────────────────


@router.post("/memos/{memo_id}/checkpoints", response_model=schemas.ThesisCheckpointOut, status_code=201)
async def create_checkpoint(
    memo_id: int,
    body: schemas.ThesisCheckpointCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    memo = _get_memo(memo_id, current_user, db)
    if memo.status != "published" or not memo.price_at_memo or not memo.published_at:
        raise HTTPException(400, "Checkpoints can only be added to published memos.")

    price = await _current_price(memo.ticker)
    published_at = memo.published_at
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    days = max(0, (datetime.now(timezone.utc) - published_at).days)

    checkpoint = models.ThesisCheckpoint(
        memo_id=memo.id,
        price_at_check=price,
        pct_change_since_memo=round((price - memo.price_at_memo) / memo.price_at_memo * 100, 2),
        days_since_memo=days,
        notes=body.notes,
    )
    db.add(checkpoint)
    db.commit()
    db.refresh(checkpoint)
    return checkpoint


@router.get("/memos/{memo_id}/checkpoints", response_model=list[schemas.ThesisCheckpointOut])
def list_checkpoints(
    memo_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    memo = _get_memo(memo_id, current_user, db)
    return (
        db.query(models.ThesisCheckpoint)
        .filter_by(memo_id=memo.id)
        .order_by(models.ThesisCheckpoint.checked_at)
        .all()
    )


# ── Internal cron: weekly auto-checkpoint on every published memo ────────


@router.post("/internal/auto-checkpoint")
async def auto_checkpoint(
    x_checkpoint_secret: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """Called by Supabase pg_cron once a week. Fans out one quote per
    unique ticker (not per memo) to keep Yahoo happy, then inserts a
    checkpoint on every published memo for that ticker.
    """
    if not settings.checkpoint_cron_secret:
        raise HTTPException(503, "Auto-checkpoint disabled — CHECKPOINT_CRON_SECRET not configured.")
    if x_checkpoint_secret != settings.checkpoint_cron_secret:
        raise HTTPException(401, "Bad checkpoint secret.")

    memos = (
        db.query(models.InvestmentMemo)
        .filter(models.InvestmentMemo.status == "published")
        .filter(models.InvestmentMemo.published_at.isnot(None))
        .filter(models.InvestmentMemo.price_at_memo.isnot(None))
        .all()
    )
    tickers = sorted({m.ticker for m in memos})

    prices: dict[str, float] = {}
    for ticker in tickers:
        try:
            quote = await market_data.get_quote(ticker)
        except Exception:
            logger.warning("auto-checkpoint: quote failed for %s", ticker)
            continue
        price = quote.get("price")
        if price and price > 0:
            prices[ticker] = float(price)

    now = datetime.now(timezone.utc)
    created = 0
    skipped = 0
    for memo in memos:
        price = prices.get(memo.ticker)
        if not price:
            skipped += 1
            continue
        published_at = memo.published_at
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        db.add(models.ThesisCheckpoint(
            memo_id=memo.id,
            price_at_check=price,
            pct_change_since_memo=round((price - memo.price_at_memo) / memo.price_at_memo * 100, 2),
            days_since_memo=max(0, (now - published_at).days),
            notes="[auto]",
        ))
        created += 1
    db.commit()
    return {"tickers_priced": len(prices), "checkpoints_created": created, "skipped": skipped}
