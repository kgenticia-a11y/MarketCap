import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getMemoPerformance, type MemoPerformanceRow } from "../api/memos";
import { RecommendationBadge } from "../components/MemoBadges";
import { fmtPct, fmtPrice } from "../utils/memo";
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { clsx } from "clsx";

function Sparkline({ points, width = 130, height = 32 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) {
    return <div style={{ width, height }} className="text-[10px] text-muted flex items-center justify-center">—</div>;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = points[points.length - 1] >= points[0] ? "#22c55e" : "#ef4444";
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} stroke={stroke} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function summary(rows: MemoPerformanceRow[]) {
  const withChange = rows.filter((r) => r.pct_change != null) as (MemoPerformanceRow & { pct_change: number })[];
  const winners = withChange.filter((r) => r.pct_change > 0);
  const losers = withChange.filter((r) => r.pct_change < 0);
  const avg =
    withChange.length > 0
      ? withChange.reduce((s, r) => s + r.pct_change, 0) / withChange.length
      : null;
  return { total: rows.length, winners: winners.length, losers: losers.length, avg };
}

export default function MemoPerformance() {
  const { data, isLoading } = useQuery({
    queryKey: ["memo-performance"],
    queryFn: getMemoPerformance,
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  const rows = data ?? [];
  const stats = summary(rows);

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-6">
        <Link
          to="/memos"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors mb-3"
        >
          <ArrowLeft size={13} />
          Back to memos
        </Link>
        <h1 className="text-xl font-bold text-white mb-1">Thesis performance</h1>
        <p className="text-sm text-muted">
          Sorted worst-first — the losers are where the learning is.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center">
          <p className="text-base text-white mb-1">No published memos yet.</p>
          <p className="text-sm text-muted mb-4">
            Publish a memo to start tracking how your thesis actually plays out.
          </p>
          <Link
            to="/memos/new"
            className="inline-block px-4 py-2 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all"
          >
            Start a memo
          </Link>
        </div>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="bg-surface rounded-xl border border-border p-4">
              <p className="text-[10px] text-muted uppercase tracking-widest mb-1">Memos tracked</p>
              <p className="text-2xl font-bold text-white">{stats.total}</p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <p className="text-[10px] text-muted uppercase tracking-widest mb-1">Avg return</p>
              <p className={clsx(
                "text-2xl font-bold",
                stats.avg == null ? "text-white" : stats.avg >= 0 ? "text-positive" : "text-negative",
              )}>
                {stats.avg == null ? "—" : fmtPct(stats.avg)}
              </p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <p className="text-[10px] text-muted uppercase tracking-widest mb-1">Winners</p>
              <p className="text-2xl font-bold text-positive flex items-center gap-1.5">
                <TrendingUp size={18} />
                {stats.winners}
              </p>
            </div>
            <div className="bg-surface rounded-xl border border-border p-4">
              <p className="text-[10px] text-muted uppercase tracking-widest mb-1">Losers</p>
              <p className="text-2xl font-bold text-negative flex items-center gap-1.5">
                <TrendingDown size={18} />
                {stats.losers}
              </p>
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest">Ticker</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest">Rec</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right hidden sm:table-cell">Published</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right hidden sm:table-cell">Held</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right">At memo</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right">Now</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right">Return</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest hidden md:table-cell">Trail</th>
                  <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right hidden md:table-cell">Reflections</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const stale = (r.days_since_last_reflection ?? 0) >= 30;
                  return (
                    <tr
                      key={r.memo_id}
                      onClick={() => (window.location.href = `/memos/${r.memo_id}`)}
                      className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="text-sm font-semibold text-white">{r.ticker}</span>
                      </td>
                      <td className="px-4 py-3"><RecommendationBadge value={r.recommendation} /></td>
                      <td className="px-4 py-3 text-right text-xs text-muted hidden sm:table-cell">
                        {new Date(r.published_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted hidden sm:table-cell">
                        {r.days_since_memo}d
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-muted">{fmtPrice(r.price_at_memo)}</td>
                      <td className="px-4 py-3 text-right text-sm text-white">{fmtPrice(r.current_price)}</td>
                      <td className="px-4 py-3 text-right">
                        {r.pct_change != null ? (
                          <span className={clsx(
                            "text-sm font-semibold",
                            r.pct_change >= 0 ? "text-positive" : "text-negative",
                          )}>
                            {fmtPct(r.pct_change)}
                          </span>
                        ) : (
                          <span className="text-sm text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <Sparkline points={r.price_series} />
                      </td>
                      <td className="px-4 py-3 text-right text-xs hidden md:table-cell">
                        <span className={clsx("font-medium", stale ? "text-amber-400" : "text-muted")}>
                          {r.checkpoints_count}
                          {r.days_since_last_reflection != null && (
                            <span className="ml-1 text-[10px]">
                              ({r.days_since_last_reflection}d ago)
                            </span>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
