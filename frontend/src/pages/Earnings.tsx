import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Calendar, ChevronDown, FileText } from "lucide-react";

import { getUserEarningsCalendar, type CalendarFilter } from "../api/earnings";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function SkeletonBox({ className }: { className?: string }) {
  return <div className={clsx("bg-surface-raised rounded-xl animate-pulse", className)} />;
}

const FILTER_OPTIONS: { value: CalendarFilter; label: string }[] = [
  { value: "all", label: "All tracked" },
  { value: "watchlist", label: "Watchlist" },
  { value: "portfolio", label: "Portfolio" },
  { value: "memos", label: "With memos" },
];

const WEEKS_OPTIONS = [
  { value: 2, label: "2 weeks" },
  { value: 4, label: "4 weeks" },
  { value: 8, label: "8 weeks" },
  { value: 12, label: "12 weeks" },
];

/* ── Page ────────────────────────────────────────────────────────────── */

export default function Earnings() {
  const [weeks, setWeeks] = useState(4);
  const [filter, setFilter] = useState<CalendarFilter>("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["earnings-calendar", weeks, filter],
    queryFn: () => getUserEarningsCalendar(weeks, filter),
    staleTime: 15 * 60_000,
    retry: 1,
  });

  const events = data?.events ?? [];

  // Group events by ISO week label (e.g. "Week of Jul 28")
  const grouped = events.reduce<Record<string, typeof events>>((acc, event) => {
    const d = new Date(event.date + "T00:00:00");
    // Monday of that week
    const dow = d.getDay();
    const diff = (dow === 0 ? -6 : 1 - dow);
    const mon = new Date(d);
    mon.setDate(d.getDate() + diff);
    const key = mon.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const label = `Week of ${key}`;
    acc[label] = [...(acc[label] ?? []), event];
    return acc;
  }, {});

  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Calendar size={20} className="text-accent" />
        <h1 className="text-xl font-bold text-white">Earnings Calendar</h1>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-surface rounded-xl border border-border px-3 py-2">
          <span className="text-xs text-muted">Show</span>
          <div className="relative">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as CalendarFilter)}
              className="appearance-none bg-transparent text-sm text-white pr-6 outline-none cursor-pointer"
            >
              {FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-0 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
        </div>

        <div className="flex items-center gap-2 bg-surface rounded-xl border border-border px-3 py-2">
          <span className="text-xs text-muted">Within</span>
          <div className="relative">
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="appearance-none bg-transparent text-sm text-white pr-6 outline-none cursor-pointer"
            >
              {WEEKS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-0 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
        </div>

        {data && (
          <span className="text-xs text-muted ml-auto">
            {events.length} event{events.length !== 1 ? "s" : ""} across {data.tickers_checked} ticker{data.tickers_checked !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <SkeletonBox className="h-5 w-32" />
              {Array.from({ length: 3 }).map((_, j) => (
                <SkeletonBox key={j} className="h-16" />
              ))}
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-muted text-sm">Failed to load earnings calendar. Try again later.</p>
        </div>
      ) : events.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center space-y-3">
          <Calendar size={32} className="text-muted mx-auto" />
          <p className="text-sm text-muted">
            No upcoming earnings in the next {weeks} {weeks === 1 ? "week" : "weeks"} for your tracked tickers.
          </p>
          <p className="text-xs text-muted/60">
            Add tickers to your watchlist or portfolio to see their earnings here.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([weekLabel, weekEvents]) => (
            <div key={weekLabel}>
              <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-2 px-1">
                {weekLabel}
              </h2>
              <div className="bg-surface rounded-xl border border-border divide-y divide-border/50">
                {weekEvents.map((event) => {
                  const days = daysUntil(event.date);
                  return (
                    <div key={event.ticker} className="p-4">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        {/* Left: ticker + date */}
                        <div className="flex items-center gap-3 min-w-0">
                          <Link
                            to={`/ticker/${event.ticker}`}
                            className="text-base font-bold text-white hover:text-accent transition-colors"
                          >
                            {event.ticker}
                          </Link>
                          <div className="min-w-0">
                            <span className="text-sm text-muted">{fmtDate(event.date)}</span>
                            {event.date_end && event.date_end !== event.date && (
                              <span className="text-sm text-muted"> – {fmtDate(event.date_end)}</span>
                            )}
                          </div>
                        </div>

                        {/* Right: countdown + indicators */}
                        <div className="flex items-center gap-3 shrink-0">
                          {event.has_memo && (
                            <Link
                              to={`/ticker/${event.ticker}`}
                              title="You have a memo for this ticker"
                              className="text-accent"
                            >
                              <FileText size={13} />
                            </Link>
                          )}
                          <span className={clsx(
                            "text-xs font-semibold px-2 py-1 rounded-lg",
                            days === 0
                              ? "bg-accent/20 text-accent"
                              : days <= 3
                              ? "bg-yellow-500/10 text-yellow-400"
                              : "bg-surface-raised text-muted",
                          )}>
                            {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d`}
                          </span>
                        </div>
                      </div>

                      {/* Estimates */}
                      {(event.eps_estimate != null || event.revenue_estimate_b != null) && (
                        <div className="flex items-center gap-4 mt-2">
                          {event.eps_estimate != null && (
                            <div className="text-xs text-muted">
                              EPS est. <span className="text-white font-medium">${event.eps_estimate.toFixed(2)}</span>
                            </div>
                          )}
                          {event.revenue_estimate_b != null && (
                            <div className="text-xs text-muted">
                              Rev est. <span className="text-white font-medium">${event.revenue_estimate_b.toFixed(1)}B</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
