import { useState, useCallback } from "react";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  getPortfolio, removeFromPortfolio, getPortfolioAnalytics,
  addToPortfolio, updatePortfolioItem, analyzePortfolio,
} from "../api/portfolio";
import type { RiskProfile } from "../api/portfolio";
import { getQuote } from "../api/stocks";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import {
  Trash2, Briefcase, TrendingUp, TrendingDown, DollarSign,
  Plus, Pencil, Check, X, Download, Brain, AlertTriangle,
  Globe, Activity, Shield, ChevronDown, ChevronUp, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { clsx } from "clsx";
import {
  PieChart, Pie, Cell, Tooltip, BarChart, Bar,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer,
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

const SECTOR_BETA: Record<string, number> = {
  "Technology": 1.35, "Communication Services": 1.2, "Consumer Cyclical": 1.15,
  "Financial Services": 1.1, "Industrials": 1.0, "Healthcare": 0.85,
  "Basic Materials": 0.9, "Energy": 0.95, "Real Estate": 0.75,
  "Consumer Defensive": 0.6, "Utilities": 0.5, "Other": 1.0,
};

const INTERNATIONAL_TICKERS = new Set([
  "BABA","NIO","JD","BIDU","TSM","ASML","SHOP","TM","SNY","VALE",
  "ITUB","BBD","UL","BCS","AZN","GSK","BP","RIO","BHP","SAP",
  "SONY","HMC","LYG","ING","CS","UBS","DB","SAN","VIV","ERIC",
  "NOK","INFY","WIT","VEDL","EWJ","EEM","VWO","IEMG","EFA","VXUS",
]);

const LS_RISK_KEY = "mc_risk_profile";

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
  } catch { return d; }
}

function getRiskProfile(): RiskProfile | null {
  try { return JSON.parse(localStorage.getItem(LS_RISK_KEY) ?? "null"); } catch { return null; }
}

function setRiskProfileLS(rp: RiskProfile) {
  localStorage.setItem(LS_RISK_KEY, JSON.stringify(rp));
}

function diversificationScore(holdings: Holding[]) {
  const sectors = new Set(holdings.map(h => h.sector).filter(Boolean));
  const topPct = holdings.length ? Math.max(...holdings.map(h => h.allocation_pct)) : 100;
  const sectorScore = Math.min(sectors.size / 5 * 50, 50);
  const conScore = Math.max(0, 50 - topPct);
  return { score: Math.round(Math.min(100, sectorScore + conScore)), sectors: sectors.size, topPct };
}

function portfolioBeta(holdings: Holding[], totalValue: number): number {
  if (!totalValue) return 1;
  return holdings.reduce((acc, h) => {
    const weight = h.value / totalValue;
    const beta = SECTOR_BETA[h.sector] ?? 1.0;
    return acc + weight * beta;
  }, 0);
}

function volatilityLabel(beta: number): { label: string; cls: string; color: string } {
  if (beta < 0.8) return { label: "Low", cls: "text-positive", color: "#10b981" };
  if (beta < 1.15) return { label: "Medium", cls: "text-amber-400", color: "#f59e0b" };
  return { label: "High", cls: "text-negative", color: "#ef4444" };
}

function riskBadge(rp: RiskProfile | null): { label: string; cls: string } {
  if (!rp) return { label: "Not set", cls: "text-muted" };
  if (rp.tolerance === "aggressive") return { label: "Aggressive", cls: "text-negative" };
  if (rp.tolerance === "moderate") return { label: "Moderate", cls: "text-amber-400" };
  return { label: "Conservative", cls: "text-positive" };
}

function exportCSV(items: PortfolioItem[]) {
  const header = "Ticker,Shares,Avg Buy Price\n";
  const rows = items.map(i => `${i.ticker},${i.shares},${i.avg_buy_price}`).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "portfolio.csv"; a.click();
  URL.revokeObjectURL(url);
}

/* ── Risk Profile Modal ────────────────────────────────────────────────── */
function RiskProfileModal({ onSave, onClose }: { onSave: (rp: RiskProfile) => void; onClose: () => void }) {
  const [horizon, setHorizon] = useState("medium");
  const [tolerance, setTolerance] = useState("moderate");
  const [goal, setGoal] = useState("growth");

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-white">Investment Profile</h2>
          <button onClick={onClose} className="text-muted hover:text-white"><X size={18} /></button>
        </div>
        <p className="text-xs text-muted mb-5">Answer 3 quick questions to personalise your AI analysis.</p>

        <div className="space-y-5">
          <div>
            <label className="text-xs font-semibold text-muted uppercase tracking-widest block mb-2">
              Investment Horizon
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["short", "medium", "long"] as const).map((v) => (
                <button key={v} onClick={() => setHorizon(v)}
                  className={clsx("rounded-lg border py-2 px-3 text-xs font-medium transition-colors",
                    horizon === v ? "bg-accent/20 border-accent text-white" : "border-border text-muted hover:text-white hover:border-border/80")}>
                  {v === "short" ? "< 2 years" : v === "medium" ? "2–10 years" : "10+ years"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted uppercase tracking-widest block mb-2">
              Risk Tolerance
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["conservative", "moderate", "aggressive"] as const).map((v) => (
                <button key={v} onClick={() => setTolerance(v)}
                  className={clsx("rounded-lg border py-2 px-3 text-xs font-medium transition-colors capitalize",
                    tolerance === v ? "bg-accent/20 border-accent text-white" : "border-border text-muted hover:text-white hover:border-border/80")}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted uppercase tracking-widest block mb-2">
              Primary Goal
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(["growth", "income", "preservation"] as const).map((v) => (
                <button key={v} onClick={() => setGoal(v)}
                  className={clsx("rounded-lg border py-2 px-3 text-xs font-medium transition-colors capitalize",
                    goal === v ? "bg-accent/20 border-accent text-white" : "border-border text-muted hover:text-white hover:border-border/80")}>
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          onClick={() => onSave({ horizon, tolerance, goal })}
          className="mt-6 w-full bg-accent hover:bg-accent/90 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
          Save Profile
        </button>
      </div>
    </div>
  );
}

/* ── Add Position Form ─────────────────────────────────────────────────── */
function AddPositionForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [err, setErr] = useState("");
  const qc = useQueryClient();

  const add = useMutation({
    mutationFn: () => addToPortfolio(ticker.trim().toUpperCase(), parseFloat(shares), parseFloat(price)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["portfolio-analytics"] });
      toast.success(`${ticker.toUpperCase()} added to portfolio`);
      setTicker(""); setShares(""); setPrice(""); setErr(""); setOpen(false);
      onAdded();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Failed to add position. Check the ticker.");
    },
  });

  function submit() {
    setErr("");
    if (!ticker.trim()) return setErr("Ticker is required.");
    const s = parseFloat(shares);
    const p = parseFloat(price);
    if (!s || s <= 0) return setErr("Shares must be a positive number.");
    if (!p || p <= 0) return setErr("Buy price must be a positive number.");
    add.mutate();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white rounded-xl px-4 py-2 text-sm font-semibold transition-colors">
        <Plus size={15} /> Add Position
      </button>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-white">New Position</p>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-white"><X size={15} /></button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-muted uppercase tracking-widest block mb-1">Ticker</label>
          <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="AAPL"
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent" />
        </div>
        <div>
          <label className="text-[10px] text-muted uppercase tracking-widest block mb-1">Shares</label>
          <input type="number" value={shares} onChange={e => setShares(e.target.value)} placeholder="10"
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent" />
        </div>
        <div>
          <label className="text-[10px] text-muted uppercase tracking-widest block mb-1">Avg Buy Price</label>
          <input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="150.00"
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent" />
        </div>
      </div>
      {err && <p className="text-xs text-negative mt-2">{err}</p>}
      <div className="flex gap-2 mt-3">
        <button onClick={submit} disabled={add.isPending}
          className="bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors">
          {add.isPending ? "Adding…" : "Add"}
        </button>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-white transition-colors px-3">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Allocation donut ──────────────────────────────────────────────────── */
function AllocationPie({ data, title }: { data: Array<{ name: string; value: number; pct: number }>; title: string }) {
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
          <Pie data={data} dataKey="value" cx={60} cy={60} innerRadius={34} outerRadius={56} paddingAngle={data.length > 1 ? 2 : 0}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter={(_v: any, _n: any, p: any) =>
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
          {data.length > 6 && <p className="text-[10px] text-muted pl-3.5">+{data.length - 6} more</p>}
        </div>
      </div>
    </div>
  );
}

/* ── Geographic exposure ───────────────────────────────────────────────── */
function GeoExposure({ holdings }: { holdings: Holding[] }) {
  const { theme } = useTheme();
  const tooltipStyle = {
    background: theme === "light" ? "#fff" : "#1a1a2e",
    border: `1px solid ${theme === "light" ? "#e2e8f0" : "#2a2a45"}`,
    borderRadius: 8, color: theme === "light" ? "#0f172a" : "#e2e8f0", fontSize: 12,
  };
  const totalVal = holdings.reduce((s, h) => s + h.value, 0);
  if (!totalVal) return null;
  let intl = 0;
  let us = 0;
  holdings.forEach(h => {
    if (INTERNATIONAL_TICKERS.has(h.ticker)) intl += h.value;
    else us += h.value;
  });
  const data = [
    { name: "US", value: +(us / totalVal * 100).toFixed(1) },
    { name: "International", value: +(intl / totalVal * 100).toFixed(1) },
  ];
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <Globe size={14} className="text-muted" />
        <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Geographic Exposure</p>
      </div>
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20 }}>
          <XAxis type="number" domain={[0, 100]}
            tick={{ fill: theme === "light" ? "#64748b" : "#5a5a7a", fontSize: 10 }}
            tickFormatter={v => `${v}%`} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name"
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false} tickLine={false} width={90} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v}%`]} />
          <Bar dataKey="value" radius={4}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Top holdings bar chart ────────────────────────────────────────────── */
function TopHoldingsBar({ holdings }: { holdings: Holding[] }) {
  const { theme } = useTheme();
  const mutedColor = theme === "light" ? "#64748b" : "#5a5a7a";
  const tooltipStyle = {
    background: theme === "light" ? "#fff" : "#1a1a2e",
    border: `1px solid ${theme === "light" ? "#e2e8f0" : "#2a2a45"}`,
    borderRadius: 8, color: theme === "light" ? "#0f172a" : "#e2e8f0", fontSize: 12,
  };
  const data = [...holdings]
    .sort((a, b) => b.allocation_pct - a.allocation_pct)
    .slice(0, 8)
    .map(h => ({ name: h.ticker, value: +h.allocation_pct.toFixed(1) }));
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={14} className="text-muted" />
        <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Top Holdings by Weight</p>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={theme === "light" ? "#e2e8f0" : "#2a2a45"} vertical={false} />
          <XAxis dataKey="name" tick={{ fill: mutedColor, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: mutedColor, fontSize: 10 }} axisLine={false} tickLine={false}
            tickFormatter={v => `${v}%`} width={38} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v}%`, "Weight"]} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Risk metrics strip ────────────────────────────────────────────────── */
function RiskMetrics({ holdings, totalValue }: { holdings: Holding[]; totalValue: number }) {
  const beta = portfolioBeta(holdings, totalValue);
  const vol = volatilityLabel(beta);
  const { score } = diversificationScore(holdings);
  const maxAlloc = holdings.length ? Math.max(...holdings.map(h => h.allocation_pct)) : 0;
  const concentrated = maxAlloc > 20;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Activity size={13} className="text-muted" />
          <p className="text-[10px] text-muted uppercase tracking-widest font-semibold">Portfolio Beta</p>
        </div>
        <div className="text-2xl font-bold text-white">{beta.toFixed(2)}</div>
        <div className="text-[10px] text-muted mt-0.5">vs S&amp;P 500 = 1.00</div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Activity size={13} className="text-muted" />
          <p className="text-[10px] text-muted uppercase tracking-widest font-semibold">Volatility</p>
        </div>
        <div className={clsx("text-2xl font-bold", vol.cls)}>{vol.label}</div>
        <div className="w-full h-1.5 bg-border rounded-full mt-2 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.min(beta / 1.5 * 100, 100)}%`, background: vol.color }} />
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Shield size={13} className="text-muted" />
          <p className="text-[10px] text-muted uppercase tracking-widest font-semibold">Diversification</p>
        </div>
        <div className={clsx("text-2xl font-bold",
          score >= 70 ? "text-positive" : score >= 45 ? "text-amber-400" : "text-negative")}>
          {score}
        </div>
        <div className="text-[10px] text-muted mt-0.5">out of 100</div>
      </div>

      <div className={clsx("rounded-xl border p-4",
        concentrated ? "bg-amber-500/5 border-amber-500/30" : "bg-surface border-border")}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <AlertTriangle size={13} className={concentrated ? "text-amber-400" : "text-muted"} />
          <p className="text-[10px] text-muted uppercase tracking-widest font-semibold">Concentration</p>
        </div>
        {concentrated ? (
          <>
            <div className="text-sm font-bold text-amber-400">High Risk</div>
            <div className="text-[10px] text-muted mt-0.5">Top position: {maxAlloc.toFixed(1)}%</div>
          </>
        ) : (
          <>
            <div className="text-sm font-bold text-positive">OK</div>
            <div className="text-[10px] text-muted mt-0.5">Top: {maxAlloc.toFixed(1)}% (&lt;20%)</div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Diversification panel ─────────────────────────────────────────────── */
function DiversificationPanel({ holdings }: { holdings: Holding[] }) {
  const { score, sectors, topPct } = diversificationScore(holdings);
  const { label, cls } =
    score >= 80 ? { label: "Excellent", cls: "text-positive" }
    : score >= 60 ? { label: "Good", cls: "text-amber-400" }
    : score >= 40 ? { label: "Fair", cls: "text-orange-400" }
    : { label: "Concentrated", cls: "text-negative" };
  return (
    <div className="bg-surface rounded-xl border border-border p-4 flex flex-col">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Diversification</p>
      <div className="flex-1 flex flex-col items-center justify-center py-2 gap-1">
        <div className={clsx("text-5xl font-bold tabular-nums", cls)}>{score}</div>
        <div className={clsx("text-xs font-semibold", cls)}>{label}</div>
        <div className="w-full h-1.5 bg-border rounded-full mt-2 overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${score}%` }} />
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
  const gridColor = theme === "light" ? "#e2e8f0" : "#2a2a45";
  const mutedColor = theme === "light" ? "#64748b" : "#5a5a7a";
  const tooltipStyle = {
    background: theme === "light" ? "#fff" : "#1a1a2e",
    border: `1px solid ${gridColor}`, borderRadius: 8,
    color: theme === "light" ? "#0f172a" : "#e2e8f0", fontSize: 12,
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
  const positive = latestPnl >= 0;
  const lineColor = positive ? "#1ed688" : "#ff5c5c";
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
            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: mutedColor, fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: mutedColor, fontSize: 10 }} axisLine={false} tickLine={false}
            tickFormatter={v => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString()}`} width={68} />
          <ReferenceLine y={0} stroke={gridColor} strokeDasharray="4 4" />
          <Tooltip contentStyle={tooltipStyle}
            formatter={(v: any) => [`${v >= 0 ? "+" : "−"}$${fmtMoney(Math.abs(v))}`, "P&L"]}
            labelFormatter={(d: any) => fmtDate(d)} />
          <Area type="monotone" dataKey="pnl" stroke={lineColor} strokeWidth={2}
            fill="url(#pnlGrad)" dot={chartData.length <= 14} activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Holding list (hoisted to module scope to avoid remount on every render) */
function HoldingList({ items, label }: { items: Holding[]; label: string }) {
  return (
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
}

/* ── Performers panel ──────────────────────────────────────────────────── */
function PerformersPanel({ holdings }: { holdings: Holding[] }) {
  const sorted = [...holdings].sort((a, b) => b.pnl_pct - a.pnl_pct);
  const best = sorted.slice(0, 3);
  const worst = [...sorted].reverse().slice(0, 3);
  return (
    <div className="grid grid-cols-2 gap-4">
      <HoldingList items={best} label="Top Performers" />
      <HoldingList items={worst} label="Worst Performers" />
    </div>
  );
}

/* ── AI Analysis Panel ─────────────────────────────────────────────────── */
interface AIAnalysis {
  summary?: string;
  strengths?: string[];
  risks?: string[];
  recommendations?: { title: string; detail: string }[];
  beginner_explanation?: string;
  raw?: string;
}

function AIAnalysisPanel({
  holdings, riskProfile, totalValue, totalPnlPct,
}: {
  holdings: Holding[];
  riskProfile: RiskProfile | null;
  totalValue: number;
  totalPnlPct: number;
}) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showBeginner, setShowBeginner] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setError(""); setAnalysis(null);
    try {
      const result = await analyzePortfolio(holdings, riskProfile, totalValue, totalPnlPct);
      setAnalysis(result);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        setError("AI analysis is not configured on this server. Contact your administrator.");
      } else if (status === 502) {
        setError("AI service returned an error. Please try again later.");
      } else {
        setError("AI analysis failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [holdings, riskProfile, totalValue, totalPnlPct]);

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <Brain size={16} className="text-accent-light" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">AI Portfolio Analysis</p>
            <p className="text-[10px] text-muted">Powered by Claude</p>
          </div>
        </div>
        <button onClick={run} disabled={loading || holdings.length === 0}
          className="flex items-center gap-2 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-xl px-4 py-2 text-xs font-semibold transition-colors">
          {loading ? (
            <><span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin inline-block" /> Analyzing…</>
          ) : (
            <><Brain size={13} /> Analyze My Portfolio</>
          )}
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between bg-negative/10 border border-negative/20 rounded-xl px-4 py-3 text-xs text-negative">
          {error}
          <button onClick={run} className="ml-3 underline">Retry</button>
        </div>
      )}

      {loading && (
        <div className="space-y-3 py-2">
          {[100, 80, 90, 70].map((w, i) => (
            <div key={i} className="h-4 bg-surface-hover rounded-full animate-pulse" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}

      {analysis && !loading && (
        <div className="space-y-4">
          {analysis.summary && (
            <div className="bg-surface-hover rounded-xl p-4">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Overall Summary</p>
              <p className="text-sm text-white leading-relaxed">{analysis.summary}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {analysis.strengths && analysis.strengths.length > 0 && (
              <div className="bg-positive/5 border border-positive/20 rounded-xl p-4">
                <p className="text-[10px] font-semibold text-positive uppercase tracking-widest mb-2">Key Strengths</p>
                <ul className="space-y-1.5">
                  {analysis.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-white">
                      <span className="text-positive mt-0.5 shrink-0">✓</span>{s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.risks && analysis.risks.length > 0 && (
              <div className="bg-negative/5 border border-negative/20 rounded-xl p-4">
                <p className="text-[10px] font-semibold text-negative uppercase tracking-widest mb-2">Key Risks</p>
                <ul className="space-y-1.5">
                  {analysis.risks.map((r, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-white">
                      <span className="text-negative mt-0.5 shrink-0">⚠</span>{r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {analysis.recommendations && analysis.recommendations.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-2">Recommendations</p>
              <div className="space-y-2">
                {analysis.recommendations.map((rec, i) => (
                  <div key={i} className="bg-surface-hover rounded-xl p-4 flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-accent/20 text-accent-light text-xs font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white mb-0.5">{rec.title}</p>
                      <p className="text-xs text-muted leading-relaxed">{rec.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {analysis.beginner_explanation && (
            <div>
              <button onClick={() => setShowBeginner(v => !v)}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors">
                {showBeginner ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {showBeginner ? "Hide" : "Show"} plain-language explanation
              </button>
              {showBeginner && (
                <div className="mt-2 bg-surface-hover rounded-xl p-4 text-xs text-white leading-relaxed border border-border">
                  {analysis.beginner_explanation}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!analysis && !loading && !error && (
        <p className="text-xs text-muted text-center py-4">
          Click "Analyze My Portfolio" to get AI-powered insights on your holdings.
        </p>
      )}
    </div>
  );
}

/* ── Analytics section ─────────────────────────────────────────────────── */
function AnalyticsPanel({ riskProfile }: { riskProfile: RiskProfile | null }) {
  const { data: analytics, isLoading, isError } = useQuery({
    queryKey: ["portfolio-analytics"],
    queryFn: getPortfolioAnalytics,
    staleTime: 2 * 60_000,
    gcTime: 5 * 60_000,
  });

  if (isError) return (
    <div className="mb-6 bg-surface rounded-xl border border-border p-5 text-center text-xs text-muted">
      Analytics unavailable — failed to load portfolio data.
    </div>
  );

  if (isLoading) return (
    <div className="space-y-4 mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-28 bg-surface rounded-xl border border-border animate-pulse" />)}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[0, 1, 2].map(i => <div key={i} className="h-48 bg-surface rounded-xl border border-border animate-pulse" />)}
      </div>
      <p className="text-center text-xs text-muted">Loading analytics…</p>
    </div>
  );

  if (!analytics?.holdings?.length) return null;

  const { holdings, snapshots } = analytics as { holdings: Holding[]; snapshots: Snapshot[] };
  const totalVal = holdings.reduce((s: number, h: Holding) => s + h.value, 0);
  const totalCost = holdings.reduce((s: number, h: Holding) => s + h.cost, 0);
  const totalPnlPct = totalCost > 0 ? (totalVal - totalCost) / totalCost * 100 : 0;

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
      <RiskMetrics holdings={holdings} totalValue={totalVal} />

      <div className="grid grid-cols-3 gap-4">
        <AllocationPie data={holdingPie} title="Allocation — By Holding" />
        <AllocationPie data={sectorPie} title="Allocation — By Sector" />
        <DiversificationPanel holdings={holdings} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <GeoExposure holdings={holdings} />
        <TopHoldingsBar holdings={holdings} />
      </div>

      <PnlHistoryChart snapshots={snapshots} />

      {holdings.length >= 2 && <PerformersPanel holdings={holdings} />}

      <AIAnalysisPanel
        holdings={holdings}
        riskProfile={riskProfile}
        totalValue={totalVal}
        totalPnlPct={totalPnlPct}
      />
    </div>
  );
}

/* ── Holdings table row ────────────────────────────────────────────────── */
function PortfolioRow({ item }: { item: PortfolioItem }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editShares, setEditShares] = useState(String(item.shares));
  const [editPrice, setEditPrice] = useState(String(item.avg_buy_price));

  const { data: quote } = useQuery({
    queryKey: ["quote", item.ticker],
    queryFn: () => getQuote(item.ticker),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const currentPrice = quote?.price as number | undefined;
  const price = currentPrice ?? item.avg_buy_price;
  const priceLoaded = currentPrice != null;
  const cost = item.shares * item.avg_buy_price;
  const value = item.shares * price;
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const positive = pnl >= 0;

  const del = useMutation({
    mutationFn: () => removeFromPortfolio(item.ticker),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["portfolio"] });
      const prev = qc.getQueryData<{ items?: { ticker: string }[] }>(["portfolio"]);
      if (prev?.items) qc.setQueryData(["portfolio"], { ...prev, items: prev.items.filter(i => i.ticker !== item.ticker) });
      return { prev };
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portfolio-analytics"] }); toast.success(`${item.ticker} removed`); },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["portfolio"], ctx.prev); toast.error("Failed to remove"); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["portfolio"] }),
  });

  const editMut = useMutation({
    mutationFn: () => updatePortfolioItem(item.ticker, parseFloat(editShares), parseFloat(editPrice)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["portfolio-analytics"] });
      toast.success(`${item.ticker} updated`);
      setEditing(false);
    },
    onError: () => toast.error("Failed to update"),
  });

  if (editing) {
    return (
      <tr className="border-b border-border/50 bg-surface-hover/30">
        <td className="py-2 px-5 font-semibold text-sm text-white">{item.ticker}</td>
        <td className="py-2 px-4 text-right">
          <input value={editShares} onChange={e => setEditShares(e.target.value)} type="number"
            className="w-20 bg-surface border border-border rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-accent" />
        </td>
        <td className="py-2 px-4 text-right text-sm text-white">
          {priceLoaded ? `$${price.toFixed(2)}` : <span className="text-muted">—</span>}
        </td>
        <td className="py-2 px-4 text-right">
          <input value={editPrice} onChange={e => setEditPrice(e.target.value)} type="number"
            className="w-24 bg-surface border border-border rounded px-2 py-1 text-xs text-white text-right focus:outline-none focus:border-accent" />
        </td>
        <td className="py-2 px-4" />
        <td className="py-2 px-4" />
        <td className="py-2 px-5 text-right">
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => {
              const s = parseFloat(editShares);
              const p = parseFloat(editPrice);
              if (!isFinite(s) || s <= 0 || !isFinite(p) || p <= 0) {
                toast.error("Shares and price must be positive numbers.");
                return;
              }
              editMut.mutate();
            }} disabled={editMut.isPending} className="text-positive hover:text-positive/80"><Check size={14} /></button>
            <button onClick={() => setEditing(false)} className="text-muted hover:text-white"><X size={14} /></button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors group">
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
        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(true)} className="text-muted hover:text-white transition-colors"><Pencil size={13} /></button>
          <button onClick={() => del.mutate()} disabled={del.isPending} className="text-muted hover:text-negative transition-colors"><Trash2 size={13} /></button>
        </div>
      </td>
    </tr>
  );
}

/* ── Summary banner ────────────────────────────────────────────────────── */
function PortfolioSummary({ items }: { items: PortfolioItem[] }) {
  const results = useQueries({
    queries: items.map(item => ({
      queryKey: ["quote", item.ticker],
      queryFn: () => getQuote(item.ticker),
      staleTime: 60_000, refetchInterval: 60_000,
    })),
  });
  const quotes = items.map((item, i) => ({ item, price: (results[i].data?.price as number) ?? item.avg_buy_price }));
  const totalCost = quotes.reduce((s, q) => s + q.item.shares * q.item.avg_buy_price, 0);
  const totalValue = quotes.reduce((s, q) => s + q.item.shares * q.price, 0);
  const totalPnl = totalValue - totalCost;
  const totalPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const positive = totalPnl >= 0;
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
  const qc = useQueryClient();
  const [riskProfile, setRiskProfile] = useState<RiskProfile | null>(getRiskProfile);
  const [showRiskModal, setShowRiskModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["portfolio"],
    queryFn: getPortfolio,
    enabled: !!user,
  });

  const saveRiskProfile = (rp: RiskProfile) => {
    setRiskProfileLS(rp);
    setRiskProfile(rp);
    setShowRiskModal(false);
    toast.success("Risk profile saved");
  };

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

  const { label: riskLabel, cls: riskCls } = riskBadge(riskProfile);

  return (
    <div className="p-6">
      {showRiskModal && (
        <RiskProfileModal onSave={saveRiskProfile} onClose={() => setShowRiskModal(false)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-white">Portfolio</h1>
          <button
            onClick={() => setShowRiskModal(true)}
            className={clsx(
              "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors",
              riskProfile
                ? "border-current/30 hover:opacity-80"
                : "text-muted border-border hover:text-white",
              riskCls,
            )}>
            <Shield size={11} /> {riskLabel}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <button onClick={() => exportCSV(items)}
              className="flex items-center gap-1.5 text-xs text-muted hover:text-white border border-border hover:border-border/80 rounded-xl px-3 py-2 transition-colors">
              <Download size={13} /> Export CSV
            </button>
          )}
          <AddPositionForm onAdded={() => qc.invalidateQueries({ queryKey: ["portfolio-analytics"] })} />
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Briefcase size={40} className="text-muted mb-3" />
          <p className="text-sm text-muted">Portfolio is empty — add your first position above.</p>
        </div>
      ) : (
        <>
          <PortfolioSummary items={items} />
          <AnalyticsPanel riskProfile={riskProfile} />

          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Holdings</span>
              <span className="text-[10px] text-muted">Prices auto-refresh every 60s</span>
            </div>
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
        </>
      )}
    </div>
  );
}
