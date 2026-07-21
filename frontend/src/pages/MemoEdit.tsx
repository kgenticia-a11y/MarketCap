import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  getMemo, updateMemo, upsertMoat, publishMemo,
  type MemoPatch, type MemoRecommendation, type MoatUpsert,
} from "../api/memos";
import { getFundamentals } from "../api/stocks";
import { StatusBadge } from "../components/MemoBadges";
import {
  MOAT_DIMENSIONS, THESIS_SOFT_LIMIT, canPublish, fmtBig, fmtPct as fmtPctBase,
  sectionFill, type MemoFormState,
} from "../utils/memo";
import { ArrowLeft, Check, ChevronDown, Info, Rocket } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";

const EMPTY_MOAT: MoatUpsert = {
  pricing_power: null, switching_costs: null, network_effects: null,
  scale_advantages: null, brand_moat: null, notes: null,
};

const AUTOSAVE_DEBOUNCE_MS = 2_000;

/* ── Collapsible section shell ───────────────────────────────────────── */
function Section({ index, title, subtitle, filled, open, onToggle, children }: {
  index: number;
  title: string;
  subtitle?: string;
  filled: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-surface-hover transition-colors"
      >
        <span className={clsx(
          "w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold shrink-0",
          filled ? "bg-positive/15 text-positive" : "bg-surface-hover text-muted"
        )}>
          {filled ? <Check size={13} /> : index}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-white">{title}</span>
          {subtitle && <span className="block text-xs text-muted mt-0.5">{subtitle}</span>}
        </span>
        <ChevronDown size={16} className={clsx("text-muted transition-transform shrink-0", open && "rotate-180")} />
      </button>
      {open && <div className="px-5 pb-5 pt-1">{children}</div>}
    </div>
  );
}

/* ── Read-only financial snapshot (section 4 sidebar) ────────────────── */
function FinancialSnapshot({ ticker }: { ticker: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["fundamentals", ticker],
    queryFn: () => getFundamentals(ticker),
    staleTime: 30 * 60_000,
  });

  const ratio = (v: number | null | undefined, suffix = "") =>
    v != null ? `${v.toFixed(2)}${suffix}` : "—";
  const pct = (v: number | null | undefined) => (v != null ? fmtPctBase(v, false) : "—");

  const rows: Array<[string, string]> = data ? [
    ["Market cap",       fmtBig(data.market_cap)],
    ["P/E (trailing)",   ratio(data.pe)],
    ["Revenue growth",   pct(data.revenue_growth_pct)],
    ["Gross margin",     pct(data.gross_margin_pct)],
    ["Operating margin", pct(data.operating_margin_pct)],
    ["Profit margin",    pct(data.profit_margin_pct)],
    ["Debt / equity",    ratio(data.debt_to_equity, "×")],
    ["Current ratio",    ratio(data.current_ratio, "×")],
    ["Return on equity", pct(data.roe_pct)],
    ["Free cash flow",   fmtBig(data.free_cash_flow)],
  ] : [];

  return (
    <div className="bg-surface-raised border border-border rounded-xl p-4">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">
        {ticker} — current metrics
      </p>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-4 bg-surface rounded animate-pulse" />
          ))}
        </div>
      ) : rows.every(([, v]) => v === "—") ? (
        <p className="text-xs text-muted">Metrics unavailable right now.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted">{label}</span>
              <span className="text-xs font-medium text-white">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Moat rating row ─────────────────────────────────────────────────── */
function MoatRow({ label, tooltip, value, onChange }: {
  label: string;
  tooltip: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5 w-44 shrink-0">
        <span className="text-xs text-white">{label}</span>
        <span title={tooltip} className="text-muted cursor-help"><Info size={12} /></span>
      </div>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            title={`${n} / 5`}
            className={clsx(
              "w-8 h-7 rounded-lg text-xs font-medium transition-colors",
              value != null && n <= value
                ? "bg-accent/20 text-accent-light"
                : "bg-surface-hover text-muted hover:text-white"
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <span className="text-xs text-muted w-14 text-right">{value != null ? `${value} / 5` : "not set"}</span>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */
export default function MemoEdit() {
  const { id = "" } = useParams<{ id: string }>();
  const memoId = Number(id);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: memo, isLoading, isError } = useQuery({
    queryKey: ["memo", memoId],
    queryFn: () => getMemo(memoId),
    enabled: Number.isFinite(memoId),
  });

  const [form, setForm] = useState<MemoFormState | null>(null);
  const [moat, setMoat] = useState<MoatUpsert>(EMPTY_MOAT);
  const formRef = useRef<MemoFormState | null>(null);
  const moatRef = useRef<MoatUpsert>(EMPTY_MOAT);
  const dirtyFieldsRef = useRef<Set<keyof MemoPatch>>(new Set());
  const moatDirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([1, 2, 3, 4, 5, 6, 7]));

  // Initialise local form state once from the loaded memo.
  useEffect(() => {
    if (memo && form === null) {
      const f: MemoFormState = {
        business_overview: memo.business_overview,
        moat_notes: memo.moat_notes,
        financial_health_notes: memo.financial_health_notes,
        valuation_notes: memo.valuation_notes,
        risks: memo.risks,
        thesis_summary: memo.thesis_summary,
        recommendation: memo.recommendation,
        price_target: memo.price_target,
        target_horizon_months: memo.target_horizon_months,
      };
      setForm(f);
      formRef.current = f;
      const m = memo.moat
        ? {
            pricing_power: memo.moat.pricing_power,
            switching_costs: memo.moat.switching_costs,
            network_effects: memo.moat.network_effects,
            scale_advantages: memo.moat.scale_advantages,
            brand_moat: memo.moat.brand_moat,
            notes: memo.moat.notes,
          }
        : EMPTY_MOAT;
      setMoat(m);
      moatRef.current = m;
    }
  }, [memo, form]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const dirtyFields = [...dirtyFieldsRef.current];
    const doMoat = moatDirtyRef.current;
    if (dirtyFields.length === 0 && !doMoat) return;

    const patch: MemoPatch = {};
    const current = formRef.current;
    if (current) for (const f of dirtyFields) (patch as Record<string, unknown>)[f] = current[f];
    dirtyFieldsRef.current.clear();
    moatDirtyRef.current = false;

    setSaving(true);
    try {
      if (dirtyFields.length > 0) await updateMemo(memoId, patch);
      if (doMoat) await upsertMoat(memoId, moatRef.current);
      setLastSaved(new Date());
      qc.invalidateQueries({ queryKey: ["memos"] });
    } catch {
      // Put the fields back so the next debounce retries them.
      for (const f of dirtyFields) dirtyFieldsRef.current.add(f);
      if (doMoat) moatDirtyRef.current = true;
      toast.error("Autosave failed — will retry on your next edit.");
    } finally {
      setSaving(false);
    }
  }, [memoId, qc]);

  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flushRef.current(); }, AUTOSAVE_DEBOUNCE_MS);
  }, []);

  // Flush pending edits when the user navigates away or closes the tab.
  useEffect(() => {
    const onBeforeUnload = () => { void flushRef.current(); };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flushRef.current();
    };
  }, []);

  const setField = useCallback(<K extends keyof MemoPatch>(field: K, value: MemoPatch[K]) => {
    setForm((prev) => {
      const next = { ...(prev ?? {}), [field]: value };
      formRef.current = next;
      return next;
    });
    dirtyFieldsRef.current.add(field);
    schedule();
  }, [schedule]);

  const setMoatField = useCallback(<K extends keyof MoatUpsert>(field: K, value: MoatUpsert[K]) => {
    setMoat((prev) => {
      const next = { ...prev, [field]: value };
      moatRef.current = next;
      return next;
    });
    moatDirtyRef.current = true;
    schedule();
  }, [schedule]);

  const publishMutation = useMutation({
    mutationFn: async () => {
      await flush();
      return publishMemo(memoId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memo", memoId] });
      qc.invalidateQueries({ queryKey: ["memos"] });
      toast.success("Memo published — this is now your tracking reference point.");
      navigate(`/memos/${memoId}`);
    },
    onError: () => toast.error("Failed to publish memo"),
  });

  if (isLoading || (memo && form === null)) {
    return (
      <div className="p-6 space-y-3 max-w-3xl">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 bg-surface rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }
  if (isError || !memo || !form) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted">Memo not found.</p>
        <Link to="/memos" className="text-sm text-accent-light hover:text-accent">Back to memos</Link>
      </div>
    );
  }

  const fills = sectionFill(memo, form, moat);
  const filledCount = fills.filter(Boolean).length;
  const publishable = canPublish(form);
  const thesisLen = form.thesis_summary?.length ?? 0;

  const toggleSection = (n: number) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });

  const textareaCls = "w-full bg-surface-raised border border-border rounded-xl px-3.5 py-3 text-sm text-white outline-none focus:border-accent transition-colors resize-y min-h-[110px] placeholder:text-muted/60";
  const inputCls = "bg-surface-raised border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors";

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div>
          <Link to="/memos" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors mb-2">
            <ArrowLeft size={13} />
            Back to memos
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-white">{memo.ticker} — Investment Memo</h1>
            <StatusBadge value={memo.status} />
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted mb-1.5">
            {saving ? "Saving…" : lastSaved ? `Saved ${lastSaved.toLocaleTimeString()}` : "All changes autosave"}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-28 h-1.5 bg-surface-hover rounded-full overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${(filledCount / 7) * 100}%` }} />
            </div>
            <span className="text-xs text-muted">{filledCount} of 7 sections filled</span>
          </div>
        </div>
      </div>

      {memo.status === "published" && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-accent/10 border border-accent/30 text-xs text-accent-light">
          This memo is published. Edits still autosave, but the original price snapshot
          ({memo.price_at_memo != null ? `$${memo.price_at_memo.toFixed(2)}` : "—"}) and publish date stay fixed as your tracking reference.
        </div>
      )}

      <div className="space-y-3">
        {/* 1 — Ticker & basics */}
        <Section index={1} title="Ticker & basics" filled={fills[0]}
          open={openSections.has(1)} onToggle={() => toggleSection(1)}>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <p className="text-[10px] text-muted uppercase tracking-widest mb-1">Ticker</p>
              <p className="text-sm font-semibold text-white">{memo.ticker} <span className="text-xs text-muted font-normal">(locked)</span></p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-widest mb-1">Started</p>
              <p className="text-sm text-white">{new Date(memo.created_at).toLocaleDateString()}</p>
            </div>
            {memo.published_at && (
              <div>
                <p className="text-[10px] text-muted uppercase tracking-widest mb-1">Published</p>
                <p className="text-sm text-white">{new Date(memo.published_at).toLocaleDateString()}</p>
              </div>
            )}
          </div>
        </Section>

        {/* 2 — Business overview */}
        <Section index={2} title="Business overview" subtitle="What does this company do, in plain English?"
          filled={fills[1]} open={openSections.has(2)} onToggle={() => toggleSection(2)}>
          <textarea
            className={textareaCls}
            placeholder="Who are the customers? What do they pay for? How does the company make money?"
            value={form.business_overview ?? ""}
            onChange={(e) => setField("business_overview", e.target.value)}
            onBlur={() => void flush()}
          />
        </Section>

        {/* 3 — Moat */}
        <Section index={3} title="Moat / competitive position" subtitle="Rate each dimension 1 (none) to 5 (dominant)."
          filled={fills[2]} open={openSections.has(3)} onToggle={() => toggleSection(3)}>
          <div className="space-y-3 mb-4">
            {MOAT_DIMENSIONS.map((d) => (
              <MoatRow
                key={d.key}
                label={d.label}
                tooltip={d.tooltip}
                value={(moat[d.key] as number | null) ?? null}
                onChange={(v) => setMoatField(d.key, v)}
              />
            ))}
          </div>
          <textarea
            className={textareaCls}
            placeholder="What protects this business from competition — and what could erode it?"
            value={moat.notes ?? ""}
            onChange={(e) => setMoatField("notes", e.target.value)}
            onBlur={() => void flush()}
          />
        </Section>

        {/* 4 — Financial health */}
        <Section index={4} title="Financial health" subtitle="Growth, margins, balance sheet — the numbers behind the story."
          filled={fills[3]} open={openSections.has(4)} onToggle={() => toggleSection(4)}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <textarea
              className={clsx(textareaCls, "lg:col-span-2 min-h-[180px]")}
              placeholder="Is revenue growing? Are margins expanding or compressing? Can the balance sheet survive a bad year?"
              value={form.financial_health_notes ?? ""}
              onChange={(e) => setField("financial_health_notes", e.target.value)}
              onBlur={() => void flush()}
            />
            <FinancialSnapshot ticker={memo.ticker} />
          </div>
        </Section>

        {/* 5 — Valuation */}
        <Section index={5} title="Valuation" subtitle="What is the business worth, and what does the market think?"
          filled={fills[4]} open={openSections.has(5)} onToggle={() => toggleSection(5)}>
          <textarea
            className={textareaCls}
            placeholder="How does the current price compare to peers and to your own estimate of value?"
            value={form.valuation_notes ?? ""}
            onChange={(e) => setField("valuation_notes", e.target.value)}
            onBlur={() => void flush()}
          />
        </Section>

        {/* 6 — Risks */}
        <Section index={6} title="Risks" subtitle="What would make this thesis wrong?"
          filled={fills[5]} open={openSections.has(6)} onToggle={() => toggleSection(6)}>
          <textarea
            className={textareaCls}
            placeholder="Competition, regulation, customer concentration, leverage, key-person risk…"
            value={form.risks ?? ""}
            onChange={(e) => setField("risks", e.target.value)}
            onBlur={() => void flush()}
          />
        </Section>

        {/* 7 — Thesis & recommendation */}
        <Section index={7} title="Thesis & recommendation" subtitle="The 1-2 sentence version of why this will work."
          filled={fills[6]} open={openSections.has(7)} onToggle={() => toggleSection(7)}>
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between mb-1">
                <label className="text-xs text-muted">Thesis summary</label>
                <span className={clsx("text-[11px]", thesisLen > THESIS_SOFT_LIMIT ? "text-amber-400" : "text-muted")}>
                  {thesisLen}/{THESIS_SOFT_LIMIT}{thesisLen > THESIS_SOFT_LIMIT && " — keep it tight"}
                </span>
              </div>
              <textarea
                className={clsx(textareaCls, "min-h-[70px]")}
                maxLength={500}
                placeholder='e.g. "Services revenue keeps compounding while the market still prices this as a hardware company."'
                value={form.thesis_summary ?? ""}
                onChange={(e) => setField("thesis_summary", e.target.value)}
                onBlur={() => void flush()}
              />
            </div>
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <label className="text-xs text-muted mb-1 block">Recommendation</label>
                <select
                  className={inputCls}
                  value={form.recommendation ?? ""}
                  onChange={(e) => setField("recommendation", (e.target.value || null) as MemoRecommendation | null)}
                  onBlur={() => void flush()}
                >
                  <option value="">Choose…</option>
                  <option value="buy">Buy</option>
                  <option value="hold">Hold</option>
                  <option value="pass">Pass</option>
                  <option value="watch">Watch</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Price target ($)</label>
                <input
                  type="number" min="0" step="any"
                  className={clsx(inputCls, "w-32")}
                  value={form.price_target ?? ""}
                  onChange={(e) => setField("price_target", e.target.value === "" ? null : parseFloat(e.target.value))}
                  onBlur={() => void flush()}
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Horizon (months)</label>
                <input
                  type="number" min="1" max="240" step="1"
                  className={clsx(inputCls, "w-28")}
                  value={form.target_horizon_months ?? ""}
                  onChange={(e) => setField("target_horizon_months", e.target.value === "" ? null : parseInt(e.target.value, 10))}
                  onBlur={() => void flush()}
                />
              </div>
            </div>
          </div>
        </Section>
      </div>

      {/* Publish bar */}
      <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
        <p className="text-xs text-muted max-w-md">
          {memo.status === "published"
            ? "Republishing isn't needed — your edits are already saved."
            : publishable
              ? "Publishing snapshots today's price as the fixed reference point for thesis tracking."
              : "Fill in the thesis summary, recommendation, and price target to publish."}
        </p>
        {memo.status === "published" ? (
          <Link
            to={`/memos/${memo.id}`}
            className="px-5 py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all shadow-lg shadow-accent/20"
          >
            View memo
          </Link>
        ) : (
          <button
            disabled={!publishable || publishMutation.isPending}
            onClick={() => setShowPublishModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-all shadow-lg shadow-accent/20"
          >
            <Rocket size={15} />
            Publish memo
          </button>
        )}
      </div>

      {/* Publish confirm modal */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowPublishModal(false)}>
          <div className="bg-surface-raised border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-2">Publish this memo?</h3>
            <p className="text-sm text-muted mb-5">
              Once published, this becomes your reference point for tracking. You can still edit it,
              but the original snapshot is preserved.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowPublishModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm text-muted border border-border hover:border-border-strong transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowPublishModal(false); publishMutation.mutate(); }}
                disabled={publishMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-medium transition-all"
              >
                {publishMutation.isPending ? "Publishing…" : "Publish"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
