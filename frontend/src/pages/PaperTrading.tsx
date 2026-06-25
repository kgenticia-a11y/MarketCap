import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { toast } from "sonner";
import {
  FlaskConical, AlertTriangle, TrendingUp, TrendingDown, DollarSign,
  Wallet, X, ArrowUpRight, ArrowDownRight, RefreshCw, History as HistoryIcon, BarChart3,
  LineChart as LineChartIcon, Sparkles,
} from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, LineChart, Line, XAxis, YAxis, ResponsiveContainer, Legend } from "recharts";
import {
  getPaperState, setupPaperTrading, getPaperAnalytics,
  executePaperTrade, listPaperTrades, resetPaperTrading, runBacktest,
  type PaperAnalytics, type PaperHolding, type PaperTrade,
  type StrategyKey, type StrategyPeriod, type StrategyFrequency, type BacktestResult,
} from "../api/paperTrading";
import { getPortfolioAnalytics } from "../api/portfolio";
import { getQuote, searchStocks } from "../api/stocks";
import { useTheme } from "../context/ThemeContext";

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const PIE_COLORS = [
  "#7c5cfc","#06b6d4","#10b981","#f97316",
  "#ec4899","#3b82f6","#f59e0b","#8b5cf6","#14b8a6","#ef4444",
];

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDateTime(s: string) {
  try {
    const d = new Date(s);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return s; }
}

/* ── Setup modal ─────────────────────────────────────────────────────────── */
function SetupModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [cash, setCash] = useState("10000");
  const [err, setErr] = useState("");
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: () => setupPaperTrading(parseFloat(cash)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paper-state"] });
      qc.invalidateQueries({ queryKey: ["paper-analytics"] });
      toast.success("Paper trading started");
      onCreated();
    },
    onError: () => setErr("Failed to set up paper trading. Try again."),
  });

  function submit() {
    setErr("");
    const v = parseFloat(cash);
    if (!v || v <= 0) return setErr("Enter a positive virtual cash amount.");
    if (v > 10_000_000) return setErr("Maximum is $10,000,000.");
    m.mutate();
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <FlaskConical size={16} className="text-amber-400" />
            </div>
            <h2 className="text-base font-bold text-white">Start Paper Trading</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white"><X size={18} /></button>
        </div>
        <p className="text-xs text-muted mb-5 leading-relaxed">
          Practice trading with virtual cash. None of these trades touch your real portfolio.
        </p>

        <label className="text-[10px] font-semibold text-muted uppercase tracking-widest block mb-2">
          Virtual Cash Balance
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
          <input
            type="number" value={cash} onChange={e => setCash(e.target.value)}
            className="w-full bg-surface-hover border border-border rounded-lg pl-7 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent"
            placeholder="10000"
          />
        </div>
        <div className="flex gap-2 mt-3">
          {[5000, 10000, 25000, 100000].map(v => (
            <button key={v} onClick={() => setCash(String(v))}
              className="text-[10px] px-2.5 py-1 rounded-full border border-border text-muted hover:text-white hover:border-border/80">
              ${v.toLocaleString()}
            </button>
          ))}
        </div>
        {err && <p className="text-xs text-negative mt-3">{err}</p>}
        <button
          onClick={submit} disabled={m.isPending}
          className="mt-5 w-full bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
          {m.isPending ? "Setting up…" : "Start Paper Trading"}
        </button>
      </div>
    </div>
  );
}

/* ── Trade modal ─────────────────────────────────────────────────────────── */
function TradeModal({
  initialTicker, initialSide, cashBalance, currentHoldings, onClose, onExecuted,
}: {
  initialTicker?: string;
  initialSide?: "buy" | "sell";
  cashBalance: number;
  currentHoldings: PaperHolding[];
  onClose: () => void;
  onExecuted: () => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">(initialSide ?? "buy");
  const [ticker, setTicker] = useState(initialTicker ?? "");
  const [mode, setMode] = useState<"shares" | "dollars">("shares");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [err, setErr] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const qc = useQueryClient();

  const debounced = ticker.trim().toUpperCase();
  const { data: quote, isLoading: priceLoading } = useQuery({
    queryKey: ["quote", debounced],
    queryFn: () => getQuote(debounced),
    enabled: debounced.length >= 1,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: results } = useQuery({
    queryKey: ["search", ticker],
    queryFn: () => searchStocks(ticker),
    enabled: searchOpen && ticker.length >= 1,
    staleTime: 60_000,
  });

  const price = (quote?.price as number | undefined) ?? null;
  const numericAmount = parseFloat(amount) || 0;
  const estimatedShares = mode === "shares"
    ? numericAmount
    : (price ? numericAmount / price : 0);
  const estimatedTotal = price ? estimatedShares * price : 0;

  const holding = currentHoldings.find(h => h.ticker === debounced);
  const maxSell = holding?.shares ?? 0;

  const m = useMutation({
    mutationFn: () => executePaperTrade({
      ticker: debounced,
      side,
      ...(mode === "shares"
        ? { shares: numericAmount }
        : { dollar_amount: numericAmount }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paper-state"] });
      qc.invalidateQueries({ queryKey: ["paper-analytics"] });
      qc.invalidateQueries({ queryKey: ["paper-trades"] });
      toast.success(`${side === "buy" ? "Bought" : "Sold"} ${estimatedShares.toFixed(4)} ${debounced}`);
      onExecuted();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Trade failed.");
      setStep("input");
    },
  });

  function next() {
    setErr("");
    if (!debounced) return setErr("Enter a ticker.");
    if (!price) return setErr("Waiting for live price…");
    if (!numericAmount || numericAmount <= 0) return setErr("Enter a valid amount.");
    if (side === "buy" && estimatedTotal > cashBalance + 1e-6) {
      return setErr(`Insufficient virtual cash. Need $${fmtMoney(estimatedTotal)}, have $${fmtMoney(cashBalance)}.`);
    }
    if (side === "sell" && estimatedShares > maxSell + 1e-9) {
      return setErr(`You only hold ${maxSell} shares of ${debounced}.`);
    }
    setStep("confirm");
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-white">
            {step === "confirm" ? "Confirm Trade" : "Paper Trade"}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-white"><X size={18} /></button>
        </div>

        {step === "input" ? (
          <>
            {/* Buy/Sell toggle */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button onClick={() => setSide("buy")}
                className={clsx("rounded-lg py-2 text-xs font-semibold transition-colors",
                  side === "buy" ? "bg-positive/20 border border-positive text-positive" : "border border-border text-muted hover:text-white")}>
                BUY
              </button>
              <button onClick={() => setSide("sell")}
                className={clsx("rounded-lg py-2 text-xs font-semibold transition-colors",
                  side === "sell" ? "bg-negative/20 border border-negative text-negative" : "border border-border text-muted hover:text-white")}>
                SELL
              </button>
            </div>

            {/* Ticker */}
            <label className="text-[10px] font-semibold text-muted uppercase tracking-widest block mb-2">Ticker</label>
            <div className="relative mb-3">
              <input
                value={ticker}
                onChange={e => { setTicker(e.target.value.toUpperCase()); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
                placeholder="AAPL"
                className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent"
              />
              {searchOpen && Array.isArray(results) && results.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {results.slice(0, 8).map((r: { ticker: string; name: string }) => (
                    <button key={r.ticker}
                      onClick={() => { setTicker(r.ticker); setSearchOpen(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-surface-hover flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">{r.ticker}</span>
                      <span className="text-[10px] text-muted truncate ml-2">{r.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Live price */}
            <div className="bg-surface-hover rounded-lg px-3 py-2.5 mb-4 flex items-center justify-between">
              <span className="text-[10px] text-muted uppercase tracking-widest font-semibold">Live Price</span>
              <span className="text-sm font-bold text-white tabular-nums">
                {priceLoading && !price ? "…" : price ? `$${fmtMoney(price)}` : "—"}
              </span>
            </div>

            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {(["shares", "dollars"] as const).map(v => (
                <button key={v} onClick={() => setMode(v)}
                  className={clsx("rounded-lg py-1.5 text-[11px] font-medium transition-colors capitalize",
                    mode === v ? "bg-accent/20 border border-accent text-white" : "border border-border text-muted hover:text-white")}>
                  {v === "shares" ? "Shares" : "Dollar amount"}
                </button>
              ))}
            </div>

            <label className="text-[10px] font-semibold text-muted uppercase tracking-widest block mb-2">
              {mode === "shares" ? "Shares" : "Dollar Amount"}
            </label>
            <div className="relative mb-3">
              {mode === "dollars" && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
              )}
              <input
                type="number" value={amount} onChange={e => setAmount(e.target.value)}
                placeholder={mode === "shares" ? "10" : "1000"}
                className={clsx(
                  "w-full bg-surface-hover border border-border rounded-lg pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-accent",
                  mode === "dollars" ? "pl-7" : "pl-3"
                )}
              />
            </div>

            {/* Estimated total */}
            <div className="bg-surface-hover rounded-lg p-3 mb-2 space-y-1.5 text-xs">
              <div className="flex justify-between text-muted">
                <span>Estimated shares</span>
                <span className="text-white font-semibold tabular-nums">{estimatedShares.toFixed(4)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Estimated total</span>
                <span className="text-white font-semibold tabular-nums">${fmtMoney(estimatedTotal)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>{side === "buy" ? "Cash after" : "Cash after"}</span>
                <span className={clsx(
                  "font-semibold tabular-nums",
                  (side === "buy" ? cashBalance - estimatedTotal : cashBalance + estimatedTotal) < 0 ? "text-negative" : "text-white"
                )}>
                  ${fmtMoney(side === "buy" ? cashBalance - estimatedTotal : cashBalance + estimatedTotal)}
                </span>
              </div>
              {side === "sell" && holding && (
                <div className="flex justify-between text-muted">
                  <span>Shares held</span>
                  <span className="text-white font-semibold tabular-nums">{maxSell}</span>
                </div>
              )}
            </div>

            {err && <p className="text-xs text-negative mb-2">{err}</p>}
            <button onClick={next}
              className="w-full bg-accent hover:bg-accent/90 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
              Review Order
            </button>
          </>
        ) : (
          <>
            <div className={clsx("rounded-xl p-4 mb-4 border",
              side === "buy" ? "bg-positive/5 border-positive/30" : "bg-negative/5 border-negative/30")}>
              <div className="flex items-center gap-2 mb-3">
                {side === "buy"
                  ? <ArrowUpRight size={16} className="text-positive" />
                  : <ArrowDownRight size={16} className="text-negative" />}
                <span className={clsx("text-sm font-bold uppercase tracking-widest",
                  side === "buy" ? "text-positive" : "text-negative")}>
                  {side} {debounced}
                </span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-muted">
                  <span>Shares</span><span className="text-white font-semibold tabular-nums">{estimatedShares.toFixed(4)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Price</span><span className="text-white font-semibold tabular-nums">${fmtMoney(price ?? 0)}</span>
                </div>
                <div className="flex justify-between text-muted pt-2 border-t border-border/50">
                  <span>Total</span><span className="text-white font-bold tabular-nums">${fmtMoney(estimatedTotal)}</span>
                </div>
              </div>
            </div>
            {err && <p className="text-xs text-negative mb-2">{err}</p>}
            <div className="flex gap-2">
              <button onClick={() => setStep("input")}
                className="flex-1 border border-border text-muted hover:text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
                Back
              </button>
              <button onClick={() => m.mutate()} disabled={m.isPending}
                className={clsx("flex-1 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors disabled:opacity-50",
                  side === "buy" ? "bg-positive hover:bg-positive/90" : "bg-negative hover:bg-negative/90")}>
                {m.isPending ? "Executing…" : `Confirm ${side === "buy" ? "Buy" : "Sell"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Allocation pie ──────────────────────────────────────────────────────── */
function AllocationPie({ holdings, cash }: { holdings: PaperHolding[]; cash: number }) {
  const { theme } = useTheme();
  const tooltipStyle = {
    background: theme === "light" ? "#fff" : "#1a1a2e",
    border: `1px solid ${theme === "light" ? "#e2e8f0" : "#2a2a45"}`,
    borderRadius: 8, color: theme === "light" ? "#0f172a" : "#e2e8f0", fontSize: 12,
  };
  const totalEquity = holdings.reduce((s, h) => s + h.value, 0) + cash;
  const data = [
    ...holdings.map(h => ({ name: h.ticker, value: h.value, pct: totalEquity ? h.value / totalEquity * 100 : 0 })),
    ...(cash > 0 ? [{ name: "Cash", value: cash, pct: totalEquity ? cash / totalEquity * 100 : 0 }] : []),
  ];
  if (!data.length) return null;
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">Allocation (incl. cash)</p>
      <div className="flex items-center gap-3">
        <PieChart width={120} height={120}>
          <Pie data={data} dataKey="value" cx={60} cy={60} innerRadius={34} outerRadius={56} paddingAngle={data.length > 1 ? 2 : 0}>
            {data.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Tooltip contentStyle={tooltipStyle} formatter={(_v: any, _n: any, p: any) => [`${p.payload.pct.toFixed(1)}%`, p.payload.name]} />
        </PieChart>
        <div className="flex-1 space-y-1.5 min-w-0">
          {data.slice(0, 6).map((d, i) => (
            <div key={i} className="flex items-center gap-1.5 min-w-0">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
              <span className="text-xs text-white truncate flex-1">{d.name}</span>
              <span className="text-[10px] text-muted shrink-0">{d.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Performance comparison card ─────────────────────────────────────────── */
function ComparisonCard({ paperReturnPct }: { paperReturnPct: number }) {
  const { data: realAnalytics } = useQuery<{ total_pnl_pct?: number; holdings?: unknown[] }>({
    queryKey: ["portfolio-analytics", null],
    queryFn: () => getPortfolioAnalytics(),
    staleTime: 2 * 60_000,
  });
  const realReturnPct = realAnalytics?.total_pnl_pct;
  const hasReal = (realAnalytics?.holdings?.length ?? 0) > 0;
  const diff = (realReturnPct ?? null) != null ? paperReturnPct - (realReturnPct as number) : null;

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 size={14} className="text-muted" />
        <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Performance Comparison</p>
      </div>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-[10px] text-muted uppercase tracking-widest font-semibold mb-1">Paper</p>
          <p className={clsx("text-lg font-bold", paperReturnPct >= 0 ? "text-positive" : "text-negative")}>
            {paperReturnPct >= 0 ? "+" : ""}{paperReturnPct.toFixed(2)}%
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted uppercase tracking-widest font-semibold mb-1">Real Portfolio</p>
          {hasReal && realReturnPct != null ? (
            <p className={clsx("text-lg font-bold", realReturnPct >= 0 ? "text-positive" : "text-negative")}>
              {realReturnPct >= 0 ? "+" : ""}{realReturnPct.toFixed(2)}%
            </p>
          ) : (
            <p className="text-sm text-muted">No real holdings</p>
          )}
        </div>
        <div>
          <p className="text-[10px] text-muted uppercase tracking-widest font-semibold mb-1">Difference</p>
          {diff != null ? (
            <p className={clsx("text-lg font-bold", diff >= 0 ? "text-positive" : "text-negative")}>
              {diff >= 0 ? "+" : ""}{diff.toFixed(2)}%
            </p>
          ) : (
            <p className="text-sm text-muted">—</p>
          )}
        </div>
      </div>
      {diff != null && (
        <p className="text-xs text-muted text-center mt-3">
          Your paper portfolio is {diff >= 0 ? "outperforming" : "underperforming"} your real portfolio by {Math.abs(diff).toFixed(2)}%.
        </p>
      )}
    </div>
  );
}

/* ── Trade history tab ───────────────────────────────────────────────────── */
function HistoryPanel() {
  const { data: trades, isLoading } = useQuery({
    queryKey: ["paper-trades"],
    queryFn: () => listPaperTrades(500),
    staleTime: 30_000,
  });
  if (isLoading) {
    return <div className="h-48 bg-surface rounded-xl border border-border animate-pulse" />;
  }
  if (!trades?.length) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <HistoryIcon size={28} className="text-muted mx-auto mb-2" />
        <p className="text-sm text-muted">No paper trades yet. Place your first trade to see it here.</p>
      </div>
    );
  }
  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-surface-hover">
          <tr className="text-[10px] uppercase tracking-widest text-muted">
            <th className="py-3 px-5 text-left">Date</th>
            <th className="py-3 px-4 text-left">Ticker</th>
            <th className="py-3 px-4 text-center">Side</th>
            <th className="py-3 px-4 text-right">Shares</th>
            <th className="py-3 px-4 text-right">Price</th>
            <th className="py-3 px-5 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t: PaperTrade) => (
            <tr key={t.id} className="border-t border-border/50 hover:bg-surface-hover/40">
              <td className="py-2.5 px-5 text-xs text-muted">{fmtDateTime(t.executed_at)}</td>
              <td className="py-2.5 px-4 font-semibold text-white">{t.ticker}</td>
              <td className="py-2.5 px-4 text-center">
                <span className={clsx("text-[10px] font-bold uppercase px-2 py-0.5 rounded-full",
                  t.side === "buy" ? "bg-positive/15 text-positive" : "bg-negative/15 text-negative")}>
                  {t.side}
                </span>
              </td>
              <td className="py-2.5 px-4 text-right text-sm text-white tabular-nums">{t.shares.toFixed(4)}</td>
              <td className="py-2.5 px-4 text-right text-sm text-white tabular-nums">${fmtMoney(t.price)}</td>
              <td className={clsx("py-2.5 px-5 text-right text-sm font-semibold tabular-nums",
                t.total >= 0 ? "text-positive" : "text-negative")}>
                {t.total >= 0 ? "+" : "−"}${fmtMoney(Math.abs(t.total))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */
export default function PaperTrading() {
  const [tab, setTab] = useState<"dashboard" | "strategies" | "history">("dashboard");
  const [showSetup, setShowSetup] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeInitial, setTradeInitial] = useState<{ ticker?: string; side?: "buy" | "sell" }>({});
  const qc = useQueryClient();

  const stateQ = useQuery({
    queryKey: ["paper-state"],
    queryFn: getPaperState,
    retry: (failureCount, error: unknown) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) return false;
      return failureCount < 2;
    },
    staleTime: 30_000,
  });

  const notInitialised = (stateQ.error as { response?: { status?: number } })?.response?.status === 404;

  const analyticsQ = useQuery<PaperAnalytics>({
    queryKey: ["paper-analytics"],
    queryFn: getPaperAnalytics,
    enabled: !!stateQ.data,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const resetMut = useMutation({
    mutationFn: resetPaperTrading,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paper-state"] });
      qc.invalidateQueries({ queryKey: ["paper-analytics"] });
      qc.invalidateQueries({ queryKey: ["paper-trades"] });
      toast.success("Paper portfolio reset");
    },
  });

  // Auto-open setup when the user lands and isn't initialised yet.
  useEffect(() => {
    if (notInitialised) setShowSetup(true);
  }, [notInitialised]);

  const a = analyticsQ.data;
  const holdings = a?.holdings ?? [];
  const cash = a?.cash_balance ?? 0;
  const equity = a?.equity ?? 0;
  const totalReturnPct = a?.total_return_pct ?? 0;

  const sortedHoldings = useMemo(
    () => [...holdings].sort((x, y) => y.value - x.value),
    [holdings],
  );

  function openTrade(initial?: { ticker?: string; side?: "buy" | "sell" }) {
    setTradeInitial(initial ?? {});
    setTradeOpen(true);
  }

  if (stateQ.isLoading) {
    return <div className="p-6"><div className="h-40 bg-surface rounded-xl border border-border animate-pulse" /></div>;
  }

  if (notInitialised) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto bg-surface border border-border rounded-2xl p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
            <FlaskConical size={22} className="text-amber-400" />
          </div>
          <h2 className="text-lg font-bold text-white mb-2">Paper Trading</h2>
          <p className="text-sm text-muted mb-6">
            Practice with virtual cash. Test strategies, learn the platform, and see how your trades would have played out — without risking real money.
          </p>
          <button onClick={() => setShowSetup(true)}
            className="bg-accent hover:bg-accent/90 text-white rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors">
            Start Paper Trading
          </button>
        </div>
        {showSetup && <SetupModal onClose={() => setShowSetup(false)} onCreated={() => setShowSetup(false)} />}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Banner */}
      <div className="bg-amber-500/10 border border-amber-500/40 rounded-xl px-4 py-3 flex items-center gap-3">
        <AlertTriangle size={18} className="text-amber-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-400 tracking-wide">PAPER TRADING</p>
          <p className="text-xs text-muted">Virtual money. No real trades. Nothing here affects your real portfolio.</p>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 bg-surface border border-border rounded-lg p-1">
          {(["dashboard", "strategies", "history"] as const).map(v => (
            <button key={v} onClick={() => setTab(v)}
              className={clsx("px-3 py-1.5 rounded-md text-xs font-semibold transition-colors capitalize",
                tab === v ? "bg-accent/20 text-white" : "text-muted hover:text-white")}>
              {v === "dashboard" ? "Dashboard" : v === "strategies" ? "Strategies" : "Trade History"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-surface border border-border rounded-lg px-3 py-2 flex items-center gap-2">
            <Wallet size={14} className="text-muted" />
            <div className="text-right">
              <p className="text-[9px] text-muted uppercase tracking-widest font-semibold leading-none">Virtual Cash</p>
              <p className="text-sm font-bold text-white tabular-nums leading-tight">${fmtMoney(cash)}</p>
            </div>
          </div>
          <button onClick={() => openTrade()}
            className="bg-accent hover:bg-accent/90 text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors">
            Buy / Sell
          </button>
          <button
            onClick={() => {
              if (confirm("Reset paper portfolio? This deletes all virtual holdings and trade history.")) resetMut.mutate();
            }}
            disabled={resetMut.isPending}
            title="Reset paper portfolio"
            className="text-muted hover:text-negative p-2 rounded-lg border border-border hover:border-negative/40 transition-colors">
            <RefreshCw size={14} className={resetMut.isPending ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {tab === "dashboard" && a && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Equity" value={`$${fmtMoney(equity)}`} icon={DollarSign} />
            <SummaryCard label="Total Invested" value={`$${fmtMoney(a.total_cost)}`} icon={DollarSign} />
            <SummaryCard label="Current Value" value={`$${fmtMoney(a.total_value)}`} icon={DollarSign} />
            <SummaryCard
              label="Total P&L"
              value={`${a.total_pnl >= 0 ? "+" : "−"}$${fmtMoney(Math.abs(a.total_pnl))}`}
              sub={`${a.total_pnl_pct >= 0 ? "+" : ""}${a.total_pnl_pct.toFixed(2)}%`}
              positive={a.total_pnl >= 0}
              icon={a.total_pnl >= 0 ? TrendingUp : TrendingDown}
            />
          </div>

          {/* Comparison + Allocation */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ComparisonCard paperReturnPct={totalReturnPct} />
            {(holdings.length > 0 || cash > 0) && <AllocationPie holdings={holdings} cash={cash} />}
          </div>

          {/* Holdings table */}
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Holdings</p>
              <span className="text-[10px] text-muted">{holdings.length} position{holdings.length !== 1 ? "s" : ""}</span>
            </div>
            {sortedHoldings.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-muted mb-3">No holdings yet — your virtual cash is fully unallocated.</p>
                <button onClick={() => openTrade({ side: "buy" })}
                  className="bg-accent hover:bg-accent/90 text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors">
                  Place your first trade
                </button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-muted bg-surface-hover/30">
                    <th className="py-3 px-5 text-left">Ticker</th>
                    <th className="py-3 px-4 text-right">Shares</th>
                    <th className="py-3 px-4 text-right">Avg Cost</th>
                    <th className="py-3 px-4 text-right">Price</th>
                    <th className="py-3 px-4 text-right">Value</th>
                    <th className="py-3 px-4 text-right">P&L</th>
                    <th className="py-3 px-4 text-right">Weight</th>
                    <th className="py-3 px-5 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedHoldings.map(h => (
                    <tr key={h.ticker} className="border-t border-border/50 hover:bg-surface-hover/40">
                      <td className="py-2.5 px-5">
                        <Link to={`/stock/${h.ticker}`} className="font-semibold text-white hover:text-accent-light">{h.ticker}</Link>
                        <div className="text-[10px] text-muted truncate max-w-[180px]">{h.name}</div>
                      </td>
                      <td className="py-2.5 px-4 text-right text-white tabular-nums">{h.shares.toFixed(4)}</td>
                      <td className="py-2.5 px-4 text-right text-white tabular-nums">${fmtMoney(h.avg_buy_price)}</td>
                      <td className="py-2.5 px-4 text-right text-white tabular-nums">${fmtMoney(h.current_price)}</td>
                      <td className="py-2.5 px-4 text-right text-white tabular-nums">${fmtMoney(h.value)}</td>
                      <td className={clsx("py-2.5 px-4 text-right tabular-nums font-semibold",
                        h.pnl >= 0 ? "text-positive" : "text-negative")}>
                        {h.pnl >= 0 ? "+" : "−"}${fmtMoney(Math.abs(h.pnl))}
                        <div className="text-[10px]">
                          {h.pnl_pct >= 0 ? "+" : ""}{h.pnl_pct.toFixed(2)}%
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right text-muted tabular-nums">{h.allocation_pct.toFixed(1)}%</td>
                      <td className="py-2.5 px-5 text-center">
                        <button onClick={() => openTrade({ ticker: h.ticker })}
                          className="text-[11px] font-semibold text-accent-light hover:text-accent border border-accent/30 hover:border-accent rounded-md px-2.5 py-1 transition-colors">
                          Trade
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "strategies" && <StrategiesPanel />}

      {tab === "history" && <HistoryPanel />}

      {tradeOpen && a && (
        <TradeModal
          initialTicker={tradeInitial.ticker}
          initialSide={tradeInitial.side}
          cashBalance={cash}
          currentHoldings={holdings}
          onClose={() => setTradeOpen(false)}
          onExecuted={() => setTradeOpen(false)}
        />
      )}
      {showSetup && <SetupModal onClose={() => setShowSetup(false)} onCreated={() => setShowSetup(false)} />}
    </div>
  );
}

/* ── Strategies panel ────────────────────────────────────────────────────── */

const STRATEGY_OPTIONS: { key: StrategyKey; label: string; desc: string }[] = [
  {
    key: "buy_hold",
    label: "Buy & Hold",
    desc: "Invest the full amount on day one and hold to the end of the period.",
  },
  {
    key: "dca",
    label: "Dollar-Cost Average",
    desc: "Spread the amount evenly across the period — buy a little at each interval.",
  },
];

const PERIOD_OPTIONS: { key: StrategyPeriod; label: string }[] = [
  { key: "1y", label: "1Y" }, { key: "3y", label: "3Y" },
  { key: "5y", label: "5Y" }, { key: "10y", label: "10Y" },
];

const FREQUENCY_OPTIONS: { key: StrategyFrequency; label: string }[] = [
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
];

function StrategiesPanel() {
  const [strategy, setStrategy] = useState<StrategyKey>("buy_hold");
  const [ticker, setTicker] = useState("AAPL");
  const [period, setPeriod] = useState<StrategyPeriod>("5y");
  const [amount, setAmount] = useState("10000");
  const [frequency, setFrequency] = useState<StrategyFrequency>("monthly");
  const [result, setResult] = useState<BacktestResult | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      runBacktest({
        ticker: ticker.trim().toUpperCase(),
        strategy,
        period,
        amount: Number(amount),
        frequency: strategy === "dca" ? frequency : undefined,
      }),
    onSuccess: setResult,
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Backtest failed. Try a different ticker or period.";
      toast.error(msg);
    },
  });

  const amountNum = Number(amount);
  const canRun = ticker.trim().length > 0 && amountNum > 0 && amountNum <= 1_000_000 && !mut.isPending;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-4">
      {/* ── Form ─────────────────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-border p-4 space-y-4 h-fit">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-xs font-semibold text-white uppercase tracking-widest">Strategy</h3>
        </div>

        <div className="space-y-2">
          {STRATEGY_OPTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setStrategy(s.key)}
              className={clsx(
                "w-full text-left rounded-lg border px-3 py-2.5 transition-colors",
                strategy === s.key
                  ? "bg-accent/10 border-accent/50"
                  : "bg-surface-hover border-border hover:border-border/80",
              )}
            >
              <div className={clsx("text-sm font-semibold", strategy === s.key ? "text-accent" : "text-white")}>
                {s.label}
              </div>
              <div className="text-[11px] text-muted mt-0.5 leading-snug">{s.desc}</div>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
            Ticker
          </label>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="AAPL"
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent/60"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
            Amount ($)
          </label>
          <input
            type="number"
            value={amount}
            min={1}
            max={1_000_000}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/60"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
            Period
          </label>
          <div className="flex gap-1.5">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={clsx(
                  "flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg border transition-colors",
                  period === p.key
                    ? "bg-accent/20 border-accent/50 text-accent"
                    : "bg-surface-hover border-border text-muted hover:text-white",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {strategy === "dca" && (
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Frequency
            </label>
            <div className="flex gap-1.5">
              {FREQUENCY_OPTIONS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFrequency(f.key)}
                  className={clsx(
                    "flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg border transition-colors",
                    frequency === f.key
                      ? "bg-accent/20 border-accent/50 text-accent"
                      : "bg-surface-hover border-border text-muted hover:text-white",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => mut.mutate()}
          disabled={!canRun}
          className="w-full bg-accent hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg py-2.5 text-sm font-semibold transition-colors"
        >
          {mut.isPending ? "Running…" : "Run backtest"}
        </button>

        <p className="text-[11px] text-muted leading-snug">
          Backtests are historical only. Past returns don't predict future performance.
        </p>
      </div>

      {/* ── Result ───────────────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-border p-4 min-h-[400px]">
        {!result && !mut.isPending && (
          <div className="h-full flex flex-col items-center justify-center text-center py-12">
            <LineChartIcon size={28} className="text-muted/60 mb-3" />
            <p className="text-sm text-muted">Pick a strategy and run a backtest to see results.</p>
          </div>
        )}

        {mut.isPending && (
          <div className="h-full flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {result && !mut.isPending && <BacktestResultCard result={result} />}
      </div>
    </div>
  );
}

function BacktestResultCard({ result }: { result: BacktestResult }) {
  const { summary, benchmark, chart, ticker, strategy, period, frequency } = result;
  const positive = summary.total_return_pct >= 0;
  const beatBench = benchmark ? summary.end_value > benchmark.summary.end_value : null;

  const merged = useMemo<Array<{ date: string; value: number | null; bench: number | null }>>(() => {
    const map = new Map<string, { date: string; value: number | null; bench: number | null }>();
    for (const p of chart) map.set(p.date, { date: p.date, value: p.value, bench: null });
    if (benchmark) {
      for (const p of benchmark.chart) {
        const row = map.get(p.date) ?? { date: p.date, value: null, bench: null };
        row.bench = p.value;
        map.set(p.date, row);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [chart, benchmark]);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-xs text-muted uppercase tracking-widest font-semibold">
            {ticker} · {strategy === "buy_hold" ? "Buy & Hold" : `DCA (${frequency})`} · {period.toUpperCase()}
          </div>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="text-2xl font-bold text-white tabular-nums">
              ${summary.end_value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
            <span className={clsx("text-sm font-semibold", positive ? "text-positive" : "text-negative")}>
              {positive ? "+" : ""}{summary.total_return_pct.toFixed(2)}%
            </span>
            <span className="text-xs text-muted">CAGR {summary.cagr_pct.toFixed(2)}%</span>
          </div>
        </div>
        {benchmark && (
          <div className={clsx(
            "text-xs font-semibold px-2.5 py-1.5 rounded-lg border",
            beatBench
              ? "border-positive/40 bg-positive/10 text-positive"
              : "border-negative/40 bg-negative/10 text-negative",
          )}>
            {beatBench ? "Beat" : "Underperformed"} SPY by {Math.abs(summary.total_return_pct - benchmark.summary.total_return_pct).toFixed(2)}%
          </div>
        )}
      </div>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#6b7280" }}
              tickFormatter={(d) => d.slice(0, 7)}
              minTickGap={48}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#6b7280" }}
              tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
              domain={["auto", "auto"]}
            />
            <Tooltip
              contentStyle={{ background: "#0b1018", border: "1px solid #1f2937", borderRadius: 8, fontSize: 11 }}
              formatter={(v) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="value" name={`${ticker} (${strategy === "buy_hold" ? "B&H" : "DCA"})`}
              stroke="#7c5cfc" strokeWidth={2} dot={false} isAnimationActive={false} />
            {benchmark && (
              <Line type="monotone" dataKey="bench" name="SPY (B&H)"
                stroke="#06b6d4" strokeWidth={2} dot={false} strokeDasharray="4 4" isAnimationActive={false} />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <Stat label="Invested" value={`$${summary.start_value.toLocaleString()}`} />
        <Stat label="Ending value" value={`$${summary.end_value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} positive={positive} />
        <Stat label="Total return" value={`${positive ? "+" : ""}${summary.total_return_pct.toFixed(2)}%`} positive={positive} />
        <Stat label="CAGR" value={`${summary.cagr_pct.toFixed(2)}%`} positive={summary.cagr_pct >= 0} />
      </div>
    </div>
  );
}

function Stat({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="bg-surface-hover border border-border rounded-lg px-3 py-2">
      <div className="text-[10px] text-muted uppercase tracking-widest font-semibold">{label}</div>
      <div className={clsx("text-sm font-semibold tabular-nums mt-0.5",
        positive === undefined ? "text-white" : positive ? "text-positive" : "text-negative")}>
        {value}
      </div>
    </div>
  );
}

function SummaryCard({
  label, value, sub, positive, icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
  icon: React.ElementType;
}) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={13} className="text-muted" />
        <p className="text-[10px] text-muted uppercase tracking-widest font-semibold">{label}</p>
      </div>
      <div className={clsx("text-xl font-bold tabular-nums",
        positive === undefined ? "text-white" : positive ? "text-positive" : "text-negative")}>
        {value}
      </div>
      {sub && (
        <div className={clsx("text-[11px] mt-0.5 tabular-nums",
          positive ? "text-positive" : "text-negative")}>
          {sub}
        </div>
      )}
    </div>
  );
}
