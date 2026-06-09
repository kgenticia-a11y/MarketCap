import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getPortfolio, removeFromPortfolio, getPortfolioAnalytics } from "../api/portfolio";
import { getQuote } from "../api/stocks";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { Trash2, Briefcase, TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { toast } from "sonner";
import { clsx } from "clsx";
import {
  PieChart, Pie, Cell, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer,
} from "recharts";

/* ── Types ─────────────────────────────────────────────────────────────── */
interface PortfolioItem { id: number; ticker: string; shares: number; avg_buy_price: number; }
interface Holding {
  ticker: string; name: string; sector: string;
  shares: number; avg_buy_price: number; current_price: number;
  cost: number; value: number; pnl: number; pnl_pct: number; allocation_pct: number;
}
interface Snapshot { date: string; value: number; cost: number; }

/* ── Constants ─────────────────────────────────────────────────────────── */
const PIE_COLORS = [
  "#7c5cfc","#06b6d4","#10b981","#f97316",
  "#ec4899","#3b82f6","#f59e0b","#8b5cf6","#14b8a6","#ef4444",
];

/* ── Helpers ───────────────────────────────────────────────────────────── */
function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string) {
  try {
    const [, m, day] = d.split("-");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const label = `${months[parseInt(m) - 1]} ${parseInt(day)}`;
    return label.includes("undefined") ? d : label;
  } catch {
    return d;
  }
}

function diversificationScore(holdings: Holding[]) {
  const sectors = new Set(holdings.map(h => h.sector).filter(Boolean));
  const topPct = holdings.length ? Math.max(...holdings.map(h => h.allocation_pct)) : 100;
  const sectorScore = Math.min(sectors.size / 5 * 50, 50);
  const conScore = Math.max(0, 50 - topPct);
  return { score: Math.round(Math.min(100, sectorScore + conScore)), sectors: sectors.size, topPct };
}

/* ── Allocation donut ──────────────────────────────────────────────────── */
function AllocationPie({
  data, title,
}: { data: Array<{ name: string; value: number; pct: number }>; title: string }) {
  const { theme } = useTheme();
  const tooltipStyle = {
    background: theme === "light" ? "#fff" : "#1a1a2e",
    border: `1px solid ${theme === "light" ? "#e2e8f0" : "#2a2a45"}`,
    borderRadius: 8, color: theme === "light" ? "#0f172a" : "#e2e8f0", fontSize: 12,
  };

  return (
    <div className="bg-surface rounded-xl border border-border p-4 flex flex-col gap-3">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">{title}</p>
      <div className="flex items-center gap-3">
        <PieChart width={120} height={120}>
          <Pie data={data} dataKey="value" cx={60} cy={60}
            innerRadius={34} outerRadius={56} paddingAngle={data.length > 1 ? 2 : 0}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle}
            formatter={(_: any, __: any, p: any) =>
              [`${p.payload.pct.toFixed(1)}%`, p.payload.name]} />
        </PieChart>

        <div className="flex-1 space-y-1.5 min-w-0">
          {data.slice(0, 6).map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 min-w-0">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="text-xs text-white truncate flex-1">{d.name}</span>
              <span className="text-[10px] text-muted shrink-0">{d.pct.toFixed(1)}%</span>
            </div>
          ))}
          {data.length > 6 && (
            <p className="text-[10px] text-muted pl-3.5">+{data.length - 6} more</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Diversification score ─────────────────────────────────────────────── */
function DiversificationPanel({ holdings }: { holdings: Holding[] }) {
  const { score, sectors, topPct } = diversificationScore(holdings);
  const { label, cls } =
    score >= 80 ? { label: "Excellent", cls: "text-positive" }
    : score >= 60 ? { label: "Good",     cls: "text-amber-400" }
    : score >= 40 ? { label: "Fair",     cls: "text-orange-400" }
    : { label: "Concentrated", cls: "text-negative" };

  return (
    <div className="bg-surface rounded-xl border border-border p-4 flex flex-col">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Diversification</p>
      <div className="flex-1 flex flex-col items-center justify-center py-2 gap-1">
        <div className={clsx("text-5xl font-bold tabular-nums", cls)}>{score}</div>
        <div className={clsx("text-xs font-semibold", cls)}>{label}</div>
        <div className="w-full h-1.5 bg-border rounded-full mt-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-700"
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 pt-3 mt-2 border-t border-border/50 text-center">
        <div>
          <div className="text-sm font-bold text-white">{sectors}</div>
          <div className="text-[10px] text-muted">Sectors</div>
        </div>
        <div>
          <div className="text-sm font-bold text-white">{holdings.length}</div>
          <div className="text-[10px] text-muted">Holdings</div>
        </div>
        <div>
          <div className="text-sm font-bold text-white">{topPct.toFixed(0)}%</div>
          <div className="text-[10px] text-muted">Top pos.</div>
        </div>
      </div>
    </div>
  );
}

/* ── P&L history chart ─────────────────────────────────────────────────── */
function PnlHistoryChart({ snapshots }: { snapshots: Snapshot[] }) {
  const { theme } = useTheme();
  const gridColor  = theme === "light" ? "#e2e8f0" : "#2a2a45";
  const mutedColor = theme === "light" ? "#64748b" : "#5a5a7a";
  const tooltipStyle = {
    background: theme === "light" ? "#fff" : "#1a1a2e",
    border: `1px solid ${gridColor}`,
    borderRadius: 8, color: theme === "light" ? "#0f172a" : "#e2e8f0", fontSize: 12,
  };

  if (snapshots.length < 2) {
    return (
      <div className="bg-surface rounded-xl border border-border p-5">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">P&amp;L History</p>
        <div className="h-16 flex items-center justify-center text-xs text-muted">
          History builds daily — check back tomorrow to see your P&amp;L trend.
        </div>
      </div>
    );
  }

  const chartData = snapshots.map(s => ({ date: s.date, pnl: +(s.value - s.cost).toFixed(2) }));
  const latestPnl = chartData[chartData.length - 1]?.pnl ?? 0;
  const positive  = latestPnl >= 0;
  const lineColor = positive ? "#1ed688" : "#ff5c5c";
  const gradId    = "pnlGrad";

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">P&amp;L History</p>
        <span className={clsx("text-sm font-bold", positive ? "text-positive" : "text-negative")}>
          {positive ? "+" : "−"}${fmtMoney(Math.abs(latestPnl))}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={lineColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate}
            tick={{ fill: mutedColor, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: mutedColor, fontSize: 10 }} axisLine={false} tickLine={false}
            tickFormatter={v => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString()}`} width={68} />
          <ReferenceLine y={0} stroke={gridColor} strokeDasharray="4 4" />
          <Tooltip contentStyle={tooltipStyle}
            formatter={(v: any) => [`${v >= 0 ? "+" : "−"}$${fmtMoney(Math.abs(v))}`, "P&L"]}
            labelFormatter={(d: any) => fmtDate(d)} />
          <Area type="monotone" dataKey="pnl" stroke={lineColor} strokeWidth={2}
            fill={`url(#${gradId})`} dot={chartData.length <= 14} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Best / Worst performers ───────────────────────────────────────────── */
function PerformersPanel({ holdings }: { holdings: Holding[] }) {
  const sorted = [...holdings].sort((a, b) => b.pnl_pct - a.pnl_pct);
  const best  = sorted.slice(0, 3);
  const worst = [...sorted].reverse().slice(0, 3);

  const HoldingList = ({ items, label }: { items: Holding[]; label: string }) => (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">{label}</p>
      <div className="space-y-1">
        {items.map(h => (
          <Link key={h.ticker} to={`/stock/${h.ticker}`}
            className="flex items-center gap-3 rounded-lg px-2 py-2 -mx-2 hover:bg-surface-hover transition-colors">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white">{h.ticker}</div>
              <div className="text-[10px] text-muted truncate">{h.name}</div>
            </div>
            <div className="text-right shrink-0">
              <div className={clsx("text-sm font-semibold", h.pnl >= 0 ? "text-positive" : "text-negative")}>
                {h.pnl >= 0 ? "+" : "−"}${fmtMoney(Math.abs(h.pnl))}
              </div>
              <div className={clsx("text-[10px]", h.pnl_pct >= 0 ? "text-positive" : "text-negative")}>
                {h.pnl_pct >= 0 ? "+" : ""}{h.pnl_pct.toFixed(2)}%
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-4">
      <HoldingList items={best}  label="Top Performers"   />
      <HoldingList items={worst} label="Worst Performers" />
    </div>
  );
}

/* ── Analytics section (async) ─────────────────────────────────────────── */
function AnalyticsPanel() {
  const { data: analytics, isLoading, isError } = useQuery({
    queryKey:  ["portfolio-analytics"],
    queryFn:   getPortfolioAnalytics,
    staleTime: 2 * 60_000,
    gcTime:    5 * 60_000,
  });

  if (isError) {
    return (
      <div className="mb-6 bg-surface rounded-xl border border-border p-5 text-center text-xs text-muted">
        Analytics unavailable — failed to load portfolio data.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-48 bg-surface rounded-xl border border-border animate-pulse" />
          ))}
        </div>
        <div className="h-60 bg-surface rounded-xl border border-border animate-pulse" />
        <div className="grid grid-cols-2 gap-4">
          {[0, 1].map(i => (
            <div key={i} className="h-40 bg-surface rounded-xl border border-border animate-pulse" />
          ))}
        </div>
        <p className="text-center text-xs text-muted -mt-2">Loading analytics…</p>
      </div>
    );
  }

  if (!analytics?.holdings?.length) return null;

  const { holdings, snapshots } = analytics as { holdings: Holding[]; snapshots: Snapshot[] };
  const totalVal = holdings.reduce((s: number, h: Holding) => s + h.value, 0);

  const holdingPie = [...holdings]
    .sort((a, b) => b.value - a.value)
    .map(h => ({ name: h.ticker, value: h.value, pct: h.allocation_pct }));

  const sectorMap = new Map<string, number>();
  holdings.forEach((h: Holding) => sectorMap.set(h.sector || "Other", (sectorMap.get(h.sector || "Other") ?? 0) + h.value));
  const sectorPie = Array.from(sectorMap.entries())
    .map(([name, value]) => ({ name, value, pct: totalVal > 0 ? value / totalVal * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-3 gap-4">
        <AllocationPie data={holdingPie} title="Allocation — By Holding" />
        <AllocationPie data={sectorPie}  title="Allocation — By Sector"  />
        <DiversificationPanel holdings={holdings} />
      </div>
      <PnlHistoryChart snapshots={snapshots} />
      {holdings.length >= 2 && <PerformersPanel holdings={holdings} />}
    </div>
  );
}

/* ── Holdings table row ────────────────────────────────────────────────── */
function PortfolioRow({ item }: { item: PortfolioItem }) {
  const qc = useQueryClient();
  const { data: quote } = useQuery({
    queryKey: ["quote", item.ticker],
    queryFn:  () => getQuote(item.ticker),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const currentPrice = quote?.price as number | undefined;
  const price        = currentPrice ?? item.avg_buy_price;
  const priceLoaded  = currentPrice != null;
  const cost         = item.shares * item.avg_buy_price;
  const value        = item.shares * price;
  const pnl          = value - cost;
  const pnlPct       = cost > 0 ? (pnl / cost) * 100 : 0;
  const positive     = pnl >= 0;

  const del = useMutation({
    mutationFn: () => removeFromPortfolio(item.ticker),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["portfolio"] });
      const prev = qc.getQueryData<{ items?: { ticker: string }[] }>(["portfolio"]);
      if (prev?.items) {
        qc.setQueryData(["portfolio"], { ...prev, items: prev.items.filter(i => i.ticker !== item.ticker) });
      }
      return { prev };
    },
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["portfolio-analytics"] });
      toast.success(`${item.ticker} removed from portfolio`);
    },
    onError:    (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["portfolio"], ctx.prev);
      toast.error("Failed to remove from portfolio");
    },
    onSettled:  () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });

  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors">
      <td className="py-3 px-5">
        <Link to={`/stock/${item.ticker}`} className="font-semibold text-white hover:text-accent-light transition-colors text-sm">
          {item.ticker}
        </Link>
      </td>
      <td className="py-3 px-4 text-right text-sm text-white">{item.shares}</td>
      <td className="py-3 px-4 text-right text-sm text-white">
        {priceLoaded ? `$${price.toFixed(2)}` : <span className="text-muted">—</span>}
      </td>
      <td className="py-3 px-4 text-right text-sm text-muted">${item.avg_buy_price.toFixed(2)}</td>
      <td className="py-3 px-4 text-right text-sm text-white">
        {priceLoaded ? `$${fmtMoney(value)}` : <span className="text-muted">—</span>}
      </td>
      <td className={clsx("py-3 px-4 text-right text-sm font-medium", positive ? "text-positive" : "text-negative")}>
        {priceLoaded
          ? <>{positive ? "+" : "−"}${fmtMoney(Math.abs(pnl))}{" "}<span className="text-xs opacity-70">({positive ? "+" : ""}{pnlPct.toFixed(2)}%)</span></>
          : <span className="text-muted">—</span>}
      </td>
      <td className="py-3 px-5 text-right">
        <button onClick={() => del.mutate()} disabled={del.isPending} className="text-muted hover:text-negative transition-colors">
          <Trash2 size={14} />
        </button>
      </td>
    </tr>
  );
}

/* ── Summary banner ────────────────────────────────────────────────────── */
function PortfolioSummary({ items }: { items: PortfolioItem[] }) {
  const results = useQueries({
    queries: items.map(item => ({
      queryKey: ["quote", item.ticker],
      queryFn:  () => getQuote(item.ticker),
      staleTime: 30_000, refetchInterval: 30_000,
    })),
  });

  const quotes = items.map((item, i) => ({ item, price: (results[i].data?.price as number) ?? item.avg_buy_price }));
  const totalCost  = quotes.reduce((s, q) => s + q.item.shares * q.item.avg_buy_price, 0);
  const totalValue = quotes.reduce((s, q) => s + q.item.shares * q.price, 0);
  const totalPnl   = totalValue - totalCost;
  const totalPct   = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const positive   = totalPnl >= 0;

  return (
    <div className="grid grid-cols-3 gap-4 mb-6">
      <div className="bg-surface rounded-xl border border-border p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
          <DollarSign size={18} className="text-accent-light" />
        </div>
        <div>
          <div className="text-[10px] text-muted uppercase tracking-widest mb-0.5">Total Invested</div>
          <div className="text-lg font-bold text-white">${fmtMoney(totalCost)}</div>
        </div>
      </div>
      <div className="bg-surface rounded-xl border border-border p-5 flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
          <Briefcase size={18} className="text-accent-light" />
        </div>
        <div>
          <div className="text-[10px] text-muted uppercase tracking-widest mb-0.5">Current Value</div>
          <div className="text-lg font-bold text-white">${fmtMoney(totalValue)}</div>
        </div>
      </div>
      <div className={clsx("rounded-xl border p-5 flex items-center gap-4",
        positive ? "bg-positive/5 border-positive/20" : "bg-negative/5 border-negative/20")}>
        <div className={clsx("w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
          positive ? "bg-positive/10" : "bg-negative/10")}>
          {positive ? <TrendingUp size={18} className="text-positive" /> : <TrendingDown size={18} className="text-negative" />}
        </div>
        <div>
          <div className="text-[10px] text-muted uppercase tracking-widest mb-0.5">Total P&amp;L</div>
          <div className={clsx("text-lg font-bold", positive ? "text-positive" : "text-negative")}>
            {positive ? "+" : "−"}${fmtMoney(Math.abs(totalPnl))}
          </div>
          <div className={clsx("text-xs font-medium", positive ? "text-positive" : "text-negative")}>
            {positive ? "+" : ""}{totalPct.toFixed(2)}%
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────── */
export default function Portfolio() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["portfolio"],
    queryFn:  getPortfolio,
    enabled:  !!user,
  });

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Briefcase size={40} className="text-muted mb-3" />
        <p className="text-sm text-muted">
          <Link to="/login" className="text-accent-light hover:text-accent">Sign in</Link> to view your portfolio.
        </p>
      </div>
    );
  }

  const items: PortfolioItem[] = data?.items ?? [];

  if (isLoading) {
    return (
      <div className="p-6 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-surface rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Briefcase size={40} className="text-muted mb-3" />
        <p className="text-sm text-muted">Portfolio is empty — search for a stock and add it.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PortfolioSummary items={items} />
      <AnalyticsPanel />
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              {["Ticker","Shares","Current","Avg Cost","Value","P&L",""].map(h => (
                <th key={h} className={clsx("py-3 text-muted font-medium",
                  h === "" ? "px-5" : "px-4",
                  h === "Ticker" ? "text-left px-5" : "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(item => <PortfolioRow key={item.id} item={item} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}
