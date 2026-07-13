import { useQuery } from "@tanstack/react-query";
import { Sparkles, RefreshCw } from "lucide-react";
import { getDailyBrief } from "../api/ai";

export default function DailyBriefCard() {
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ["daily-brief"],
    queryFn: getDailyBrief,
    staleTime: Infinity,
    retry: false,
  });

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <Sparkles size={16} className="text-accent-light" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">Your Daily Brief</p>
            <p className="text-[10px] text-muted">Powered by Meta Llama</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-muted hover:text-white disabled:opacity-50 transition-colors px-2.5 py-1.5 rounded-lg border border-border hover:border-border-strong"
        >
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {isLoading && (
        <div className="space-y-2.5 py-1">
          {[100, 95, 88, 60].map((w, i) => (
            <div key={i} className="h-3.5 bg-surface-hover rounded-full animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <div className="flex items-center justify-between bg-negative/10 border border-negative/20 rounded-xl px-4 py-3 text-xs text-negative">
          Couldn't generate today's brief.
          <button onClick={() => refetch()} className="ml-3 underline">Retry</button>
        </div>
      )}

      {data?.brief && !isLoading && (
        <p className="text-sm text-white leading-relaxed">{data.brief}</p>
      )}
    </div>
  );
}
