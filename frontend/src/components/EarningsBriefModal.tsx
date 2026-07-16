import { useQuery } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import { getEarningsBrief } from "../api/ai";

interface Company {
  ticker: string;
  name: string;
  time: "BMO" | "AMC" | "DMH";
  eps_estimate: number;
  eps_actual_prev: number;
  beat_history: string;
}

interface Props {
  company: Company;
  date: string;
  onClose: () => void;
}

export default function EarningsBriefModal({ company, date, onClose }: Props) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["earnings-brief", company.ticker, date],
    queryFn: () => getEarningsBrief({
      ticker: company.ticker,
      name: company.name,
      earnings_date: date,
      time: company.time,
      eps_estimate: company.eps_estimate,
      eps_actual_prev: company.eps_actual_prev,
      beat_history: company.beat_history,
    }),
    staleTime: Infinity,
    retry: false,
  });

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-surface-raised border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Sparkles size={16} className="text-accent-light" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">{company.ticker} Earnings Brief</p>
              <p className="text-[10px] text-muted">Powered by AI</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {isLoading && (
          <div className="space-y-3 py-2">
            {[100, 90, 80, 70].map((w, i) => (
              <div key={i} className="h-3.5 bg-surface-hover rounded-full animate-pulse" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}

        {isError && !isLoading && (
          <div className="flex items-center justify-between bg-negative/10 border border-negative/20 rounded-xl px-4 py-3 text-xs text-negative">
            Couldn't generate this brief.
            <button onClick={() => refetch()} className="ml-3 underline">Retry</button>
          </div>
        )}

        {data && !isLoading && (
          <div className="space-y-3">
            {data.analysts_expect && (
              <div className="bg-surface-hover rounded-xl p-4">
                <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1.5">What Analysts Expect</p>
                <p className="text-xs text-white leading-relaxed">{data.analysts_expect}</p>
              </div>
            )}
            {data.key_things_to_watch && (
              <div className="bg-surface-hover rounded-xl p-4">
                <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1.5">Key Things to Watch</p>
                <p className="text-xs text-white leading-relaxed">{data.key_things_to_watch}</p>
              </div>
            )}
            {data.historical_behavior && (
              <div className="bg-surface-hover rounded-xl p-4">
                <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1.5">Historical Behavior</p>
                <p className="text-xs text-white leading-relaxed">{data.historical_behavior}</p>
              </div>
            )}
            {data.position_note && (
              <div className="bg-accent/5 border border-accent/20 rounded-xl p-4">
                <p className="text-[10px] font-semibold text-accent-light uppercase tracking-widest mb-1.5">Your Position</p>
                <p className="text-xs text-white leading-relaxed">{data.position_note}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
