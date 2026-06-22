import client from "./client";

export interface PaperState {
  id: number;
  starting_cash: number;
  cash_balance: number;
  created_at: string;
  item_count: number;
}

export interface PaperHolding {
  ticker: string; name: string; sector: string;
  shares: number; avg_buy_price: number; current_price: number;
  cost: number; value: number; pnl: number; pnl_pct: number; allocation_pct: number;
  dividend_yield: number; annual_dividend_per_share: number; annual_dividend_income: number;
  beta: number | null;
}

export interface PaperAnalytics {
  holdings: PaperHolding[];
  total_cost: number;
  total_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  cash_balance: number;
  starting_cash: number;
  equity: number;
  total_return_pct: number;
}

export interface PaperTrade {
  id: number;
  ticker: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  total: number;
  executed_at: string;
}

export const getPaperState = () =>
  client.get<PaperState>("/paper-trading").then((r) => r.data);

export const setupPaperTrading = (starting_cash: number) =>
  client.post<PaperState>("/paper-trading/setup", { starting_cash }).then((r) => r.data);

export const resetPaperTrading = () =>
  client.delete("/paper-trading");

export const getPaperAnalytics = () =>
  client.get<PaperAnalytics>("/paper-trading/analytics").then((r) => r.data);

export const executePaperTrade = (params: {
  ticker: string;
  side: "buy" | "sell";
  shares?: number;
  dollar_amount?: number;
}) =>
  client.post<PaperTrade>("/paper-trading/trades", params).then((r) => r.data);

export const listPaperTrades = (limit = 200) =>
  client.get<PaperTrade[]>(`/paper-trading/trades?limit=${limit}`).then((r) => r.data);
