import client from "./client";

export const searchStocks = (q: string) =>
  client.get("/stocks/search", { params: { q } }).then((r) => r.data);

export const getQuote = (ticker: string) =>
  client.get(`/stocks/quote/${ticker}`).then((r) => r.data);

export const getQuotes = (tickers: string[]) =>
  client.get("/stocks/quotes", { params: { tickers: tickers.join(",") } }).then((r) => r.data);

export const getDetails = (ticker: string) =>
  client.get(`/stocks/details/${ticker}`).then((r) => r.data);

export interface Fundamentals {
  ticker: string;
  name: string;
  market_cap: number | null;
  price: number | null;
  pe: number | null;
  forward_pe: number | null;
  ps: number | null;
  ev_to_ebitda: number | null;
  revenue_growth_pct: number | null;
  earnings_growth_pct: number | null;
  gross_margin_pct: number | null;
  operating_margin_pct: number | null;
  profit_margin_pct: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  roe_pct: number | null;
  free_cash_flow: number | null;
  total_revenue: number | null;
  shares_outstanding: number | null;
  total_debt: number | null;
  total_cash: number | null;
}

export const getFundamentals = (ticker: string) =>
  client.get(`/stocks/fundamentals/${ticker}`).then((r) => r.data as Fundamentals);

export const getChart = (ticker: string, range: string) =>
  client.get(`/stocks/chart/${ticker}`, { params: { range } }).then((r) => r.data);

export const getMarketOverview = () =>
  client.get("/stocks/market/overview").then((r) => r.data);

export const getIncomeData = (ticker: string) =>
  client.get(`/stocks/income/${ticker}`).then((r) => r.data);

export const getMarketUpdate = () =>
  client.get("/stocks/market/update").then((r) => r.data);

export const getEarningsCalendar = (weekOffset: number = 0) =>
  client.get("/stocks/earnings/calendar", { params: { week_offset: weekOffset } }).then((r) => r.data);

export const getEconomicCalendar = (weekOffset: number = 0) =>
  client.get("/stocks/economic/calendar", { params: { week_offset: weekOffset } }).then((r) => r.data);

