import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { getMemo } from "../api/memos";
import { getQuote } from "../api/stocks";
import { RecommendationBadge, StatusBadge } from "../components/MemoBadges";
import { MOAT_DIMENSIONS, daysSince, fmtPct, fmtPrice, pctSince } from "../utils/memo";
import { ArrowLeft, ArrowRight, Pencil } from "lucide-react";
import { clsx } from "clsx";

function ProseSection({ title, subtitle, text }: { title: string; subtitle?: string; text: string | null }) {
  if (!text?.trim()) return null;
  return (
    <section>
      <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-1">{title}</h2>
      {subtitle && <p className="text-[11px] text-muted/70 mb-2">{subtitle}</p>}
      <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">{text}</p>
    </section>
  );
}

function MoatDots({ value }: { value: number | null }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={clsx(
            "w-2.5 h-2.5 rounded-full",
            value != null && n <= value ? "bg-accent" : "bg-surface-hover"
          )}
        />
      ))}
    </div>
  );
}

export default function MemoView() {
  const { id = "" } = useParams<{ id: string }>();
  const memoId = Number(id);

  const { data: memo, isLoading, isError } = useQuery({
    queryKey: ["memo", memoId],
    queryFn: () => getMemo(memoId),
    enabled: Number.isFinite(memoId),
  });

  // Memo views are non-critical — 15-minute delayed pricing is fine here.
  const { data: quote } = useQuery({
    queryKey: ["quote", memo?.ticker ?? ""],
    queryFn: () => getQuote(memo!.ticker),
    enabled: !!memo,
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-3 max-w-3xl">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 bg-surface rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }
  if (isError || !memo) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted mb-2">Memo not found.</p>
        <Link to="/memos" className="text-sm text-accent-light hover:text-accent">Back to memos</Link>
      </div>
    );
  }

  const currentPrice = (quote?.price as number | undefined) ?? null;
  const changePct = pctSince(memo.price_at_memo, currentPrice);
  const days = daysSince(memo.published_at);
  const moat = memo.moat;
  const ratedMoat = moat && MOAT_DIMENSIONS.some((d) => moat[d.key] != null);

  return (
    <div className="p-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <Link to="/memos" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors mb-2">
            <ArrowLeft size={13} />
            Back to memos
          </Link>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-white">{memo.ticker}</h1>
            <RecommendationBadge value={memo.recommendation} />
            <StatusBadge value={memo.status} />
          </div>
          {memo.published_at && (
            <p className="text-xs text-muted mt-1">
              Published {new Date(memo.published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          )}
        </div>
        <Link
          to={`/memos/${memo.id}/edit`}
          title="Edit memo"
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-border text-muted hover:text-white hover:border-border-strong transition-all shrink-0"
        >
          <Pencil size={13} />
          Edit
        </Link>
      </div>

      {/* Performance since memo */}
      {memo.status === "published" && memo.price_at_memo != null && (
        <div className="bg-surface rounded-xl border border-border px-5 py-4 mb-6">
          <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">Performance since memo</p>
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <p className="text-[10px] text-muted mb-0.5">At memo</p>
              <p className="text-base font-semibold text-white">{fmtPrice(memo.price_at_memo)}</p>
            </div>
            <ArrowRight size={16} className="text-muted shrink-0" />
            <div>
              <p className="text-[10px] text-muted mb-0.5">Current</p>
              <p className="text-base font-semibold text-white">{fmtPrice(currentPrice)}</p>
            </div>
            <div className="ml-2">
              <p className="text-[10px] text-muted mb-0.5">Change</p>
              <p className={clsx("text-base font-semibold", (changePct ?? 0) >= 0 ? "text-positive" : "text-negative")}>
                {fmtPct(changePct)}
              </p>
            </div>
            <div className="ml-2">
              <p className="text-[10px] text-muted mb-0.5">Elapsed</p>
              <p className="text-base font-semibold text-white">{days != null ? `${days}d` : "—"}</p>
            </div>
            {memo.price_target != null && (
              <div className="ml-auto text-right">
                <p className="text-[10px] text-muted mb-0.5">
                  Target{memo.target_horizon_months ? ` (${memo.target_horizon_months}mo)` : ""}
                </p>
                <p className="text-base font-semibold text-white">{fmtPrice(memo.price_target)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Thesis pull-quote */}
      {memo.thesis_summary?.trim() && (
        <blockquote className="border-l-2 border-accent pl-4 py-1 mb-8">
          <p className="text-lg text-white leading-snug font-medium">{memo.thesis_summary}</p>
        </blockquote>
      )}

      <div className="space-y-8">
        <ProseSection title="Business overview" text={memo.business_overview} />

        {(ratedMoat || moat?.notes?.trim() || memo.moat_notes?.trim()) && (
          <section>
            <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Moat / competitive position</h2>
            {ratedMoat && (
              <div className="bg-surface rounded-xl border border-border p-4 mb-3 space-y-2.5">
                {MOAT_DIMENSIONS.map((d) => (
                  <div key={d.key} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted">{d.label}</span>
                    <MoatDots value={(moat?.[d.key] as number | null) ?? null} />
                  </div>
                ))}
              </div>
            )}
            {moat?.notes?.trim() && (
              <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">{moat.notes}</p>
            )}
            {memo.moat_notes?.trim() && (
              <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap mt-2">{memo.moat_notes}</p>
            )}
          </section>
        )}

        <ProseSection title="Financial health" text={memo.financial_health_notes} />

        {(memo.valuation_notes?.trim() || (memo.comps?.peer_tickers.length ?? 0) > 0 || memo.scenarios.length > 0) && (
          <section>
            <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-2">Valuation</h2>
            {memo.valuation_notes?.trim() && (
              <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap mb-4">{memo.valuation_notes}</p>
            )}

            {memo.comps && memo.comps.peer_tickers.length > 0 && (
              <div className="bg-surface rounded-xl border border-border p-4 mb-4">
                <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Peer set</p>
                <div className="flex flex-wrap gap-1.5">
                  {memo.comps.peer_tickers.map((p) => (
                    <span key={p} className="px-2.5 py-1 rounded-full bg-surface-hover text-xs text-white">{p}</span>
                  ))}
                </div>
                {memo.comps.notes?.trim() && (
                  <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap mt-3">{memo.comps.notes}</p>
                )}
              </div>
            )}

            {memo.scenarios.length > 0 && (
              <div className="bg-surface rounded-xl border border-border p-4">
                <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">DCF scenarios</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {memo.scenarios.map((s) => (
                    <div key={s.id} className="bg-surface-raised rounded-lg p-3">
                      <p className="text-xs text-muted capitalize mb-1">{s.scenario_name}</p>
                      <p className="text-lg font-bold text-white">{fmtPrice(s.fair_value_per_share)}</p>
                      <p className="text-[11px] text-muted mt-1.5">
                        {s.revenue_growth_pct}% growth · {s.operating_margin_pct}% margin
                      </p>
                      <p className="text-[11px] text-muted">
                        {s.discount_rate_pct}% WACC · {s.terminal_growth_pct}% TGR · {s.projection_years}y
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        <ProseSection title="Risks" text={memo.risks} />
      </div>
    </div>
  );
}
