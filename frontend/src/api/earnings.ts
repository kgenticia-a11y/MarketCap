import client from "./client";

export interface EarningsEvent {
  ticker: string;
  date: string;
  date_end: string | null;
  eps_estimate: number | null;
  revenue_estimate_b: number | null;
  has_memo: boolean;
}

export interface EarningsCalendar {
  events: EarningsEvent[];
  tickers_checked: number;
}

export interface EarningsRecap {
  id: number;
  ticker: string;
  memo_id: number | null;
  earnings_date: string;
  recap: {
    thesis_assessment: string;
    key_impact: "strengthens" | "weakens" | "neutral";
    key_impact_aspect: string;
    suggested_checkpoint_notes: string;
    generated_for_ticker?: string;
    earnings_date?: string;
  };
  created_at: string | null;
  from_cache?: boolean;
}

export type CalendarFilter = "all" | "watchlist" | "portfolio" | "memos";

export const getUserEarningsCalendar = (weeks: number = 4, filter: CalendarFilter = "all") =>
  client
    .get("/earnings/calendar", { params: { weeks, filter } })
    .then((r) => r.data as EarningsCalendar);

export const getEarningsRecap = (
  ticker: string,
  opts?: { memo_id?: number; earnings_date?: string },
) =>
  client
    .get(`/earnings/recap/${ticker}`, { params: opts })
    .then((r) => r.data as EarningsRecap);

export const generateEarningsRecap = (
  ticker: string,
  memo_id: number,
  earnings_date: string,
) =>
  client
    .post("/earnings/recap/generate", { ticker, memo_id, earnings_date })
    .then((r) => r.data as EarningsRecap);
