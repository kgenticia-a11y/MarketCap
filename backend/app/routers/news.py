import logging
import re
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from app.services import market_data

router = APIRouter(prefix="/news", tags=["news"])
logger = logging.getLogger(__name__)

_TICKER_RE = re.compile(r"^[A-Z0-9.\-]{1,10}$")


@router.get("")
async def get_news(
    ticker: Optional[str] = Query(None, max_length=10),
    limit: int = Query(10, ge=1, le=50),
):
    if ticker is not None:
        t = ticker.upper().strip()
        if not _TICKER_RE.match(t):
            raise HTTPException(400, "Invalid ticker symbol.")
        ticker = t
    try:
        return await market_data.get_news(ticker, limit)
    except Exception:
        logger.exception("get_news failed for ticker=%s", ticker)
        raise HTTPException(502, "News unavailable.")
