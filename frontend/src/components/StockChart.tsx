import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { getChart } from "../api/stocks";
import { clsx } from "clsx";
import { loadPrefs } from "../utils/prefs";

const RANGES = ["1D", "5D", "1M", "6M", "1Y", "5Y"] as const;

export default function StockChart({ ticker }: { ticker: string }) {
  const prefs = loadPrefs();
  const [range, setRange] = useState<string>(prefs.defaultRange);
  const gradId = useId();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["chart", ticker, range],
    queryFn: () => getChart(ticker, range),
    staleTime: 60_000,
    retry: 2,
  });

  const bars: Array<{ t: number; c: number }> = data?.results ?? [];
  const chartData = bars.map((b) => ({
    time: b.t,
    price: b.c,
    label: format(new Date(b.t), range === "1D" || range === "5D" ? "HH:mm" : "MMM d"),
  }));

  const isUp = chartData.length >= 2 && chartData.at(-1)!.price >= chartData[0].price;
  const color = isUp ? "#1ed688" : "#ff5c5c";

  return (
    <div>
      <div className="flex gap-0.5 mb-4">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={clsx(
              "px-3 py-1 rounded-lg text-xs font-medium transition-colors",
              range === r ? "bg-accent text-white" : "text-muted hover:text-white hover:bg-surface-hover"
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {isError ? (
        <div className="h-64 flex items-center justify-center">
          <span className="text-sm text-muted">Chart data unavailable — check that the backend is running.</span>
        </div>
      ) : isLoading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.15} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fill: "#5a5a7a", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis domain={["auto", "auto"]} tick={{ fill: "#5a5a7a", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v.toFixed(0)}`} width={52} />
            <Tooltip
              contentStyle={{ background: "#1e1e35", border: "1px solid #2a2a45", borderRadius: 12 }}
              labelStyle={{ color: "#5a5a7a", fontSize: 11 }}
              itemStyle={{ color: "#e2e8f0" }}
              formatter={(v) => [`$${Number(v).toFixed(2)}`, "Price"]}
            />
            <Area type="monotone" dataKey="price" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
