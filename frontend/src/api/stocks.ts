import client from "./client";

export const searchStocks = (q: string) =>
  client.get("/stocks/search", { params: { q } }).then((r) => r.data);

export const getQuote = (ticker: string) =>
  client.get(`/stocks/quote/${ticker}`).then((r) => r.data);

export const getQuotes = (tickers: string[]) =>
  client.get("/stocks/quotes", { params: { tickers: tickers.join(",") } }).then((r) => r.data);

export const getDetails = (ticker: string) =>
  client.get(`/stocks/details/${ticker}`).then((r) => r.data);

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

