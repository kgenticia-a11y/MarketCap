import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, Newspaper, Sparkles, TrendingDown, TrendingUp, Minus } from "lucide-react";

import {
  getNewsFeed, generateNewsImpact,
  type NewsFeedItem, type NewsFilter,
} from "../api/news";

/* ── Helpers ────────────────────────────────────────────────────────────── */

function fmtDate(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: "short", day: "numeric",
  });
}

function SkeletonBox({ className }: { className?: string }) {
  return <div className={clsx("bg-surface-raised rounded-xl animate-pulse", className)} />;
}

const IMPACT_CONFIG = {
  strengthens: {
    label: "Strengthens thesis",
    color: "text-positive",
    bg: "bg-positive/10 border-positive/20",
    Icon: TrendingUp,
  },
  weakens: {
    label: "Weakens thesis",
    color: "text-negative",
    bg: "bg-negative/10 border-negative/20",
    Icon: TrendingDown,
  },
  neutral: {
    label: "Neutral",
    color: "text-muted",
    bg: "bg-surface-raised border-border",
    Icon: Minus,
  },
} as const;

const FILTER_OPTIONS: { value: NewsFilter; label: string }[] = [
  { value: "all", label: "All tracked" },
  { value: "memos", label: "Memo tickers" },
  { value: "watchlist", label: "Watchlist" },
  { value: "portfolio", label: "Portfolio" },
];

/* ── News item card ─────────────────────────────────────────────────────── */

function NewsCard({
  item,
  onFlag,
  isFlagging,
}: {
  item: NewsFeedItem;
  onFlag: () => void;
  isFlagging: boolean;
}) {
  const impact = item.impact ? IMPACT_CONFIG[item.impact] : null;

  return (
    <div className="p-4 hover:bg-surface-hover/30 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Ticker badge */}
          <Link
            to={`/ticker/${item.ticker}`}
            className="inline-block text-[10px] font-bold uppercase tracking-widest text-accent bg-accent/10 px-2 py-0.5 rounded-md hover:bg-accent/20 transition-colors"
          >
            {item.ticker}
          </Link>

          {/* Headline */}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-medium text-white hover:text-accent-light transition-colors leading-snug"
          >
            {item.title}
          </a>

          {/* AI summary */}
          {item.ai_summary && (
            <p className="text-xs text-muted/80 leading-relaxed italic">
              {item.ai_summary}
            </p>
          )}

          {/* Impact badge */}
          {impact ? (
            <div className={clsx("inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium", impact.bg, impact.color)}>
              <impact.Icon size={11} />
              {impact.label}
              {item.impact_reason && (
                <span className="text-[11px] font-normal opacity-80 ml-1">— {item.impact_reason}</span>
              )}
            </div>
          ) : item.has_memo ? (
            <button
              onClick={onFlag}
              disabled={isFlagging}
              className="inline-flex items-center gap-1 text-xs text-accent/70 hover:text-accent transition-colors disabled:opacity-50"
            >
              <Sparkles size={11} />
              {isFlagging ? "Assessing…" : "Assess thesis impact"}
            </button>
          ) : null}

          {/* Meta */}
          <div className="flex items-center gap-2">
            {item.publisher && (
              <span className="text-[11px] text-muted">{item.publisher}</span>
            )}
            {item.published_ts && (
              <span className="text-[11px] text-muted/60">{fmtDate(item.published_ts)}</span>
            )}
          </div>
        </div>

        {/* External link */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted hover:text-white transition-colors mt-0.5"
        >
          <ExternalLink size={13} />
        </a>
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

export default function News() {
  const [filter, setFilter] = useState<NewsFilter>("all");
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["news-feed", filter],
    queryFn: () => getNewsFeed(filter),
    staleTime: 10 * 60_000,
    retry: 1,
  });

  // Track which URLs are being flagged
  const [flagging, setFlagging] = useState<Set<string>>(new Set());

  const impactMutation = useMutation({
    mutationFn: (item: NewsFeedItem) =>
      generateNewsImpact(
        item.memo_id!,
        item.url,
        item.title,
        item.ticker,
        item.published_ts ? new Date(item.published_ts * 1000).toISOString() : null,
      ),
    onMutate: (item) => {
      setFlagging((prev) => new Set(prev).add(item.url));
    },
    onSuccess: (_, item) => {
      setFlagging((prev) => {
        const next = new Set(prev);
        next.delete(item.url);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["news-feed", filter] });
    },
    onError: (_err, item) => {
      setFlagging((prev) => {
        const next = new Set(prev);
        next.delete(item.url);
        return next;
      });
      toast.error("Failed to assess thesis impact. Try again.");
    },
  });

  const items = data?.items ?? [];

  // Group by date
  const grouped = items.reduce<Record<string, NewsFeedItem[]>>((acc, item) => {
    const label = item.published_ts
      ? new Date(item.published_ts * 1000).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
      : "Unknown date";
    acc[label] = [...(acc[label] ?? []), item];
    return acc;
  }, {});

  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Newspaper size={20} className="text-accent" />
        <h1 className="text-xl font-bold text-white">News Feed</h1>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-surface rounded-xl border border-border px-3 py-2">
          <span className="text-xs text-muted">Show</span>
          <div className="relative">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as NewsFilter)}
              className="appearance-none bg-transparent text-sm text-white pr-6 outline-none cursor-pointer"
            >
              {FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-0 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          </div>
        </div>

        {data && (
          <span className="text-xs text-muted ml-auto">
            {items.length} article{items.length !== 1 ? "s" : ""} from {data.tickers_checked} ticker{data.tickers_checked !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Impact legend — only if memos in scope */}
      {!isLoading && items.some((i) => i.has_memo) && (
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted">
          <span>Thesis impact:</span>
          {(["strengthens", "weakens", "neutral"] as const).map((k) => {
            const cfg = IMPACT_CONFIG[k];
            return (
              <span key={k} className={clsx("flex items-center gap-1", cfg.color)}>
                <cfg.Icon size={11} /> {cfg.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-surface rounded-xl border border-border p-4 space-y-2">
              <SkeletonBox className="h-3 w-16" />
              <SkeletonBox className="h-4 w-4/5" />
              <SkeletonBox className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-muted text-sm">Failed to load news feed. Try again later.</p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center space-y-3">
          <Newspaper size={32} className="text-muted mx-auto" />
          <p className="text-sm text-muted">No news for your tracked tickers yet.</p>
          <p className="text-xs text-muted/60">
            Add tickers to your watchlist or portfolio to see news here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([dateLabel, dateItems]) => (
            <div key={dateLabel}>
              <h2 className="text-xs font-semibold text-muted uppercase tracking-widest mb-2 px-1">
                {dateLabel}
              </h2>
              <div className="bg-surface rounded-xl border border-border divide-y divide-border/50">
                {dateItems.map((item) => (
                  <NewsCard
                    key={`${item.ticker}-${item.url}`}
                    item={item}
                    onFlag={() => impactMutation.mutate(item)}
                    isFlagging={flagging.has(item.url)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
