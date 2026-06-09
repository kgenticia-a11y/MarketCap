import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import client from "../api/client";
import { clsx } from "clsx";
import { History as HistoryIcon, Star, TrendingUp, Lock } from "lucide-react";
import { format, parseISO, isToday, isYesterday, isThisWeek } from "date-fns";

interface Event {
  id: string;
  type: "portfolio_buy" | "watchlist_add";
  ticker: string;
  detail: string;
  amount: number | null;
  date: string | null;
}

const getHistory = () => client.get("/history").then((r) => r.data as Event[]);

function friendlyDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = parseISO(iso);
    if (isToday(d))     return `Today ${format(d, "h:mm a")}`;
    if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
    if (isThisWeek(d))  return format(d, "EEEE h:mm a");
    return format(d, "MMM d, yyyy");
  } catch {
    return iso;
  }
}

function groupByDate(events: Event[]): Map<string, Event[]> {
  const map = new Map<string, Event[]>();
  for (const ev of events) {
    const key = ev.date ? format(parseISO(ev.date), "yyyy-MM-dd") : "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ev);
  }
  return map;
}

function groupLabel(dateKey: string): string {
  try {
    const d = parseISO(dateKey);
    if (isToday(d))     return "Today";
    if (isYesterday(d)) return "Yesterday";
    if (isThisWeek(d))  return format(d, "EEEE");
    return format(d, "MMMM d, yyyy");
  } catch {
    return dateKey;
  }
}

function EventRow({ ev }: { ev: Event }) {
  const isPortfolio = ev.type === "portfolio_buy";
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b border-border/40 last:border-0 hover:bg-surface-hover transition-colors">
      {/* Icon */}
      <div className={clsx(
        "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
        isPortfolio ? "bg-accent/15" : "bg-amber-500/15"
      )}>
        {isPortfolio
          ? <TrendingUp size={14} className="text-accent-light" />
          : <Star      size={14} className="text-amber-400" />}
      </div>

      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            to={`/stock/${ev.ticker}`}
            className="text-sm font-semibold text-white hover:text-accent-light transition-colors"
          >
            {ev.ticker}
          </Link>
          <span className={clsx(
            "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
            isPortfolio ? "bg-accent/20 text-accent-light" : "bg-amber-500/20 text-amber-400"
          )}>
            {isPortfolio ? "BUY" : "WATCH"}
          </span>
        </div>
        <p className="text-xs text-muted truncate">{ev.detail}</p>
      </div>

      {/* Right side */}
      <div className="text-right shrink-0">
        {ev.amount != null && (
          <div className="text-sm font-medium text-white">
            ${ev.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </div>
        )}
        <div className="text-[10px] text-muted">{friendlyDate(ev.date)}</div>
      </div>
    </div>
  );
}

export default function History() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<Event[]>({
    queryKey: ["history"],
    queryFn:  getHistory,
    enabled:  !!user,
    staleTime: 30_000,
  });

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <Lock size={36} className="text-muted" />
        <p className="text-sm text-muted">
          <Link to="/login" className="text-accent-light hover:text-accent">Sign in</Link>
          {" "}to view your activity history.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 bg-surface rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const events: Event[] = data ?? [];

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <HistoryIcon size={36} className="text-muted" />
        <p className="text-sm text-muted">No activity yet — add stocks to your portfolio or watchlist.</p>
      </div>
    );
  }

  const groups = groupByDate(events);

  return (
    <div className="p-6 w-full">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Total Events",   value: events.length },
          { label: "Portfolio Buys", value: events.filter(e => e.type === "portfolio_buy").length },
          { label: "Watchlist Adds", value: events.filter(e => e.type === "watchlist_add").length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-surface rounded-xl border border-border p-4 text-center">
            <div className="text-2xl font-bold text-white">{value}</div>
            <div className="text-[10px] text-muted mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Timeline groups */}
      <div className="space-y-4">
        {Array.from(groups.entries()).map(([dateKey, evs]) => (
          <div key={dateKey}>
            <div className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1.5 px-1">
              {groupLabel(dateKey)}
            </div>
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              {evs.map((ev) => <EventRow key={ev.id} ev={ev} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
