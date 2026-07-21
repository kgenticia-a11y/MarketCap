import { useQuery } from "@tanstack/react-query";
import { getMarketOverview } from "../api/stocks";
import ErrorBoundary from "../components/ErrorBoundary";
import DailyBriefCard from "../components/DailyBriefCard";
import ThesisNudgeCard from "../components/ThesisNudgeCard";
import { TrendingUp, TrendingDown } from "lucide-react";
import { clsx } from "clsx";
import { useNavigate, useSearchParams } from "react-router-dom";
import Watchlist from "./Watchlist";

interface StockSnap {
  ticker: string;
  price: number;
  change_pct: number;
  volume?: number;
}

const INDEX_LABELS: Record<string, string> = {
  SPY: "S&P 500 ETF",
  QQQ: "NASDAQ ETF",
  DIA: "DOW ETF",
};

function IndexCard({ snap }: { snap: StockSnap }) {
  const positive = snap.change_pct >= 0;
  return (
    <div className="bg-surface rounded-xl border border-border p-5 flex items-center justify-between">
      <div>
        <div className="text-xs text-muted mb-1">{INDEX_LABELS[snap.ticker] ?? snap.ticker}</div>
        <div className="text-xl font-bold text-white">
          {snap.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </div>
      </div>
      <div className={clsx(
        "flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-full",
        positive ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
      )}>
        {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        {positive ? "+" : ""}{snap.change_pct.toFixed(2)}%
      </div>
    </div>
  );
}

const TABS = [
  { key: "overview",   label: "Overview" },
  { key: "watchlist",  label: "Watchlist" },
] as const;

type Tab = typeof TABS[number]["key"];

export default function Home() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") ?? "overview") as Tab;

  function setTab(key: Tab) {
    setSearchParams(key === "overview" ? {} : { tab: key }, { replace: true });
  }

  const { data: overview, isLoading: ovLoading, isError: ovError } = useQuery({
    queryKey: ["market-overview"],
    queryFn: getMarketOverview,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 2,
  });

  const gainers: StockSnap[] = overview?.gainers ?? [];
  const losers: StockSnap[] = overview?.losers ?? [];

  // Only take over the page when there is genuinely nothing to show — a
  // failed BACKGROUND refetch used to nuke a perfectly good dashboard.
  if (ovError && !ovLoading && !overview) {
    return (
      <ErrorBoundary label="Dashboard failed to load">
        <div className="p-6 flex flex-col items-center justify-center h-64 gap-3">
          <div className="text-base font-semibold text-white">Market data unavailable</div>
          <div className="text-sm text-muted text-center max-w-sm">
            The backend server isn't reachable. Make sure it's running on port 8000 and try refreshing.
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary label="Dashboard failed to load">
    <div className="p-4 sm:p-6 space-y-5 sm:space-y-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors",
              tab === key
                ? "border-accent text-white"
                : "border-transparent text-muted hover:text-white"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "watchlist" && <Watchlist />}
      {tab === "overview" && <>
      {/* Index overview */}
      {ovLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-surface rounded-xl border border-border h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(overview?.indices ?? []).map((snap: StockSnap) => (
            <IndexCard key={snap.ticker} snap={snap} />
          ))}
        </div>
      )}

      {/* Nudge users to reflect on stale memos before daily brief demands attention. */}
      <ThesisNudgeCard />

      {/* AI Daily Brief */}
      <DailyBriefCard />

      {/* Gainers & Losers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-positive" />
            <span className="text-xs font-semibold text-white">Top Gainers</span>
          </div>
          {ovLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 mx-4 my-1 bg-surface-hover rounded-lg animate-pulse" />
              ))
            : gainers.map((g) => (
                <button
                  key={g.ticker}
                  onClick={() => navigate(`/stock/${g.ticker}`)}
                  className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-surface-hover transition-colors"
                >
                  <span className="text-sm font-semibold text-white">{g.ticker}</span>
                  <div className="text-right">
                    <div className="text-xs text-white">${g.price.toFixed(2)}</div>
                    <div className="text-xs text-positive">{g.change_pct > 0 ? "+" : ""}{g.change_pct.toFixed(2)}%</div>
                  </div>
                </button>
              ))}
        </div>

        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-negative" />
            <span className="text-xs font-semibold text-white">Top Losers</span>
          </div>
          {ovLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 mx-4 my-1 bg-surface-hover rounded-lg animate-pulse" />
              ))
            : losers.map((l) => (
                <button
                  key={l.ticker}
                  onClick={() => navigate(`/stock/${l.ticker}`)}
                  className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-surface-hover transition-colors"
                >
                  <span className="text-sm font-semibold text-white">{l.ticker}</span>
                  <div className="text-right">
                    <div className="text-xs text-white">${l.price.toFixed(2)}</div>
                    <div className="text-xs text-negative">{l.change_pct.toFixed(2)}%</div>
                  </div>
                </button>
              ))}
        </div>
      </div>
      </>}

    </div>
    </ErrorBoundary>
  );
}
