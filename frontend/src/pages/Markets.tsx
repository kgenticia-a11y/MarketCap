import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { clsx } from "clsx";
import { format } from "date-fns";
import {
  TrendingUp, TrendingDown, DollarSign, RefreshCw, X, ArrowUpCircle,
} from "lucide-react";
import { createPortal } from "react-dom";
import { getMarketOverview, getEtfPerformance } from "../api/stocks";
import {
  getPaperState, executePaperTrade, setupPaperTrading,
} from "../api/paperTrading";
import ErrorBoundary from "../components/ErrorBoundary";

// ── Constants ─────────────────────────────────────────────────────────────────

const INDEXES = [
  { ticker: "SPY", name: "S&P 500",     label: "S&P 500 ETF" },
  { ticker: "QQQ", name: "NASDAQ 100",  label: "NASDAQ ETF" },
  { ticker: "DIA", name: "Dow Jones",   label: "Dow Jones ETF" },
] as const;

type IndexTicker = "SPY" | "QQQ" | "DIA";

const PERIODS = ["1D", "1W", "1M", "1Y"] as const;
type Period = typeof PERIODS[number];

const PERIOD_LABELS: Record<Period, string> = {
  "1D": "Today",
  "1W": "Past Week",
  "1M": "Past Month",
  "1Y": "Past Year",
};

// ── InvestModal ───────────────────────────────────────────────────────────────

interface InvestModalProps {
  ticker: IndexTicker;
  name: string;
  currentPrice: number | null;
  onClose: () => void;
}

function InvestModal({ ticker, name, currentPrice, onClose }: InvestModalProps) {
  const queryClient = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [mode, setMode] = useState<"dollar" | "shares">("dollar");
  const [amount, setAmount] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const { data: portfolio, isLoading: ptLoading } = useQuery({
    queryKey: ["paper-state"],
    queryFn: getPaperState,
    retry: false,
  });

  const setupMutation = useMutation({
    mutationFn: () => setupPaperTrading(10_000),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["paper-state"] }),
  });

  const tradeMutation = useMutation({
    mutationFn: async () => {
      const val = parseFloat(amount);
      if (isNaN(val) || val <= 0) throw new Error("Enter a valid amount.");
      const params =
        mode === "dollar"
          ? { ticker, side, dollar_amount: val }
          : { ticker, side, shares: val };
      return executePaperTrade(params);
    },
    onSuccess: (trade) => {
      queryClient.invalidateQueries({ queryKey: ["paper-state"] });
      queryClient.invalidateQueries({ queryKey: ["paper-analytics"] });
      const verb = trade.side === "buy" ? "Bought" : "Sold";
      setFeedback({
        ok: true,
        msg: `${verb} ${trade.shares.toFixed(4)} shares of ${ticker} @ $${trade.price.toFixed(2)} — Total: $${Math.abs(trade.total).toFixed(2)}`,
      });
      setAmount("");
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Trade failed. Please try again.";
      setFeedback({ ok: false, msg });
    },
  });

  // Scroll lock
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const notSetUp = !ptLoading && !portfolio;
  const cashBalance = portfolio?.cash_balance ?? 0;

  const estimatedShares =
    mode === "dollar" && currentPrice && parseFloat(amount) > 0
      ? (parseFloat(amount) / currentPrice).toFixed(4)
      : null;

  const estimatedTotal =
    mode === "shares" && currentPrice && parseFloat(amount) > 0
      ? (parseFloat(amount) * currentPrice).toFixed(2)
      : null;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="text-xs text-muted mb-0.5">Paper Trade</div>
            <div className="text-xl font-bold text-white">{name} ({ticker})</div>
            {currentPrice && (
              <div className="text-sm text-muted mt-1">
                Current price: ${currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors p-1 -mt-1 -mr-1">
            <X size={20} />
          </button>
        </div>

        {ptLoading ? (
          <div className="h-32 flex items-center justify-center text-muted text-sm">Loading portfolio…</div>
        ) : notSetUp ? (
          <div className="space-y-4">
            <div className="bg-surface rounded-xl p-4 text-sm text-muted text-center">
              You need a paper portfolio to invest. Start with $10,000 in virtual cash.
            </div>
            <button
              onClick={() => setupMutation.mutate()}
              disabled={setupMutation.isPending}
              className="w-full py-3 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {setupMutation.isPending ? "Setting up…" : "Set Up Paper Portfolio"}
            </button>
            {setupMutation.isError && (
              <p className="text-xs text-negative text-center">Failed to set up portfolio.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Buy / Sell tabs */}
            <div className="flex gap-1 bg-surface rounded-lg p-1">
              {(["buy", "sell"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSide(s); setFeedback(null); }}
                  className={clsx(
                    "flex-1 py-2 text-sm font-semibold rounded-md transition-colors capitalize",
                    side === s
                      ? s === "buy" ? "bg-positive/20 text-positive" : "bg-negative/20 text-negative"
                      : "text-muted hover:text-white"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Available cash badge */}
            <div className="flex items-center gap-2 text-xs text-muted bg-surface rounded-lg px-3 py-2">
              <DollarSign size={13} />
              Available cash:{" "}
              <span className="text-white font-medium ml-1">
                ${cashBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>

            {/* Mode toggle */}
            <div className="flex gap-1 bg-surface rounded-lg p-1">
              {(["dollar", "shares"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={clsx(
                    "flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors",
                    mode === m ? "bg-accent/20 text-white" : "text-muted hover:text-white"
                  )}
                >
                  {m === "dollar" ? "$ Amount" : "# Shares"}
                </button>
              ))}
            </div>

            {/* Amount input */}
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">
                {mode === "dollar" ? "$" : "#"}
              </span>
              <input
                type="number"
                min="0"
                step={mode === "dollar" ? "10" : "0.001"}
                value={amount}
                onChange={(e) => { setAmount(e.target.value); setFeedback(null); }}
                placeholder={mode === "dollar" ? "0.00" : "0.0000"}
                className="w-full pl-8 pr-4 py-3 bg-surface border border-border rounded-xl text-white text-sm placeholder-muted focus:outline-none focus:border-accent/60"
              />
            </div>

            {/* Preview */}
            {estimatedShares && (
              <p className="text-xs text-muted">
                ≈ <span className="text-white">{estimatedShares}</span> shares
              </p>
            )}
            {estimatedTotal && (
              <p className="text-xs text-muted">
                ≈ <span className="text-white">${estimatedTotal}</span> total
              </p>
            )}

            {/* Feedback */}
            {feedback && (
              <div className={clsx(
                "text-xs px-3 py-2.5 rounded-lg",
                feedback.ok ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
              )}>
                {feedback.msg}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={() => tradeMutation.mutate()}
              disabled={tradeMutation.isPending || !amount}
              className={clsx(
                "w-full py-3 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50",
                side === "buy"
                  ? "bg-positive text-black hover:bg-positive/90"
                  : "bg-negative text-white hover:bg-negative/90"
              )}
            >
              {tradeMutation.isPending
                ? "Processing…"
                : side === "buy"
                  ? `Buy ${ticker}`
                  : `Sell ${ticker}`}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── IndexDetailPanel ──────────────────────────────────────────────────────────

interface IndexDetailPanelProps {
  ticker: IndexTicker;
  name: string;
  currentPrice: number | null;
  changePct: number | null;
}

function IndexDetailPanel({ ticker, name, currentPrice, changePct }: IndexDetailPanelProps) {
  const [period, setPeriod] = useState<Period>("1D");
  const [investOpen, setInvestOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["etf-performance", ticker],
    queryFn: () => getEtfPerformance(ticker),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
  });

  const pd = data?.periods[period];
  const positive = (pd?.change_pct ?? changePct ?? 0) >= 0;
  const color = positive ? "#22c55e" : "#ef4444";
  const gradId = `idx-grad-${ticker}-${period}`;

  const chartData = (pd?.bars ?? []).map((b) => ({
    label:
      period === "1D"
        ? format(new Date(b.t), "HH:mm")
        : format(new Date(b.t), "MMM d"),
    price: b.c,
  }));

  return (
    <div className="bg-surface rounded-2xl border border-border p-6 space-y-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs text-muted mb-0.5">{name}</div>
          <div className="text-3xl font-bold text-white">{ticker}</div>
          {(data?.price ?? currentPrice) != null && (
            <div className="text-lg text-muted mt-1">
              ${(data?.price ?? currentPrice)!.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
        <button
          onClick={() => setInvestOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors shrink-0"
        >
          <ArrowUpCircle size={16} />
          Invest
        </button>
      </div>

      {/* Period tabs */}
      <div className="flex gap-1 bg-surface-hover rounded-lg p-1">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={clsx(
              "flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors",
              period === p ? "bg-accent/20 text-white" : "text-muted hover:text-white"
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Chart area */}
      {isLoading ? (
        <div className="h-52 flex items-center justify-center text-muted text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Loading…
        </div>
      ) : isError ? (
        <div className="h-52 flex items-center justify-center text-negative text-sm">
          Failed to load market data
        </div>
      ) : (
        <>
          {/* Change badge */}
          <div className="flex items-center gap-3">
            {pd?.change_pct != null ? (
              <>
                <div className={clsx(
                  "flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full",
                  positive ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
                )}>
                  {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {positive ? "+" : ""}{pd.change_pct.toFixed(2)}%
                </div>
                {pd.change_abs != null && (
                  <span className={clsx("text-sm font-medium", positive ? "text-positive" : "text-negative")}>
                    {positive ? "+" : "-"}${Math.abs(pd.change_abs).toFixed(2)}
                  </span>
                )}
                <span className="text-xs text-muted ml-auto">{PERIOD_LABELS[period]}</span>
              </>
            ) : (
              <span className="text-sm text-muted">No data available</span>
            )}
          </div>

          {/* Chart */}
          {chartData.length > 1 && (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={color} stopOpacity={0} />
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
                  contentStyle={{ background: "#1e1e35", border: "1px solid #2a2a45", borderRadius: 12 }}
                  labelStyle={{ color: "#9ca3af", fontSize: 11 }}
                  formatter={(v) => [`$${Number(v).toFixed(2)}`, ticker]}
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
          )}

          {/* High / Low */}
          {(pd?.high != null || pd?.low != null) && (
            <div className="grid grid-cols-2 gap-3">
              {pd?.high != null && (
                <div className="bg-surface-hover rounded-lg p-3">
                  <div className="text-xs text-muted mb-1">{period} High</div>
                  <div className="text-sm font-semibold text-white">${pd.high.toFixed(2)}</div>
                </div>
              )}
              {pd?.low != null && (
                <div className="bg-surface-hover rounded-lg p-3">
                  <div className="text-xs text-muted mb-1">{period} Low</div>
                  <div className="text-sm font-semibold text-white">${pd.low.toFixed(2)}</div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {investOpen && (
        <InvestModal
          ticker={ticker}
          name={name}
          currentPrice={data?.price ?? currentPrice}
          onClose={() => setInvestOpen(false)}
        />
      )}
    </div>
  );
}

// ── IndexCard ─────────────────────────────────────────────────────────────────

interface IndexCardProps {
  ticker: IndexTicker;
  name: string;
  label: string;
  price: number | null;
  changePct: number | null;
  selected: boolean;
  onClick: () => void;
}

function IndexCard({ name, label, price, changePct, selected, onClick }: IndexCardProps) {
  const positive = (changePct ?? 0) >= 0;
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full text-left rounded-xl border p-5 flex items-center justify-between transition-all",
        selected
          ? "bg-accent/10 border-accent/60 shadow-lg"
          : "bg-surface border-border hover:border-accent/40 hover:bg-surface-hover"
      )}
    >
      <div>
        <div className="text-xs text-muted mb-1">{label}</div>
        <div className="text-xl font-bold text-white">{name}</div>
        {price != null ? (
          <div className="text-sm text-muted mt-0.5">
            ${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        ) : (
          <div className="text-sm text-muted mt-0.5">—</div>
        )}
      </div>
      {changePct != null ? (
        <div className={clsx(
          "flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full shrink-0",
          positive ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
        )}>
          {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          {positive ? "+" : ""}{changePct.toFixed(2)}%
        </div>
      ) : (
        <div className="text-sm text-muted">Loading…</div>
      )}
    </button>
  );
}

// ── Markets page ──────────────────────────────────────────────────────────────

export default function Markets() {
  const [selected, setSelected] = useState<IndexTicker>("SPY");

  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ["market-overview"],
    queryFn: getMarketOverview,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 2,
  });

  // Build lookup: ticker → { price, change_pct }
  const indexData = Object.fromEntries(
    ((overview?.indices ?? []) as { ticker: string; price: number; change_pct: number }[])
      .map((s) => [s.ticker, s])
  );

  const selectedIndex = INDEXES.find((i) => i.ticker === selected)!;
  const snap = indexData[selected];

  return (
    <ErrorBoundary label="Markets failed to load">
      <div className="p-4 sm:p-6 space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Market Indexes</h1>
          <p className="text-sm text-muted mt-1">
            Live performance of major U.S. indexes — view charts and invest with paper money.
          </p>
        </div>

        {/* Index cards grid */}
        {ovLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-surface rounded-xl border border-border h-28 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {INDEXES.map(({ ticker, name, label }) => {
              const s = indexData[ticker];
              return (
                <IndexCard
                  key={ticker}
                  ticker={ticker}
                  name={name}
                  label={label}
                  price={s?.price ?? null}
                  changePct={s?.change_pct ?? null}
                  selected={selected === ticker}
                  onClick={() => setSelected(ticker)}
                />
              );
            })}
          </div>
        )}

        {/* Detail panel for selected index */}
        <IndexDetailPanel
          key={selected}
          ticker={selected}
          name={selectedIndex.name}
          currentPrice={snap?.price ?? null}
          changePct={snap?.change_pct ?? null}
        />
      </div>
    </ErrorBoundary>
  );
}
