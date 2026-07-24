import client from "./client";

export interface NewsFeedItem {
  ticker: string;
  title: string;
  url: string;
  publisher: string | null;
  published_ts: number | null;
  ai_summary: string | null;
  has_memo: boolean;
  memo_id: number | null;
  impact: "strengthens" | "weakens" | "neutral" | null;
  impact_reason: string | null;
  impact_id: number | null;
}

export interface NewsFeed {
  items: NewsFeedItem[];
  tickers_checked: number;
}

export interface NewsImpactResult {
  id: number;
  memo_id: number;
  url: string;
  ticker: string;
  headline: string;
  impact: "strengthens" | "weakens" | "neutral";
  impact_reason: string | null;
  created_at: string | null;
  from_cache: boolean;
}

export type NewsFilter = "all" | "watchlist" | "portfolio" | "memos";

export const getNewsFeed = (filter: NewsFilter = "all") =>
  client.get("/news/feed", { params: { filter } }).then((r) => r.data as NewsFeed);

export const generateNewsImpact = (
  memo_id: number,
  url: string,
  headline: string,
  ticker: string,
  published_at: string | null,
) =>
  client
    .post("/news/impact/generate", { memo_id, url, headline, ticker, published_at })
    .then((r) => r.data as NewsImpactResult);
