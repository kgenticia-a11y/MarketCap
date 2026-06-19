import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Eye,
  Star,
  Briefcase,
  Clock,
} from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { getMarketUpdate, getEarningsCalendar } from "../api/stocks";
import { getWatchlist, addToWatchlist } from "../api/watchlist";
import { getPortfolio } from "../api/portfolio";

/* ── Shared types ──────────────────────────────────────────────────────── */

interface Sector { ticker: string; name: string; price: number; change_pct: number }
interface Stock  { ticker: string; price: number; change_pct: number }
interface Breadth { advances: number; declines: number; unchanged: number; total: number }
interface MarketData { sectors: Sector[]; gainers: Stock[]; losers: Stock[]; breadth: Breadth }

interface EarningsCompany {
  ticker: string;
  name: string;
  time: "BMO" | "AMC" | "DMH";
  eps_estimate: number;
  eps_actual_prev: number;
  beat_history: string;
}

interface EarningsDay {
  date: string;
  day: string;
  companies: EarningsCompany[];
}

interface EarningsData {
  week_start: string;
  week_end: string;
  days: Record<string, EarningsDay>;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

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

function formatWeekLabel(start: string, end: string) {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`;
}

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;

/* ── Overview Tab ──────────────────────────────────────────────────────── */

function OverviewTab() {
  const { data, isLoading, isError } = useQuery<MarketData>({
    queryKey: ["market-update"],
    queryFn:  getMarketUpdate,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-20 bg-surface rounded-xl animate-pulse" />
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-2.5">
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} className="h-20 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
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
    <div className="space-y-6">

      {/* Market Breadth */}
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

      {/* Sector Grid */}
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

      {/* Gainers / Losers */}
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

/* ── Earnings Tab ──────────────────────────────────────────────────────── */

type EarningsFilter = "all" | "watchlist" | "portfolio";

function TimeBadge({ time }: { time: string }) {
  const styles: Record<string, string> = {
    BMO: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    AMC: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    DMH: "bg-surface-hover text-muted border-border",
  };
  const labels: Record<string, string> = {
    BMO: "Before Open",
    AMC: "After Close",
    DMH: "During Market",
  };
  return (
    <span className={clsx("text-[10px] font-semibold px-1.5 py-0.5 rounded border", styles[time] || styles.DMH)}>
      {labels[time] || time}
    </span>
  );
}

function BeatBadge({ history }: { history: string }) {
  const [beats, total] = history.split("/").map(Number);
  const ratio = total > 0 ? beats / total : 0;
  const color = ratio >= 0.75
    ? "bg-positive/15 text-positive border-positive/30"
    : ratio >= 0.5
    ? "bg-yellow-500/15 text-yellow-400 border-yellow-500/30"
    : "bg-negative/15 text-negative border-negative/30";
  return (
    <span className={clsx("text-[10px] font-semibold px-1.5 py-0.5 rounded border", color)}>
      Beat {history}
    </span>
  );
}

function EarningsTab() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [filter, setFilter] = useState<EarningsFilter>("all");
  const queryClient = useQueryClient();

  const { data: earningsData, isLoading, isError } = useQuery<EarningsData>({
    queryKey: ["earnings-calendar", weekOffset],
    queryFn:  () => getEarningsCalendar(weekOffset),
    staleTime: 300_000,
  });

  const { data: watchlist } = useQuery<{ ticker: string }[]>({
    queryKey: ["watchlist"],
    queryFn:  getWatchlist,
    staleTime: 60_000,
  });

  const { data: portfolio } = useQuery<{ ticker: string }[]>({
    queryKey: ["portfolio"],
    queryFn:  getPortfolio,
    staleTime: 60_000,
  });

  const watchlistMut = useMutation({
    mutationFn: addToWatchlist,
    onSuccess: (_data, ticker) => {
      toast.success(`${ticker} added to watchlist`);
      queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    },
    onError: () => toast.error("Failed to add to watchlist"),
  });

  const watchlistTickers = new Set((watchlist ?? []).map((w) => w.ticker));
  const portfolioTickers = new Set((portfolio ?? []).map((p) => p.ticker));

  function filterCompanies(companies: EarningsCompany[]): EarningsCompany[] {
    if (filter === "watchlist") return companies.filter((c) => watchlistTickers.has(c.ticker));
    if (filter === "portfolio") return companies.filter((c) => portfolioTickers.has(c.ticker));
    return companies;
  }

  const weekLabel = earningsData
    ? formatWeekLabel(earningsData.week_start, earningsData.week_end)
    : "Loading...";

  const thisWeekLabel = weekOffset === 0 ? "This Week" : weekOffset === 1 ? "Next Week" : weekOffset === -1 ? "Last Week" : `Week ${weekOffset > 0 ? "+" : ""}${weekOffset}`;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-12 bg-surface rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-64 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-64 text-muted text-sm">
        Failed to load earnings calendar — please try again.
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Week selector */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setWeekOffset((w) => Math.max(-4, w - 1))}
          className="flex items-center gap-1 text-xs text-muted hover:text-white transition-colors px-3 py-2 rounded-lg bg-surface border border-border hover:border-border-hover"
        >
          <ChevronLeft size={14} /> Previous
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold text-white">{thisWeekLabel}</div>
          <div className="text-[11px] text-muted">{weekLabel}</div>
        </div>
        <button
          onClick={() => setWeekOffset((w) => Math.min(8, w + 1))}
          className="flex items-center gap-1 text-xs text-muted hover:text-white transition-colors px-3 py-2 rounded-lg bg-surface border border-border hover:border-border-hover"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>

      {/* Filter toggles */}
      <div className="flex gap-1 bg-surface rounded-xl border border-border p-1">
        {([
          { key: "all", label: "All Earnings", icon: Calendar },
          { key: "watchlist", label: "My Watchlist", icon: Star },
          { key: "portfolio", label: "My Portfolio", icon: Briefcase },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-colors",
              filter === key ? "bg-accent text-white" : "text-muted hover:text-white"
            )}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* 5-column day grid */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {DAY_ORDER.map((dayName) => {
          const dayData = earningsData?.days[dayName];
          const companies = filterCompanies(dayData?.companies ?? []);
          const dateStr = dayData?.date ?? "";
          const dateObj = dateStr ? new Date(dateStr + "T00:00:00") : null;
          const dayLabel = dateObj
            ? dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "";

          return (
            <div key={dayName} className="bg-surface rounded-xl border border-border overflow-hidden">
              {/* Day header */}
              <div className="px-4 py-2.5 border-b border-border bg-surface-hover/40">
                <div className="text-xs font-semibold text-white">{dayName}</div>
                <div className="text-[10px] text-muted">{dayLabel}</div>
              </div>

              {/* Company cards */}
              <div className="p-2 space-y-2">
                {companies.length === 0 ? (
                  <div className="text-[11px] text-muted text-center py-6">
                    {filter !== "all" ? "No matching earnings" : "No earnings"}
                  </div>
                ) : (
                  companies.map((c) => (
                    <div
                      key={c.ticker}
                      className="rounded-lg border border-border p-3 space-y-2 hover:border-border-hover transition-colors"
                    >
                      {/* Ticker + name */}
                      <div>
                        <Link to={`/stock/${c.ticker}`} className="text-xs font-bold text-white hover:text-accent transition-colors">
                          {c.ticker}
                        </Link>
                        <div className="text-[10px] text-muted leading-tight truncate">{c.name}</div>
                      </div>

                      {/* Badges */}
                      <div className="flex flex-wrap gap-1">
                        <TimeBadge time={c.time} />
                        <BeatBadge history={c.beat_history} />
                      </div>

                      {/* EPS data */}
                      <div className="flex items-center justify-between text-[10px]">
                        <div>
                          <span className="text-muted">Est. </span>
                          <span className="text-white font-semibold">${c.eps_estimate.toFixed(2)}</span>
                        </div>
                        <div>
                          <span className="text-muted">Prev. </span>
                          <span className="text-white font-semibold">${c.eps_actual_prev.toFixed(2)}</span>
                        </div>
                      </div>

                      {/* Watch button */}
                      {!watchlistTickers.has(c.ticker) ? (
                        <button
                          onClick={() => watchlistMut.mutate(c.ticker)}
                          disabled={watchlistMut.isPending}
                          className="w-full flex items-center justify-center gap-1 text-[10px] font-semibold text-muted hover:text-accent py-1.5 rounded-md border border-border hover:border-accent/40 transition-colors"
                        >
                          <Eye size={10} />
                          Watch
                        </button>
                      ) : (
                        <div className="flex items-center justify-center gap-1 text-[10px] font-semibold text-accent/60 py-1.5">
                          <Star size={10} />
                          Watching
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────────── */

export default function MarketUpdate() {
  const [tab, setTab] = useState<"overview" | "earnings">("overview");

  return (
    <div className="p-6 space-y-6">

      {/* Tab bar */}
      <div className="flex gap-1 bg-surface rounded-xl border border-border p-1">
        {([
          { key: "overview", label: "Market Overview", icon: Activity },
          { key: "earnings", label: "Earnings Calendar", icon: Clock },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-semibold transition-colors",
              tab === key ? "bg-accent text-white" : "text-muted hover:text-white"
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" ? <OverviewTab /> : <EarningsTab />}
    </div>
  );
}
