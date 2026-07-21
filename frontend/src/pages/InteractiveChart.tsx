import { useState, useRef, useEffect } from "react";
import { loadPrefs } from "../utils/prefs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getChart, getQuote, searchStocks } from "../api/stocks";
import { useBatchedQuotes } from "../hooks/useBatchedQuotes";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "../api/watchlist";
import { addToPortfolio } from "../api/portfolio";
import CandlestickChart from "../components/CandlestickChart";
import AIChartAnalysisPanel from "../components/AIChartAnalysisPanel";
import { Star, Plus, TrendingUp, TrendingDown, Search, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { clsx } from "clsx";

const RANGES = ["1D", "5D", "1M", "6M", "1Y", "5Y"] as const;

interface Tab {
  ticker: string;
  name: string;
  removable?: boolean;
}

const DEFAULT_TABS: Tab[] = [
  { ticker: "AAPL", name: "Apple Inc" },
  { ticker: "NVDA", name: "Nvidia Corp" },
  { ticker: "MSFT", name: "Microsoft" },
  { ticker: "META", name: "Meta Platforms" },
  { ticker: "TSLA", name: "Tesla Inc" },
];

const TICKER_ICONS: Record<string, string> = {
  AAPL: "🍎", NVDA: "⚡", MSFT: "🪟", META: "📘", TSLA: "🚗",
};

interface PortfolioModal {
  shares: string;
  price: string;
}

/* ── Ticker search dropdown ───────────────────────────────────────────── */
interface SearchResult { ticker: string; name: string }

function TickerSearch({ onSelect }: { onSelect: (r: SearchResult) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data } = useQuery({
    queryKey: ["search", q],
    queryFn: () => searchStocks(q),
    enabled: q.length >= 1,
    staleTime: 30_000,
  });

  const results: SearchResult[] = data?.results?.slice(0, 7) ?? [];

  const pick = (r: SearchResult) => {
    onSelect(r);
    setQ("");
    setOpen(false);
  };

  // close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.closest(".ticker-search-wrap")?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="ticker-search-wrap relative shrink-0">
      <div className="flex items-center gap-2 bg-surface border border-border rounded-full px-3 py-1.5 w-44 focus-within:border-accent transition-colors">
        <Search size={12} className="text-muted shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Add ticker…"
          className="bg-transparent text-xs text-white placeholder-muted outline-none w-full"
        />
        {q && (
          <button onClick={() => { setQ(""); setOpen(false); }} className="text-muted hover:text-white transition-colors">
            <X size={11} />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full mt-1.5 left-0 w-64 bg-surface-raised border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
          {results.map((r) => (
            <button
              key={r.ticker}
              onMouseDown={() => pick(r)}
              className="w-full text-left px-4 py-2.5 hover:bg-surface-hover transition-colors flex items-center gap-3"
            >
              <span className="text-xs font-bold text-accent-light w-14 shrink-0">{r.ticker}</span>
              <span className="text-xs text-muted truncate">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */
export default function InteractiveChart() {
  const prefs = loadPrefs();
  const refetchMs = prefs.refetchSec * 1000;
  const [tabs, setTabs] = useState<Tab[]>(DEFAULT_TABS);
  // One batched request covers every tab's mini-row quote (was one request
  // per tab on mount); the TopValueRow queries are cache readers.
  useBatchedQuotes(tabs.map(t => t.ticker));
  const [activeTicker, setActiveTicker] = useState("AAPL");
  const [range, setRange] = useState<string>(prefs.defaultRange);
  const [modal, setModal] = useState<PortfolioModal | null>(null);
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ["chart", activeTicker, range],
    queryFn: () => getChart(activeTicker, range),
    staleTime: 60_000,
  });

  const { data: quote } = useQuery({
    queryKey: ["quote", activeTicker],
    queryFn: () => getQuote(activeTicker),
    staleTime: refetchMs,
    refetchInterval: refetchMs,
  });

  const { data: watchlistData } = useQuery({
    queryKey: ["watchlist"],
    queryFn: getWatchlist,
    enabled: !!user,
  });

  const isWatched = watchlistData?.some((w: { ticker: string }) => w.ticker === activeTicker) ?? false;

  const watchMutation = useMutation({
    mutationFn: () => isWatched ? removeFromWatchlist(activeTicker) : addToWatchlist(activeTicker),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const portMutation = useMutation({
    mutationFn: () =>
      addToPortfolio(activeTicker, parseFloat(modal!.shares), parseFloat(modal!.price)),
    onSuccess: () => {
      setModal(null);
      qc.invalidateQueries({ queryKey: ["portfolio"] });
    },
  });

  const bars: Array<Record<string, number>> = chartData?.results ?? [];
  const price: number = quote?.price ?? 0;
  const changePct: number = quote?.change_pct ?? 0;
  const positive = changePct >= 0;

  const openPortModal = () => setModal({ shares: "1", price: price.toFixed(2) });

  const addTab = (r: { ticker: string; name: string }) => {
    const already = tabs.find((t) => t.ticker === r.ticker);
    if (!already) {
      setTabs((prev) => [...prev, { ticker: r.ticker, name: r.name, removable: true }]);
    }
    setActiveTicker(r.ticker);
  };

  const removeTab = (ticker: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.ticker !== ticker);
      setActiveTicker((current) =>
        current === ticker ? (next[0]?.ticker ?? "AAPL") : current
      );
      return next;
    });
  };

  return (
    <div className="flex flex-col lg:h-full">
      {/* Stock tabs + search — outer wrapper has NO overflow so the dropdown isn't clipped */}
      <div className="flex items-center border-b border-border bg-sidebar">
        {/* Scrollable tab strip */}
        <div className="flex items-center gap-1 px-3 sm:px-4 py-3 flex-1 overflow-x-auto hide-scrollbar min-w-0">
          {tabs.map((tab) => (
            <button
              key={tab.ticker}
              onClick={() => setActiveTicker(tab.ticker)}
              className={clsx(
                "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all group",
                activeTicker === tab.ticker
                  ? "bg-accent text-white shadow-lg shadow-accent/30"
                  : "text-muted hover:text-white hover:bg-surface-hover"
              )}
            >
              <span>{TICKER_ICONS[tab.ticker] ?? "📈"}</span>
              <span className="hidden sm:inline">{tab.name}</span>
              <span className="sm:hidden">{tab.ticker}</span>
              {tab.removable && (
                <span
                  role="button"
                  onClick={(e) => removeTab(tab.ticker, e)}
                  className={clsx(
                    "ml-0.5 rounded-full p-px transition-colors",
                    activeTicker === tab.ticker
                      ? "hover:bg-white/20 text-white/70 hover:text-white"
                      : "hover:bg-surface text-muted hover:text-negative"
                  )}
                >
                  <X size={10} />
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search pinned to the right — outside the overflow container */}
        <div className="px-2 sm:px-3 py-3 shrink-0 border-l border-border/50">
          <TickerSearch onSelect={addTab} />
        </div>
      </div>

      {/* Main content — stacks vertically on mobile, side-by-side on desktop */}
      <div className="flex flex-col lg:flex-row lg:flex-1 lg:overflow-hidden">
        {/* Chart area */}
        <div className="flex flex-col lg:flex-1 lg:overflow-hidden">
          {/* Chart header — two rows on mobile, one row on desktop */}
          <div className="px-4 sm:px-6 py-3 sm:py-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-xl sm:text-2xl font-bold text-white">
                    ${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={clsx(
                    "flex items-center gap-1 text-sm font-medium",
                    positive ? "text-positive" : "text-negative"
                  )}>
                    {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {positive ? "+" : ""}{changePct.toFixed(2)}%
                  </span>
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {tabs.find((t) => t.ticker === activeTicker)?.name ?? activeTicker} · {activeTicker}
                </div>
              </div>

              {/* Action buttons — icon-only on mobile, label on sm+ */}
              <div className="flex items-center gap-1.5 shrink-0">
                {user && (
                  <>
                    <button
                      onClick={() => watchMutation.mutate()}
                      className={clsx(
                        "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                        isWatched
                          ? "border-accent/50 bg-accent/10 text-accent-light"
                          : "border-border text-muted hover:text-white hover:border-border-strong"
                      )}
                    >
                      <Star size={13} fill={isWatched ? "currentColor" : "none"} />
                      <span className="hidden sm:inline">{isWatched ? "Watching" : "Watch"}</span>
                    </button>
                    <button
                      onClick={openPortModal}
                      className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium bg-accent hover:bg-accent/90 text-white transition-all shadow-lg shadow-accent/20"
                    >
                      <Plus size={13} />
                      <span className="hidden sm:inline">Add to Portfolio</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Range selector — full-width scrollable on mobile */}
            <div className="flex items-center gap-0.5 bg-surface rounded-lg p-1 overflow-x-auto hide-scrollbar">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={clsx(
                    "px-2.5 py-1 rounded-md text-xs font-medium transition-all whitespace-nowrap",
                    range === r
                      ? "bg-accent text-white"
                      : "text-muted hover:text-white"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Chart — fixed height on mobile, fills remaining space on desktop */}
          <div className="h-[300px] sm:h-[360px] lg:flex-1 lg:h-auto px-4 pb-4 lg:min-h-0">
            {chartLoading ? (
              <div className="w-full h-full flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="w-full h-full rounded-xl overflow-hidden bg-surface">
                <CandlestickChart data={bars as never} />
              </div>
            )}
          </div>

          {/* Top Value List */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-border">
                <h3 className="text-sm font-semibold text-white">Top value list</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-4 sm:px-5 py-2.5 text-muted font-medium">Instrument</th>
                      <th className="text-right px-3 sm:px-4 py-2.5 text-muted font-medium">LTP</th>
                      <th className="text-right px-3 sm:px-4 py-2.5 text-muted font-medium">%</th>
                      <th className="text-right px-3 sm:px-4 py-2.5 text-muted font-medium hidden sm:table-cell">Value</th>
                      <th className="text-right px-4 sm:px-5 py-2.5 text-muted font-medium hidden sm:table-cell">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tabs.map((tab) => (
                      <TopValueRow
                        key={tab.ticker}
                        ticker={tab.ticker}
                        name={tab.name}
                        active={tab.ticker === activeTicker}
                        onClick={() => setActiveTicker(tab.ticker)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel — AI: full width below chart on mobile, fixed sidebar on desktop */}
        <aside className="w-full lg:w-72 lg:shrink-0 border-t lg:border-t-0 lg:border-l border-border lg:overflow-y-auto bg-sidebar">
          <AIChartAnalysisPanel
            ticker={activeTicker}
            range={range}
            price={price}
            changePct={changePct}
            bars={bars as never}
          />
        </aside>
      </div>

      {/* Portfolio modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setModal(null)}>
          <div className="bg-surface-raised border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-4">Add {activeTicker} to Portfolio</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-muted mb-1 block">Shares</label>
                <input
                  type="number" min="0.001" step="any"
                  value={modal.shares}
                  onChange={(e) => setModal({ ...modal, shares: e.target.value })}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors"
                />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Avg Buy Price ($)</label>
                <input
                  type="number" min="0" step="any"
                  value={modal.price}
                  onChange={(e) => setModal({ ...modal, price: e.target.value })}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setModal(null)} className="flex-1 py-2.5 rounded-xl text-sm text-muted border border-border hover:border-border-strong transition-colors">
                Cancel
              </button>
              <button
                onClick={() => portMutation.mutate()}
                disabled={portMutation.isPending || !modal.shares || !modal.price}
                className="flex-1 py-2.5 rounded-xl text-sm bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-medium transition-all shadow-lg shadow-accent/20"
              >
                {portMutation.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TopValueRow({
  ticker,
  name,
  active,
  onClick,
}: {
  ticker: string;
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  // Cache reader — seeded by useBatchedQuotes in the page component.
  const { data: quote } = useQuery({
    queryKey: ["quote", ticker],
    queryFn: () => getQuote(ticker),
    staleTime: 90_000,
  });

  const price: number = quote?.price ?? 0;
  const changePct: number = quote?.change_pct ?? 0;
  const volume: number = quote?.volume ?? 0;
  const positive = changePct >= 0;
  const barH = Math.min(100, Math.max(10, (volume / 5e7) * 100));

  return (
    <tr
      onClick={onClick}
      className={clsx(
        "border-b border-border/50 last:border-0 cursor-pointer transition-colors",
        active ? "bg-accent/5" : "hover:bg-surface-hover"
      )}
    >
      <td className="px-4 sm:px-5 py-2.5">
        <div className={clsx("font-semibold", active ? "text-accent-light" : "text-white")}>{ticker}</div>
        <div className="text-[10px] text-muted truncate max-w-[100px] sm:max-w-[120px]">{name}</div>
      </td>
      <td className="px-3 sm:px-4 py-2.5 text-right text-white">{price.toFixed(2)}</td>
      <td className={clsx("px-3 sm:px-4 py-2.5 text-right font-medium", positive ? "text-positive" : "text-negative")}>
        {positive ? "+" : ""}{changePct.toFixed(2)}%
      </td>
      <td className="px-3 sm:px-4 py-2.5 text-right text-muted hidden sm:table-cell">{(price * volume / 1e9).toFixed(2)}B</td>
      <td className="px-4 sm:px-5 py-2.5 text-right hidden sm:table-cell">
        <div className="flex items-end justify-end gap-px h-5">
          {[0.4, 0.6, 0.3, 0.8, 0.5, 1.0, barH / 100].map((h, i) => (
            <div
              key={i}
              className={clsx("w-1 rounded-sm", positive ? "bg-positive/70" : "bg-negative/70")}
              style={{ height: `${h * 20}px` }}
            />
          ))}
        </div>
      </td>
    </tr>
  );
}
