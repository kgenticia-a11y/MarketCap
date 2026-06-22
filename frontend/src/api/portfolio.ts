import client from "./client";

export const getPortfolio = () => client.get("/portfolio").then((r) => r.data);

export const addToPortfolio = (
  ticker: string, shares: number, avg_buy_price: number, account_id?: number | null,
) =>
  client.post("/portfolio/items", {
    ticker, shares, avg_buy_price,
    ...(account_id != null ? { account_id } : {}),
  }).then((r) => r.data);

function withAccount(params?: { account_id?: number | null }) {
  return params?.account_id != null ? { account_id: params.account_id } : undefined;
}

export const removeFromPortfolio = (ticker: string, account_id?: number | null) =>
  client.delete(`/portfolio/items/${ticker}`, { params: withAccount({ account_id }) });

export const updatePortfolioItem = (
  ticker: string, shares: number, avg_buy_price: number, account_id?: number | null,
) =>
  client.patch(`/portfolio/items/${ticker}`, { ticker, shares, avg_buy_price }, {
    params: withAccount({ account_id }),
  }).then((r) => r.data);

export const getPortfolioAnalytics = (account_id?: number | null) =>
  client.get("/portfolio/analytics", { params: withAccount({ account_id }) }).then((r) => r.data);

export const getPortfolioHealthScore = (account_id?: number | null) =>
  client.get("/portfolio/health-score", { params: withAccount({ account_id }) }).then((r) => r.data);

export interface RiskProfile {
  horizon: string;
  tolerance: string;
  goal: string;
}

export const analyzePortfolio = (
  holdings: object[],
  riskProfile: RiskProfile | null,
  totalValue: number,
  totalPnlPct: number,
) =>
  client.post("/portfolio/analyze", {
    holdings,
    risk_profile: riskProfile,
    total_value: totalValue,
    total_pnl_pct: totalPnlPct,
  }).then((r) => r.data);
