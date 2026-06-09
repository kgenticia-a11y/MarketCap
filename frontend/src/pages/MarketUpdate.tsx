import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";
import { clsx } from "clsx";
import { getMarketUpdate } from "../api/stocks";

interface Sector { ticker: string; name: string; price: number; change_pct: number }
interface Stock  { ticker: string; price: number; change_pct: number }
interface Breadth { advances: number; declines: number; unchanged: number; total: number }
interface MarketData { sectors: Sector[]; gainers: Stock[]; losers: Stock[]; breadth: Breadth }

function sectorBg(pct: number) {
  if (pct >  2)   return "bg-positive/25 border-positive/40 text-positive";
  if (pct >  0.5) return "bg-positive/12 border-positive/25 text-positive";
  if (pct >  0)   return "bg-positive/6  border-positive/15 text-positive/75";
  if (pct > -0.5) return "bg-negative/6  border-negative/15 text-negative/75";
  if (pct > -2)   return "bg-negative/12 border-negative/25 text-negative";
  return               "bg-negative/25 border-negative/40 text-negative";
}

function PctBadge({ pct }: { pct: number }) {
  return (
    <span className={clsx("text-xs font-semibold", pct >= 0 ? "text-positive" : "text-negative")}>
      {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

export default function MarketUpdate() {
  const { data, isLoading, isError } = useQuery<MarketData>({
    queryKey: ["market-update"],
    queryFn:  getMarketUpdate,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        {/* breadth skeleton */}
        <div className="h-20 bg-surface rounded-xl animate-pulse" />
        {/* sector grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-2.5">
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} className="h-20 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
        {/* gainers / losers skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[0, 1].map((k) => (
            <div key={k} className="bg-surface rounded-xl border border-border overflow-hidden">
              <div className="h-10 bg-surface-hover" />
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-9 mx-4 my-1 bg-surface-hover rounded-lg animate-pulse" />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64 text-muted text-sm">
        Failed to load market data — please try again.
      </div>
    );
  }

  const sectors = data?.sectors ?? [];
  const gainers = data?.gainers ?? [];
  const losers  = data?.losers  ?? [];
  const breadth = data?.breadth ?? { advances: 0, declines: 0, unchanged: 0, total: 1 };

  const advPct = breadth.total > 0 ? (breadth.advances  / breadth.total) * 100 : 0;
  const decPct = breadth.total > 0 ? (breadth.declines  / breadth.total) * 100 : 0;
  const unchPct = Math.max(0, 100 - advPct - decPct);

  return (
    <div className="p-6 space-y-6">

      {/* ── Market Breadth ──────────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={13} className="text-muted" />
          <h3 className="text-xs font-semibold text-muted uppercase tracking-widest">Market Breadth</h3>
        </div>
        <div className="flex rounded-full overflow-hidden h-3 mb-3 gap-px">
          <div
            style={{ width: `${advPct}%` }}
            className="bg-positive transition-all duration-700 rounded-l-full"
          />
          <div
            style={{ width: `${unchPct}%` }}
            className="bg-surface-hover transition-all duration-700"
          />
          <div
            style={{ width: `${decPct}%` }}
            className="bg-negative transition-all duration-700 rounded-r-full"
          />
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-positive font-semibold">▲ {breadth.advances} Advances</span>
          <span className="text-muted">{breadth.unchanged} Unchanged</span>
          <span className="text-negative font-semibold">▼ {breadth.declines} Declines</span>
        </div>
      </div>

      {/* ── Sector Grid ─────────────────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Sector Performance</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2.5">
          {sectors.map((s) => (
            <Link
              key={s.ticker}
              to={`/stock/${s.ticker}`}
              className={clsx(
                "rounded-xl border p-3.5 flex flex-col gap-1 hover:scale-[1.02] transition-transform cursor-pointer",
                sectorBg(s.change_pct)
              )}
            >
              <div className="text-[10px] font-bold opacity-60 tracking-wider">{s.ticker}</div>
              <div className="text-xs font-medium leading-tight opacity-90">{s.name}</div>
              <div className="text-sm font-bold mt-1">
                {s.change_pct >= 0 ? "+" : ""}{s.change_pct.toFixed(2)}%
              </div>
              <div className="text-[10px] opacity-50">${s.price.toFixed(2)}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Gainers / Losers ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Gainers */}
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-surface-hover/40">
            <TrendingUp size={13} className="text-positive" />
            <h3 className="text-xs font-semibold text-white uppercase tracking-widest">Top Gainers</h3>
          </div>
          <div>
            {gainers.map((s, i) => (
              <Link
                key={s.ticker}
                to={`/stock/${s.ticker}`}
                className="flex items-center justify-between px-5 py-2.5 border-b border-border/40 last:border-0 hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted w-4 text-right">{i + 1}</span>
                  <span className="text-sm font-semibold text-white">{s.ticker}</span>
                </div>
                <div className="flex items-center gap-5">
                  <span className="text-xs text-muted">${s.price.toFixed(2)}</span>
                  <PctBadge pct={s.change_pct} />
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Losers */}
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-surface-hover/40">
            <TrendingDown size={13} className="text-negative" />
            <h3 className="text-xs font-semibold text-white uppercase tracking-widest">Top Losers</h3>
          </div>
          <div>
            {losers.map((s, i) => (
              <Link
                key={s.ticker}
                to={`/stock/${s.ticker}`}
                className="flex items-center justify-between px-5 py-2.5 border-b border-border/40 last:border-0 hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted w-4 text-right">{i + 1}</span>
                  <span className="text-sm font-semibold text-white">{s.ticker}</span>
                </div>
                <div className="flex items-center gap-5">
                  <span className="text-xs text-muted">${s.price.toFixed(2)}</span>
                  <PctBadge pct={s.change_pct} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
