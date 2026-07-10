import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { analyzeChart } from "../api/ai";

interface Props {
  ticker: string;
  range: string;
  price: number;
  changePct: number;
  bars: Array<{ c: number; h?: number; l?: number; v?: number }>;
}

interface ChartAnalysis {
  analysis: string;
  period_high: number;
  period_low: number;
  trend: string;
  disclaimer: string;
}

export default function AIChartAnalysisPanel({ ticker, range, price, changePct, bars }: Props) {
  const [analysis, setAnalysis] = useState<ChartAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Clear stale analysis when the user switches ticker or time range.
  useEffect(() => {
    setAnalysis(null);
    setError("");
  }, [ticker, range]);

  const run = async () => {
    setLoading(true); setError(""); setAnalysis(null);
    try {
      const result = await analyzeChart({
        ticker, range, price, change_pct: changePct,
        bars: bars.map((b) => ({ c: b.c, h: b.h, l: b.l, v: b.v })),
      });
      setAnalysis(result);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      setError(status === 503 ? "AI analysis is not configured on this server." : "Chart analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border-t border-border">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
            <Sparkles size={13} className="text-accent-light" />
          </div>
          <p className="text-xs font-semibold text-white">AI Chart Analysis</p>
        </div>
      </div>

      <button
        onClick={run}
        disabled={loading || bars.length === 0}
        className="w-full flex items-center justify-center gap-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-xs font-semibold transition-colors mb-3"
      >
        {loading ? (
          <><span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" /> Analyzing…</>
        ) : (
          <><Sparkles size={13} /> Analyze This Chart</>
        )}
      </button>

      {error && (
        <div className="bg-negative/10 border border-negative/20 rounded-xl px-3 py-2 text-[11px] text-negative mb-2">
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[100, 90, 75].map((w, i) => (
            <div key={i} className="h-3 bg-surface-hover rounded-full animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}

      {analysis && !loading && (
        <div className="space-y-2">
          <p className="text-xs text-white leading-relaxed">{analysis.analysis}</p>
          <div className="flex items-center justify-between text-[10px] text-muted bg-surface-hover rounded-lg px-3 py-2">
            <span>Support ~${analysis.period_low.toFixed(2)}</span>
            <span>Resistance ~${analysis.period_high.toFixed(2)}</span>
            <span className="capitalize">{analysis.trend}</span>
          </div>
          <p className="text-[10px] text-muted italic">{analysis.disclaimer}</p>
        </div>
      )}

      {!analysis && !loading && !error && (
        <p className="text-[11px] text-muted text-center py-2">
          Click "Analyze This Chart" for an AI reading of {ticker}'s price action.
        </p>
      )}
    </div>
  );
}
