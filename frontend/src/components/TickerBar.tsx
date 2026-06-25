import { useQuery, useQueries } from "@tanstack/react-query";
import { getMarketOverview, getChart, getQuote } from "../api/stocks";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Search, Menu } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { searchStocks } from "../api/stocks";

const INDEX_LABELS: Record<string, string> = {
  SPY: "S&P 500",
  QQQ: "NASDAQ",
  DIA: "Dow Jones",
};

function MiniSparkline({ ticker, positive }: { ticker: string; positive: boolean }) {
  const { data: chartData } = useQuery({
    queryKey: ["sparkline", ticker],
    queryFn: () => getChart(ticker, "5D"),
    staleTime: 5 * 60_000,
  });

  const bars: Array<{ v: number }> | null = chartData?.results?.length
    ? chartData.results.map((b: { c: number }) => ({ v: b.c }))
    : null;

  if (!bars) {
    // Show a neutral skeleton instead of fake directional data
    return <div className="w-[60px] h-6 rounded bg-surface-hover animate-pulse" />;
  }

  return (
    <ResponsiveContainer width={60} height={24}>
      <LineChart data={bars}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={positive ? "#1ed688" : "#ff5c5c"}
          strokeWidth={1.5}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function TickerCard({ snap }: { snap: Record<string, unknown> }) {
  const ticker = snap.ticker as string;
  const price = (snap.price as number) ?? 0;
  const changePct = (snap.change_pct as number) ?? 0;
  const positive = changePct >= 0;

  return (
    <div className="flex items-center gap-2 px-3 border-r border-border last:border-0 shrink-0">
      <div>
        <div className="text-[10px] text-muted leading-none mb-0.5">{INDEX_LABELS[ticker] ?? ticker}</div>
        <div className="text-xs font-semibold text-white">{price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </div>
      <div className="flex flex-col items-end">
        <span className={`text-[10px] font-medium ${positive ? "text-positive" : "text-negative"}`}>
          {positive ? "+" : ""}{changePct.toFixed(2)}%
        </span>
        <MiniSparkline ticker={ticker} positive={positive} />
      </div>
    </div>
  );
}

export default function TickerBar({ title, onMenuClick }: { title: string; onMenuClick?: () => void }) {
  const [q, setQ]           = useState("");
  const [open, setOpen]     = useState(false);
  const [cursor, setCursor] = useState(-1);
  const inputRef            = useRef<HTMLInputElement>(null);
  const navigate            = useNavigate();

  const [recents, setRecents] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("mc_recent_searches") ?? "[]"); }
    catch { return []; }
  });

  const addRecent = useCallback((ticker: string) => {
    setRecents(prev => {
      const next = [ticker, ...prev.filter(t => t !== ticker)].slice(0, 8);
      localStorage.setItem("mc_recent_searches", JSON.stringify(next));
      return next;
    });
  }, []);

  const clearRecents = useCallback(() => {
    localStorage.removeItem("mc_recent_searches");
    setRecents([]);
  }, []);

  const { data: overview } = useQuery({
    queryKey: ["market-overview"],
    queryFn: getMarketOverview,
    staleTime: 60_000,
  });

  // Debounced query value — only fires after 300 ms of no typing
  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data: searchData } = useQuery({
    queryKey: ["search", debouncedQ],
    queryFn: () => searchStocks(debouncedQ),
    enabled: debouncedQ.length >= 1,
    staleTime: 30_000,
  });

  const searchResults: Array<{ ticker: string; name: string }> =
    searchData?.results?.slice(0, 6) ?? [];

  // Fetch prices for search results (fires only when results are ready)
  const priceQueries = useQueries({
    queries: searchResults.map(r => ({
      queryKey: ["quote", r.ticker],
      queryFn:  () => getQuote(r.ticker),
      staleTime: 60_000,
      enabled:  searchResults.length > 0,
    })),
  });

  const go = useCallback((ticker: string) => {
    setQ(""); setDebouncedQ(""); setOpen(false); setCursor(-1);
    addRecent(ticker);
    navigate(`/stock/${ticker}`);
  }, [navigate, addRecent]);

  // Cmd+K / Ctrl+K focuses search from anywhere
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || searchResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, searchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && cursor >= 0) {
      e.preventDefault();
      go(searchResults[cursor].ticker);
    } else if (e.key === "Escape") {
      setOpen(false); setCursor(-1);
    }
  };

  return (
    <header className="h-14 flex items-center border-b border-border bg-sidebar px-3 sm:px-6 gap-3 sm:gap-6 sticky top-0 z-30">
      {/* Hamburger — mobile only */}
      <button onClick={onMenuClick} className="md:hidden shrink-0 p-1.5 rounded-lg text-muted hover:text-white transition-colors">
        <Menu size={18} />
      </button>

      {/* Page title — narrower on mobile, full width on desktop. Hidden
          on the very smallest viewports so the ticker strip gets the
          room it needs; the page title is also in the document <title>
          so context isn't lost. */}
      <h1 className="text-sm font-semibold text-white whitespace-nowrap shrink-0 hidden sm:block sm:w-36 truncate">{title}</h1>

      {/* Ticker strip */}
      <div className="flex-1 flex items-center overflow-x-auto hide-scrollbar min-w-0">
        {(overview?.indices ?? []).map((snap: Record<string, unknown>) => (
          <TickerCard key={snap.ticker as string} snap={snap} />
        ))}
      </div>

      {/* Search — desktop only. On phones the address-bar real estate
          isn't worth a 192px-wide search box that pushes everything
          else off-screen; users can navigate to /screener for search. */}
      <div className="relative shrink-0 hidden md:block">
        <div className="flex items-center bg-surface rounded-lg px-3 py-2 gap-2 w-48">
          <Search size={14} className="text-muted shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); setCursor(-1); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => { setOpen(false); setCursor(-1); }, 150)}
            onKeyDown={handleKeyDown}
            placeholder="Search… ⌘K"
            className="bg-transparent text-xs text-white placeholder-muted outline-none w-full"
          />
        </div>
        {open && (searchResults.length > 0 || (q.length === 0 && recents.length > 0)) && (
          <div className="absolute top-full mt-1 right-0 w-72 bg-surface-raised border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
            {q.length === 0 && recents.length > 0 ? (
              <>
                <div className="px-4 py-2 flex items-center justify-between border-b border-border">
                  <span className="text-[10px] font-semibold text-muted uppercase tracking-widest">Recent</span>
                  <button onMouseDown={clearRecents} className="text-[10px] text-muted hover:text-negative transition-colors">Clear</button>
                </div>
                {recents.map((ticker, i) => (
                  <button
                    key={ticker}
                    onMouseDown={() => go(ticker)}
                    onMouseEnter={() => setCursor(i)}
                    className={`w-full text-left px-4 py-2.5 transition-colors flex items-center gap-3 ${
                      cursor === i ? "bg-surface-hover" : "hover:bg-surface-hover"
                    }`}
                  >
                    <span className="text-xs font-bold text-white">{ticker}</span>
                  </button>
                ))}
              </>
            ) : (
              searchResults.map((r, i) => {
                const qd = priceQueries[i]?.data;
                const price: number | undefined = qd?.price;
                const pct: number | undefined   = qd?.change_pct;
                const pos = (pct ?? 0) >= 0;
                return (
                  <button
                    key={r.ticker}
                    onMouseDown={() => go(r.ticker)}
                    onMouseEnter={() => setCursor(i)}
                    className={`w-full text-left px-4 py-2.5 transition-colors flex items-center gap-3 ${
                      cursor === i ? "bg-surface-hover" : "hover:bg-surface-hover"
                    }`}
                  >
                    <span className="text-xs font-bold text-white w-14 shrink-0">{r.ticker}</span>
                    <span className="text-xs text-muted truncate flex-1">{r.name}</span>
                    {price != null && (
                      <div className="shrink-0 text-right">
                        <div className="text-xs font-medium text-white">${price.toFixed(2)}</div>
                        <div className={`text-[10px] font-medium ${pos ? "text-positive" : "text-negative"}`}>
                          {pos ? "+" : ""}{pct!.toFixed(2)}%
                        </div>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </header>
  );
}
