import { useState, useMemo } from "react";
import { useTheme } from "../context/ThemeContext";
import { useQuery } from "@tanstack/react-query";
import { getIncomeData, searchStocks } from "../api/stocks";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Search, TrendingUp, DollarSign, Percent, Calendar } from "lucide-react";
import { clsx } from "clsx";

const HORIZONS = [5, 10, 15, 20, 30];

function fmt(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtAxis(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-raised border border-border rounded-xl p-3 shadow-2xl text-xs">
      <div className="text-muted mb-2 font-medium">Year {label}</div>
      {payload.map((p: { name: string; value: number; color: string }) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-muted">{p.name}:</span>
          <span className="text-white font-semibold">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function IncomeEstimator() {
  const { theme } = useTheme();
  const gridColor  = theme === "light" ? "#e2e8f0" : "#1e1e35";
  const mutedColor = theme === "light" ? "#64748b" : "#5a5a7a";
  const axisColor  = theme === "light" ? "#cbd5e1" : "#2a2a45";

  const [ticker, setTicker]       = useState("AAPL");
  const [inputTicker, setInput]   = useState("AAPL");
  const [searchOpen, setSearchOpen] = useState(false);
  const [amount, setAmount]       = useState(10_000);
  const [returnRate, setReturnRate] = useState<number | "">("");
  const [horizon, setHorizon]     = useState(10);
  const [reinvest, setReinvest]   = useState(true);

  const { data: incomeData, isLoading } = useQuery({
    queryKey: ["income", ticker],
    queryFn: () => getIncomeData(ticker),
    staleTime: 300_000,
    enabled: !!ticker,
  });

  const { data: searchData } = useQuery({
    queryKey: ["search", inputTicker],
    queryFn: () => searchStocks(inputTicker),
    enabled: searchOpen && inputTicker.length >= 1,
    staleTime: 30_000,
  });

  const searchResults: Array<{ ticker: string; name: string }> =
    searchData?.results?.slice(0, 6) ?? [];

  // Use fetched CAGR as the default, but allow override
  const effectiveReturn = returnRate !== "" ? Number(returnRate) : (incomeData?.five_year_cagr ?? 10);
  const divYield = incomeData?.dividend_yield ?? 0;
  const divRate  = incomeData?.dividend_rate ?? 0;
  const price    = incomeData?.price && incomeData.price > 0 ? incomeData.price : null;
  const shares   = price ? amount / price : 0;

  // Build year-by-year projection series
  const chartData = useMemo(() => {
    const pts = [];
    const growthPct = effectiveReturn / 100;
    const yieldPct  = divYield / 100;

    for (let y = 0; y <= horizon; y++) {
      // Growth-only value (no dividend income)
      const growthValue = amount * Math.pow(1 + growthPct, y);

      // With reinvestment: dividends immediately buy more shares at same growth
      const reinvestRate = growthPct + yieldPct;
      const reinvestValue = amount * Math.pow(1 + reinvestRate, y);

      // Without reinvestment: dividends accumulate as cash
      const cashDivs = shares * divRate * y;
      const noReinvestValue = growthValue + cashDivs;

      pts.push({
        year: y,
        "Growth only": Math.round(growthValue),
        [reinvest ? "With dividends (reinvested)" : "With dividends (cash)"]:
          Math.round(reinvest ? reinvestValue : noReinvestValue),
      });
    }
    return pts;
  }, [amount, effectiveReturn, divYield, divRate, shares, horizon, reinvest]);

  const finalWithDiv   = chartData[chartData.length - 1]?.[
    reinvest ? "With dividends (reinvested)" : "With dividends (cash)"
  ] ?? 0;
  const totalReturn    = finalWithDiv - amount;
  const annualDivIncome = shares * divRate;
  const futureAnnualDiv = reinvest
    ? price > 0 ? (finalWithDiv / price) * divRate : 0
    : annualDivIncome;

  const selectTicker = (t: string) => {
    setTicker(t.toUpperCase());
    setInput(t.toUpperCase());
    setSearchOpen(false);
    setReturnRate(""); // reset to fetched CAGR
  };

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Left panel: Inputs ── */}
        <div className="space-y-4">
          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-widest mb-4">Configuration</h3>

            {/* Ticker search */}
            <div className="mb-4 relative">
              <label className="text-xs text-muted mb-1.5 block">Stock / ETF</label>
              <div className="flex items-center bg-sidebar border border-border rounded-xl px-3 py-2.5 gap-2 focus-within:border-accent transition-colors">
                <Search size={13} className="text-muted shrink-0" />
                <input
                  value={inputTicker}
                  onChange={(e) => { setInput(e.target.value.toUpperCase()); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  placeholder="AAPL, MSFT, SPY…"
                  className="bg-transparent text-sm text-white outline-none w-full font-semibold tracking-wide"
                />
              </div>
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-surface-raised border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
                  {searchResults.map((r) => (
                    <button
                      key={r.ticker}
                      onMouseDown={() => selectTicker(r.ticker)}
                      className="w-full text-left px-4 py-2.5 hover:bg-surface-hover transition-colors flex items-center gap-3"
                    >
                      <span className="text-xs font-bold text-white w-12 shrink-0">{r.ticker}</span>
                      <span className="text-xs text-muted truncate">{r.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Investment amount */}
            <div className="mb-4">
              <label className="text-xs text-muted mb-1.5 block">Investment Amount</label>
              <div className="flex items-center bg-sidebar border border-border rounded-xl px-3 py-2.5 gap-2 focus-within:border-accent transition-colors">
                <span className="text-muted text-sm">$</span>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={amount}
                  onChange={(e) => setAmount(Math.max(100, Number(e.target.value)))}
                  className="bg-transparent text-sm text-white outline-none w-full font-semibold"
                />
              </div>
              <div className="flex gap-1.5 mt-2">
                {[1_000, 5_000, 10_000, 50_000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className={clsx(
                      "flex-1 py-1 rounded-lg text-[10px] font-medium transition-all border",
                      amount === v
                        ? "bg-accent text-white border-accent"
                        : "text-muted border-border hover:text-white hover:border-border-strong"
                    )}
                  >
                    {v >= 1_000 ? `$${v / 1_000}K` : `$${v}`}
                  </button>
                ))}
              </div>
            </div>

            {/* Annual return rate */}
            <div className="mb-4">
              <label className="text-xs text-muted mb-1.5 flex items-center justify-between">
                Annual Growth Rate
                {incomeData && (
                  <button
                    onClick={() => setReturnRate("")}
                    className="text-accent-light hover:text-accent text-[10px]"
                  >
                    Reset to 5Y avg ({incomeData.five_year_cagr}%)
                  </button>
                )}
              </label>
              <div className="flex items-center bg-sidebar border border-border rounded-xl px-3 py-2.5 gap-2 focus-within:border-accent transition-colors">
                <input
                  type="number"
                  step={0.5}
                  value={returnRate !== "" ? returnRate : effectiveReturn}
                  onChange={(e) => setReturnRate(e.target.value === "" ? "" : Number(e.target.value))}
                  className="bg-transparent text-sm text-white outline-none w-full font-semibold"
                />
                <span className="text-muted text-sm">%</span>
              </div>
            </div>

            {/* Time horizon */}
            <div className="mb-4">
              <label className="text-xs text-muted mb-1.5 block">Time Horizon</label>
              <div className="flex gap-1">
                {HORIZONS.map((y) => (
                  <button
                    key={y}
                    onClick={() => setHorizon(y)}
                    className={clsx(
                      "flex-1 py-1.5 rounded-lg text-xs font-medium transition-all border",
                      horizon === y
                        ? "bg-accent text-white border-accent shadow-lg shadow-accent/20"
                        : "text-muted border-border hover:text-white hover:border-border-strong"
                    )}
                  >
                    {y}Y
                  </button>
                ))}
              </div>
            </div>

            {/* Reinvest toggle */}
            <div className="flex items-center justify-between py-3 border-t border-border">
              <div>
                <div className="text-xs font-medium text-white">Reinvest Dividends</div>
                <div className="text-[10px] text-muted">Compound returns over time</div>
              </div>
              <button
                onClick={() => setReinvest(!reinvest)}
                className={clsx(
                  "w-10 h-5 rounded-full relative transition-all duration-200",
                  reinvest ? "bg-accent" : "bg-surface-hover"
                )}
              >
                <span
                  className={clsx(
                    "absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all duration-200",
                    reinvest ? "left-5" : "left-0.5"
                  )}
                />
              </button>
            </div>
          </div>

          {/* Stock info card */}
          {incomeData && !isLoading && (
            <div className="bg-surface rounded-xl border border-border p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-white">{incomeData.ticker}</span>
                <span className="text-xs text-muted">{incomeData.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-muted mb-0.5">Price</div>
                  <div className="font-semibold text-white">${incomeData.price.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-muted mb-0.5">Div Yield</div>
                  <div className="font-semibold text-positive">{incomeData.dividend_yield.toFixed(2)}%</div>
                </div>
                <div>
                  <div className="text-muted mb-0.5">Annual Div</div>
                  <div className="font-semibold text-white">${incomeData.dividend_rate.toFixed(2)}/sh</div>
                </div>
                <div>
                  <div className="text-muted mb-0.5">Payout Ratio</div>
                  <div className="font-semibold text-white">{incomeData.payout_ratio.toFixed(1)}%</div>
                </div>
                {incomeData.ex_dividend_date && (
                  <div className="col-span-2">
                    <div className="text-muted mb-0.5">Ex-Dividend Date</div>
                    <div className="font-semibold text-white flex items-center gap-1">
                      <Calendar size={11} className="text-muted" />
                      {incomeData.ex_dividend_date}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {isLoading && (
            <div className="bg-surface rounded-xl border border-border p-5 h-40 animate-pulse" />
          )}
        </div>

        {/* ── Right panel: Chart + Summary ── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: DollarSign,  label: "Final Value",         value: fmt(finalWithDiv),       color: "text-accent-light" },
              { icon: TrendingUp,  label: "Total Return",        value: fmt(totalReturn),         color: totalReturn >= 0 ? "text-positive" : "text-negative" },
              { icon: Percent,     label: "Dividend Yield",      value: `${divYield.toFixed(2)}%`, color: "text-positive" },
              { icon: DollarSign,  label: `Yr ${horizon} Div Income`, value: `${fmt(futureAnnualDiv)}/yr`, color: "text-white" },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} className="bg-surface rounded-xl border border-border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={13} className="text-muted" />
                  <span className="text-[10px] text-muted uppercase tracking-widest">{label}</span>
                </div>
                <div className={clsx("text-base font-bold", color)}>{value}</div>
              </div>
            ))}
          </div>

          {/* Projection chart */}
          <div className="bg-surface rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">
                {horizon}-Year Portfolio Projection
              </h3>
              <span className="text-xs text-muted">
                {fmt(amount)} invested · {effectiveReturn}% growth{divYield > 0 ? ` · ${divYield.toFixed(2)}% yield` : ""}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="gradDiv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#7c5cfc" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#7c5cfc" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradGrowth" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#1ed688" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#1ed688" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis
                  dataKey="year"
                  tick={{ fill: mutedColor, fontSize: 11 }}
                  tickFormatter={(v) => `Yr ${v}`}
                  axisLine={{ stroke: axisColor }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: mutedColor, fontSize: 11 }}
                  tickFormatter={fmtAxis}
                  axisLine={{ stroke: axisColor }}
                  tickLine={false}
                  width={60}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "#5a5a7a", paddingTop: "12px" }}
                />
                <Area
                  type="monotone"
                  dataKey="Growth only"
                  stroke="#1ed688"
                  strokeWidth={1.5}
                  fill="url(#gradGrowth)"
                  strokeDasharray="4 2"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey={reinvest ? "With dividends (reinvested)" : "With dividends (cash)"}
                  stroke="#7c5cfc"
                  strokeWidth={2}
                  fill="url(#gradDiv)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Year-by-year breakdown table */}
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h3 className="text-xs font-semibold text-white">Year-by-Year Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-5 py-2.5 text-muted font-medium">Year</th>
                    <th className="text-right px-4 py-2.5 text-muted font-medium">Growth Only</th>
                    <th className="text-right px-4 py-2.5 text-muted font-medium">With Dividends</th>
                    <th className="text-right px-5 py-2.5 text-muted font-medium">Div Boost</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.filter((_, i) => i > 0 && (i % (horizon > 15 ? 5 : horizon > 10 ? 2 : 1) === 0 || i === horizon)).map((row) => {
                    const withDiv = row[reinvest ? "With dividends (reinvested)" : "With dividends (cash)"] as number;
                    const boost = withDiv - row["Growth only"];
                    return (
                      <tr key={row.year} className="border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors">
                        <td className="px-5 py-2.5 font-semibold text-white">Year {row.year}</td>
                        <td className="px-4 py-2.5 text-right text-muted">{fmt(row["Growth only"])}</td>
                        <td className="px-4 py-2.5 text-right text-white font-semibold">{fmt(withDiv)}</td>
                        <td className="px-5 py-2.5 text-right text-positive font-medium">+{fmt(boost)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
