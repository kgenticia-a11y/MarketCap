import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getNews } from "../api/news";
import NewsCard from "../components/NewsCard";
import { Newspaper } from "lucide-react";
import { clsx } from "clsx";

const FEEDS = [
  { label: "Market", ticker: undefined },
  { label: "Tech",    ticker: "AAPL" },
  { label: "AI",      ticker: "NVDA" },
  { label: "Finance", ticker: "JPM" },
  { label: "Energy",  ticker: "XOM" },
];

export default function News() {
  const [feed, setFeed] = useState(0);
  const { ticker } = FEEDS[feed];

  const { data, isLoading } = useQuery({
    queryKey: ["news-page", ticker ?? "market"],
    queryFn: () => getNews(ticker, 20),
    staleTime: 120_000,
  });

  const items = data?.results ?? [];

  return (
    <div className="p-6">
      {/* Feed tabs */}
      <div className="flex items-center gap-1 mb-6 bg-surface rounded-xl p-1 w-fit border border-border">
        {FEEDS.map((f, i) => (
          <button
            key={f.label}
            onClick={() => setFeed(i)}
            className={clsx(
              "px-4 py-1.5 rounded-lg text-xs font-medium transition-all",
              i === feed
                ? "bg-accent text-white shadow-lg shadow-accent/20"
                : "text-muted hover:text-white"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-28 bg-surface rounded-xl border border-border animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Newspaper size={40} className="text-muted mb-3" />
          <p className="text-sm text-muted">No news available right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {items.map((item: any) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
