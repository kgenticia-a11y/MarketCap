import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  LineChart, Line, ResponsiveContainer, Tooltip as ReTooltip,
} from "recharts";
import { clsx } from "clsx";
import { toast } from "sonner";
import {
  ArrowLeft, BookOpen, Eye, FileText, Plus, Star, StarOff,
  TrendingDown, TrendingUp, ExternalLink, StickyNote,
} from "lucide-react";

import {
  getTickerHub, getTickerNews, getTickerOwnership,
} from "../api/tickerHub";
import {
  addToWatchlist, removeFromWatchlist, updateWatchlistNotes,
} from "../api/watchlist";
import { createMemo } from "../api/memos";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function fmt(n: number | null | undefined, decimals = 2, suffix = "") {
  if (n == null) return "—";
  return n.toFixed(decimals) + suffix;
}

function fmtCap(cap: number | null) {
  if (!cap) return "—";
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`;
  if (cap >= 1e9)  return `$${(cap / 1e9).toFixed(2)}B`;
  if (cap >= 1e6)  return `$${(cap / 1e6).toFixed(2)}M`;
  return `$${cap.toLocaleString()}`;
}

function fmtDate(ts: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
}

function useDebounce<T>(value: T, ms: number): T {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDv(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return dv;
}

/* ── Tiny sparkline for metric cells ───────────────────────────────────── */

function MetricSparkline({
  data,
  color,
}: {
  data: (number | null)[];
  color: string;
}) {
  const filtered = data.map((v, i) => ({ i, v: v ?? undefined }));
  if (filtered.filter((d) => d.v != null).length < 2) return null;

  return (
    <ResponsiveContainer width={60} height={28}>
      <LineChart data={filtered}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <ReTooltip
          content={() => null}
          cursor={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ── Metric card ────────────────────────────────────────────────────────── */

function MetricCard({
  label,
  value,
  sparkData,
  isRange,
  rangeValue,
  rangeHigh,
  rangeLow,
}: {
  label: string;
  value: string;
  sparkData?: (number | null)[];
  isRange?: boolean;
  rangeValue?: number | null;
  rangeHigh?: number | null;
  rangeLow?: number | null;
}) {
  let pct = 0;
  if (isRange && rangeValue != null && rangeLow != null && rangeHigh != null && rangeHigh > rangeLow) {
    pct = Math.max(0, Math.min(100, ((rangeValue - rangeLow) / (rangeHigh - rangeLow)) * 100));
  }

  const sparkColor = (() => {
    if (!sparkData || sparkData.length < 2) return "rgb(var(--accent))";
    const first = sparkData.find((v) => v != null);
    const last = [...sparkData].reverse().find((v) => v != null);
    if (first == null || last == null) return "rgb(var(--accent))";
    return last >= first ? "rgb(var(--positive))" : "rgb(var(--negative))";
  })();

  return (
    <div className="bg-surface-raised rounded-xl border border-border p-3 flex flex-col gap-1.5">
      <span className="text-[11px] text-muted uppercase tracking-wide">{label}</span>
      <div className="flex items-end justify-between gap-2">
        <span className="text-base font-semibold text-white leading-none">{value}</span>
        {sparkData && sparkData.some((v) => v != null) && (
          <MetricSparkline data={sparkData} color={sparkColor} />
        )}
      </div>
      {isRange && rangeHigh != null && rangeLow != null && (
        <div>
          <div className="relative h-1 bg-surface rounded-full overflow-hidden mt-1">
            <div
              className="absolute left-0 top-0 h-full bg-accent rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted mt-1">
            <span>${rangeLow.toFixed(2)}</span>
            <span>${rangeHigh.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Recommendation badge ───────────────────────────────────────────────── */

const REC_COLORS: Record<string, string> = {
  buy:   "bg-positive/10 text-positive border-positive/20",
  hold:  "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  pass:  "bg-negative/10 text-negative border-negative/20",
  watch: "bg-accent/10 text-accent border-accent/20",
};

function RecBadge({ rec }: { rec: string | null }) {
  if (!rec) return null;
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-[11px] font-medium border uppercase tracking-wide", REC_COLORS[rec] ?? "bg-surface text-muted border-border")}>
      {rec}
    </span>
  );
}

/* ── Skeleton loader ────────────────────────────────────────────────────── */

function SkeletonBox({ className }: { className?: string }) {
  return <div className={clsx("bg-surface-raised rounded-xl animate-pulse", className)} />;
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function TickerHub() {
  const { symbol = "" } = useParams<{ symbol: string }>();
  const ticker = symbol.toUpperCase();
  const navigate = useNavigate();
  const qc = useQueryClient();

  /* Hub data */
  const { data: hub, isLoading, isError } = useQuery({
    queryKey: ["ticker-hub", ticker],
    queryFn: () => getTickerHub(ticker),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });

  /* News (separate, lower priority) */
  const { data: news, isLoading: newsLoading } = useQuery({
    queryKey: ["ticker-news", ticker],
    queryFn: () => getTickerNews(ticker),
    staleTime: 10 * 60_000,
    retry: 1,
  });

  /* Ownership */
  const { data: ownership } = useQuery({
    queryKey: ["ticker-ownership", ticker],
    queryFn: () => getTickerOwnership(ticker),
    staleTime: 60 * 60_000,
    retry: 1,
  });

  /* Watchlist add/remove */
  const isWatched = !!hub?.watchlist_item;

  const watchMutation = useMutation({
    mutationFn: () =>
      isWatched ? removeFromWatchlist(ticker) : addToWatchlist(ticker),
    onSuccess: () => {
      toast.success(isWatched ? `Removed ${ticker} from watchlist` : `Added ${ticker} to watchlist`);
      qc.invalidateQueries({ queryKey: ["ticker-hub", ticker] });
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: () => toast.error("Failed to update watchlist"),
  });

  /* Watchlist notes autosave */
  const [notes, setNotes] = useState<string>(hub?.watchlist_item?.notes ?? "");
  const [notesStatus, setNotesStatus] = useState<"idle" | "saving" | "saved">("idle");
  const debouncedNotes = useDebounce(notes, 800);
  const prevDebouncedRef = useRef<string | null>(null);

  // Sync local notes state when hub data loads or watchlist_item changes
  useEffect(() => {
    if (hub?.watchlist_item) {
      setNotes(hub.watchlist_item.notes ?? "");
      prevDebouncedRef.current = hub.watchlist_item.notes ?? "";
    }
  }, [hub?.watchlist_item?.id]);

  const notesMutation = useMutation({
    mutationFn: (text: string) => updateWatchlistNotes(ticker, text || null),
    onMutate: () => setNotesStatus("saving"),
    onSuccess: () => {
      setNotesStatus("saved");
      qc.invalidateQueries({ queryKey: ["watchlist"] });
      setTimeout(() => setNotesStatus("idle"), 2000);
    },
    onError: () => {
      setNotesStatus("idle");
      toast.error("Failed to save notes");
    },
  });

  useEffect(() => {
    if (!isWatched) return;
    if (prevDebouncedRef.current === null) {
      prevDebouncedRef.current = debouncedNotes;
      return;
    }
    if (prevDebouncedRef.current === debouncedNotes) return;
    prevDebouncedRef.current = debouncedNotes;
    notesMutation.mutate(debouncedNotes);
  }, [debouncedNotes, isWatched]);

  /* Create memo */
  const memoMutation = useMutation({
    mutationFn: () => createMemo(ticker),
    onSuccess: (memo) => {
      toast.success(`Draft memo created for ${ticker}`);
      navigate(`/memos/${memo.id}/edit`);
    },
    onError: () => toast.error("Failed to create memo"),
  });

  /* Quarterly data convenience alias */
  const q = hub?.quarterly ?? { dates: [], revenue: [], gross_margin: [], operating_margin: [], net_margin: [] };

  const price = hub?.price ?? null;
  const changePct = hub?.change_pct ?? null;
  const isUp = (changePct ?? 0) >= 0;

  if (isError) {
    return (
      <div className="p-6 max-w-4xl space-y-4">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-muted hover:text-white transition-colors">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-muted">Could not load data for <strong className="text-white">{ticker}</strong>. Try again later.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl space-y-5">
      {/* Back nav */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted hover:text-white transition-colors"
      >
        <ArrowLeft size={15} /> Back
      </button>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      {isLoading ? (
        <SkeletonBox className="h-28" />
      ) : (
        <div className="bg-surface rounded-xl border border-border p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-white">{ticker}</h1>
                {hub?.name && (
                  <span className="text-sm text-muted truncate max-w-xs">{hub.name}</span>
                )}
              </div>
              {(hub?.sector || hub?.industry) && (
                <p className="text-xs text-muted mt-1">
                  {[hub.sector, hub.industry].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2">
                {price != null && (
                  <span className="text-2xl font-semibold text-white">
                    ${price.toFixed(2)}
                  </span>
                )}
                {changePct != null && (
                  <span
                    className={clsx(
                      "flex items-center gap-0.5 text-sm font-medium",
                      isUp ? "text-positive" : "text-negative",
                    )}
                  >
                    {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {isUp ? "+" : ""}{changePct.toFixed(2)}%
                  </span>
                )}
                {hub?.market_cap && (
                  <span className="text-xs text-muted">Mkt Cap {fmtCap(hub.market_cap)}</span>
                )}
              </div>
            </div>

            {/* CTAs */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => watchMutation.mutate()}
                disabled={watchMutation.isPending}
                className={clsx(
                  "flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all",
                  isWatched
                    ? "bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20"
                    : "bg-surface-raised border border-border text-muted hover:text-white hover:border-border-strong",
                )}
              >
                {isWatched ? <StarOff size={14} /> : <Star size={14} />}
                {isWatched ? "Watching" : "Watch"}
              </button>

              {hub?.memos && hub.memos.length > 0 ? (
                <Link
                  to={`/memos/${hub.memos[0].id}`}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all"
                >
                  <Eye size={14} /> View memo
                </Link>
              ) : (
                <button
                  onClick={() => memoMutation.mutate()}
                  disabled={memoMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all disabled:opacity-50"
                >
                  <FileText size={14} />
                  {memoMutation.isPending ? "Creating…" : "Write memo"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Key Metrics Grid ───────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Key Metrics</h2>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonBox key={i} className="h-20" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCard
              label="Revenue Growth"
              value={fmt(hub?.revenue_growth_pct, 1, "%")}
            />
            <MetricCard
              label="Gross Margin"
              value={fmt(hub?.gross_margin_pct, 1, "%")}
              sparkData={q.gross_margin}
            />
            <MetricCard
              label="Operating Margin"
              value={fmt(hub?.operating_margin_pct, 1, "%")}
              sparkData={q.operating_margin}
            />
            <MetricCard
              label="Net Margin"
              value={fmt(hub?.net_margin_pct, 1, "%")}
              sparkData={q.net_margin}
            />
            <MetricCard
              label="ROE"
              value={fmt(hub?.roe_pct, 1, "%")}
            />
            <MetricCard
              label="Debt / Equity"
              value={fmt(hub?.debt_to_equity, 2)}
            />
            <MetricCard
              label="52-Week Range"
              value={
                hub?.week_52_high && hub?.week_52_low
                  ? `$${hub.week_52_low.toFixed(2)} – $${hub.week_52_high.toFixed(2)}`
                  : "—"
              }
              isRange
              rangeValue={price}
              rangeHigh={hub?.week_52_high}
              rangeLow={hub?.week_52_low}
            />
            <MetricCard
              label="Revenue (ttm)"
              value={(() => {
                const last4 = q.revenue.slice(-4).filter((v): v is number => v != null);
                const sum = last4.reduce((s, v) => s + v, 0);
                return last4.length > 0 && sum > 0 ? fmt(sum, 2, "B") : "—";
              })()}
              sparkData={q.revenue}
            />
          </div>
        )}
      </section>

      {/* ── Recent News ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Recent News</h2>
        <div className="bg-surface rounded-xl border border-border divide-y divide-border/50">
          {newsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="p-4 space-y-2">
                <SkeletonBox className="h-4 w-3/4" />
                <SkeletonBox className="h-3 w-full" />
              </div>
            ))
          ) : !news || news.length === 0 ? (
            <div className="p-5 text-center text-sm text-muted">No recent news available.</div>
          ) : (
            news.map((item, i) => (
              <div key={i} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-white hover:text-accent-light transition-colors line-clamp-2 leading-snug"
                    >
                      {item.title}
                    </a>
                    {item.ai_summary && (
                      <p className="text-xs text-muted/80 mt-1 leading-relaxed italic">
                        {item.ai_summary}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-1.5">
                      {item.publisher && (
                        <span className="text-[11px] text-muted">{item.publisher}</span>
                      )}
                      {item.published_ts && (
                        <span className="text-[11px] text-muted/60">{fmtDate(item.published_ts)}</span>
                      )}
                    </div>
                  </div>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted hover:text-white transition-colors mt-0.5"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ── Ownership ────────────────────────────────────────────────── */}
      {ownership && ownership.available && (
        <section>
          <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Ownership</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Institutional holders */}
            {ownership.institutional_holders.length > 0 && (
              <div className="bg-surface rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">Top Institutional Holders</span>
                </div>
                <div className="divide-y divide-border/40">
                  {ownership.institutional_holders.slice(0, 10).map((h, i) => (
                    <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-xs text-white truncate">{h.holder}</span>
                      <div className="flex items-center gap-3 shrink-0 text-right">
                        {h.pct_out != null && (
                          <span className="text-xs text-muted">{h.pct_out.toFixed(2)}%</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Insider transactions */}
            {ownership.insider_transactions.length > 0 && (
              <div className="bg-surface rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">Insider Transactions (6mo)</span>
                </div>
                <div className="divide-y divide-border/40">
                  {ownership.insider_transactions.slice(0, 8).map((tx, i) => (
                    <div key={i} className="px-4 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs text-white font-medium truncate">{tx.name}</span>
                        {tx.date && (
                          <span className="text-[11px] text-muted shrink-0">{tx.date}</span>
                        )}
                      </div>
                      {tx.title && (
                        <span className="text-[11px] text-muted">{tx.title}</span>
                      )}
                      {tx.transaction && (
                        <p className="text-[11px] text-muted/70 mt-0.5 line-clamp-1">{tx.transaction}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Your Research ─────────────────────────────────────────────── */}
      {!isLoading && (hub?.memos.length || hub?.portfolio_positions.length || hub?.watchlist_item) && (
        <section>
          <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Your Research</h2>
          <div className="space-y-3">
            {/* Portfolio positions */}
            {hub!.portfolio_positions.length > 0 && (
              <div className="bg-surface rounded-xl border border-border p-4">
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Portfolio Position</p>
                {hub!.portfolio_positions.map((pos) => (
                  <div key={pos.id} className="flex items-center gap-4 text-sm">
                    <span className="text-white font-medium">{pos.shares} shares</span>
                    <span className="text-muted">avg ${pos.avg_buy_price.toFixed(2)}</span>
                    {price != null && (
                      <span className={clsx(
                        "font-medium",
                        price >= pos.avg_buy_price ? "text-positive" : "text-negative",
                      )}>
                        {price >= pos.avg_buy_price ? "+" : ""}
                        {(((price - pos.avg_buy_price) / pos.avg_buy_price) * 100).toFixed(2)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Investment memos */}
            {hub!.memos.length > 0 && (
              <div className="bg-surface rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted uppercase tracking-wide">Investment Memos</span>
                  <Link
                    to={`/memos/new`}
                    className="flex items-center gap-1 text-xs text-muted hover:text-accent-light transition-colors"
                  >
                    <Plus size={11} /> New
                  </Link>
                </div>
                <div className="divide-y divide-border/40">
                  {hub!.memos.map((m) => (
                    <Link
                      key={m.id}
                      to={`/memos/${m.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <BookOpen size={13} className="text-muted shrink-0" />
                        <span className="text-sm text-white truncate">
                          {m.thesis_summary ?? `${m.ticker} memo`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <RecBadge rec={m.recommendation} />
                        <span className="text-[11px] text-muted capitalize">{m.status}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Watchlist notes */}
            {hub?.watchlist_item && (
              <div className="bg-surface rounded-xl border border-border p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <StickyNote size={13} className="text-muted" />
                    <span className="text-xs font-semibold text-muted uppercase tracking-wide">Research Notes</span>
                  </div>
                  <span className={clsx(
                    "text-[11px] transition-colors",
                    notesStatus === "saving" ? "text-muted" :
                    notesStatus === "saved"  ? "text-positive" : "text-transparent",
                  )}>
                    {notesStatus === "saving" ? "Saving…" : notesStatus === "saved" ? "Saved" : "·"}
                  </span>
                </div>
                <textarea
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setNotesStatus("idle");
                  }}
                  rows={4}
                  placeholder="Quick research notes, price targets, reminders…"
                  className="w-full bg-surface-raised border border-border rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-muted/50 outline-none focus:border-accent transition-colors resize-none"
                />
              </div>
            )}
          </div>
        </section>
      )}

      {/* Add to watchlist nudge if not watching and no research */}
      {!isLoading && !hub?.watchlist_item && !hub?.memos.length && (
        <div className="bg-surface rounded-xl border border-border p-5 text-center">
          <p className="text-sm text-muted mb-3">
            Add <strong className="text-white">{ticker}</strong> to your watchlist to track it and take notes.
          </p>
          <button
            onClick={() => watchMutation.mutate()}
            disabled={watchMutation.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all"
          >
            <Star size={14} /> Watch {ticker}
          </button>
        </div>
      )}
    </div>
  );
}
