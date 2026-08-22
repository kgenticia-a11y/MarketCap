import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, TrendingUp, TrendingDown } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { clsx } from "clsx";
import { getEtfPerformance } from "../api/stocks";
import { format } from "date-fns";

interface Props {
  ticker: string;
  label: string;
  onClose: () => void;
}

const PERIODS = ["1D", "1W", "1M", "1Y"] as const;
type Period = typeof PERIODS[number];

const PERIOD_LABELS: Record<Period, string> = {
  "1D": "Today",
  "1W": "Past Week",
  "1M": "Past Month",
  "1Y": "Past Year",
};

export default function EtfDetailModal({ ticker, label, onClose }: Props) {
  const [period, setPeriod] = useState<Period>("1D");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["etf-performance", ticker],
    queryFn: () => getEtfPerformance(ticker),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const pd = data?.periods[period];
  const positive = pd?.change_pct != null ? pd.change_pct >= 0 : true;
  const color = positive ? "#22c55e" : "#ef4444";
  const gradId = `etf-grad-${ticker}-${period}`;

  const chartData = (pd?.bars ?? []).map((b) => ({
    label:
      period === "1D"
        ? format(new Date(b.t), "HH:mm")
        : format(new Date(b.t), "MMM d"),
    price: b.c,
  }));

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border rounded-2xl p-6 w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="text-xs text-muted mb-0.5">{label}</div>
            <div className="text-2xl font-bold text-white">{ticker}</div>
            {data?.price != null && (
              <div className="text-base text-muted mt-1">
                $
                {data.price.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-white transition-colors p-1 -mt-1 -mr-1"
          >
            <X size={20} />
          </button>
        </div>

        {/* Period tabs */}
        <div className="flex gap-1 mb-5 bg-surface rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                "flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors",
                period === p
                  ? "bg-accent/20 text-white"
                  : "text-muted hover:text-white"
              )}
            >
              {p}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="h-52 flex items-center justify-center text-muted text-sm">
            Loading…
          </div>
        ) : isError ? (
          <div className="h-52 flex items-center justify-center text-negative text-sm">
            Failed to load market data
          </div>
        ) : (
          <>
            {/* Change summary */}
            <div className="flex items-center gap-3 mb-4">
              {pd?.change_pct != null ? (
                <>
                  <div
                    className={clsx(
                      "flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full",
                      positive
                        ? "bg-positive/10 text-positive"
                        : "bg-negative/10 text-negative"
                    )}
                  >
                    {positive ? (
                      <TrendingUp size={14} />
                    ) : (
                      <TrendingDown size={14} />
                    )}
                    {positive ? "+" : ""}
                    {pd.change_pct.toFixed(2)}%
                  </div>
                  {pd.change_abs != null && (
                    <span
                      className={clsx(
                        "text-sm font-medium",
                        positive ? "text-positive" : "text-negative"
                      )}
                    >
                      {positive ? "+" : ""}${Math.abs(pd.change_abs).toFixed(2)}
                    </span>
                  )}
                  <span className="text-xs text-muted ml-auto">
                    {PERIOD_LABELS[period]}
                  </span>
                </>
              ) : (
                <span className="text-sm text-muted">No data available</span>
              )}
            </div>

            {/* Price chart */}
            {chartData.length > 1 && (
              <div className="mb-4">
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient
                        id={gradId}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={color}
                          stopOpacity={0.2}
                        />
                        <stop
                          offset="95%"
                          stopColor={color}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#5a5a7a", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fill: "#5a5a7a", fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                      width={52}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#1e1e35",
                        border: "1px solid #2a2a45",
                        borderRadius: 12,
                      }}
                      labelStyle={{ color: "#9ca3af", fontSize: 11 }}
                      formatter={(v) => [
                        `$${Number(v).toFixed(2)}`,
                        ticker,
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="price"
                      stroke={color}
                      strokeWidth={2}
                      fill={`url(#${gradId})`}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* High / Low */}
            {(pd?.high != null || pd?.low != null) && (
              <div className="grid grid-cols-2 gap-3">
                {pd?.high != null && (
                  <div className="bg-surface rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">
                      {period} High
                    </div>
                    <div className="text-sm font-semibold text-white">
                      ${pd.high.toFixed(2)}
                    </div>
                  </div>
                )}
                {pd?.low != null && (
                  <div className="bg-surface rounded-lg p-3">
                    <div className="text-xs text-muted mb-1">{period} Low</div>
                    <div className="text-sm font-semibold text-white">
                      ${pd.low.toFixed(2)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
