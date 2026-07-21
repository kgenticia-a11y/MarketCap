import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getMemoPerformance } from "../api/memos";
import { fmtPct } from "../utils/memo";
import { AlarmClock, ArrowRight } from "lucide-react";
import { clsx } from "clsx";

const REFLECTION_STALE_DAYS = 30;

export default function ThesisNudgeCard() {
  const { data } = useQuery({
    queryKey: ["memo-performance"],
    queryFn: getMemoPerformance,
    staleTime: 15 * 60_000,
  });

  const stale = (data ?? []).filter(
    (r) => (r.days_since_last_reflection ?? 0) >= REFLECTION_STALE_DAYS,
  );
  if (stale.length === 0) return null;

  const shown = stale.slice(0, 3);

  return (
    <div className="bg-surface rounded-xl border border-amber-500/30 overflow-hidden">
      <div className="px-5 py-3 border-b border-amber-500/20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlarmClock size={14} className="text-amber-400" />
          <span className="text-xs font-semibold text-white">Time to reflect</span>
        </div>
        <Link
          to="/memos/performance"
          className="flex items-center gap-1 text-xs text-muted hover:text-white transition-colors"
        >
          All performance
          <ArrowRight size={11} />
        </Link>
      </div>
      <p className="px-5 pt-3 text-xs text-muted">
        {stale.length === 1
          ? "1 memo hasn't been reflected on in 30+ days:"
          : `${stale.length} memos haven't been reflected on in 30+ days:`}
      </p>
      <ul className="px-2 pb-2 pt-1">
        {shown.map((r) => (
          <li key={r.memo_id}>
            <Link
              to={`/memos/${r.memo_id}`}
              className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white w-14">{r.ticker}</span>
                <span className="text-xs text-muted">
                  {r.days_since_last_reflection}d since {r.checkpoints_count === 0 ? "publish" : "last read"}
                </span>
              </div>
              {r.pct_change != null && (
                <span
                  className={clsx(
                    "text-xs font-medium",
                    r.pct_change >= 0 ? "text-positive" : "text-negative",
                  )}
                >
                  {fmtPct(r.pct_change)}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
