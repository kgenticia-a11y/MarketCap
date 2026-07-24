import client from "./client";
import type { MemoRecommendation, MemoStatus } from "./memos";

export interface QuarterlyMetrics {
  dates: string[];
  revenue: (number | null)[];
  gross_margin: (number | null)[];
  operating_margin: (number | null)[];
  net_margin: (number | null)[];
}

export interface HubMemo {
  id: number;
  ticker: string;
  status: MemoStatus;
  recommendation: MemoRecommendation | null;
  thesis_summary: string | null;
  updated_at: string | null;
  published_at: string | null;
}

export interface HubWatchlistItem {
  id: number;
  ticker: string;
  added_at: string;
  notes: string | null;
  notes_updated_at: string | null;
}

export interface HubPortfolioPosition {
  id: number;
  portfolio_id: number;
  shares: number;
  avg_buy_price: number;
  added_at: string | null;
}

export interface NextEarnings {
  ticker: string;
  earnings_date: string;
  earnings_date_end: string | null;
  eps_estimate: number | null;
  revenue_estimate_b: number | null;
}

export interface TickerHub {
  ticker: string;
  name: string | null;
  price: number | null;
  change_pct: number | null;
  market_cap: number | null;
  sector: string | null;
  industry: string | null;
  revenue_growth_pct: number | null;
  gross_margin_pct: number | null;
  operating_margin_pct: number | null;
  net_margin_pct: number | null;
  roe_pct: number | null;
  debt_to_equity: number | null;
  week_52_high: number | null;
  week_52_low: number | null;
  quarterly: QuarterlyMetrics;
  next_earnings: NextEarnings | null;
  memos: HubMemo[];
  watchlist_item: HubWatchlistItem | null;
  portfolio_positions: HubPortfolioPosition[];
}

export interface NewsItem {
  title: string;
  url: string;
  publisher: string | null;
  published_ts: number | null;
  ai_summary: string | null;
  from_cache: boolean;
}

export interface OwnershipData {
  available: boolean;
  institutional_holders: {
    holder: string;
    shares: number | null;
    pct_out: number | null;
    value: number | null;
    date_reported: string | null;
  }[];
  insider_transactions: {
    name: string;
    title: string;
    transaction: string;
    shares: number | null;
    date: string | null;
  }[];
}

export const getTickerHub = (symbol: string) =>
  client.get(`/ticker/${symbol}/hub`).then((r) => r.data as TickerHub);

export const getTickerNews = (symbol: string) =>
  client.get(`/ticker/${symbol}/news`).then((r) => r.data as NewsItem[]);

export const getTickerOwnership = (symbol: string) =>
  client.get(`/ticker/${symbol}/ownership`).then((r) => r.data as OwnershipData);
