import client from "./client";

export const getPortfolio = () => client.get("/portfolio").then((r) => r.data);

export const addToPortfolio = (ticker: string, shares: number, avg_buy_price: number) =>
  client.post("/portfolio/items", { ticker, shares, avg_buy_price }).then((r) => r.data);

export const removeFromPortfolio = (ticker: string) =>
  client.delete(`/portfolio/items/${ticker}`);

export const updatePortfolioItem = (ticker: string, shares: number, avg_buy_price: number) =>
  client.patch(`/portfolio/items/${ticker}`, { ticker, shares, avg_buy_price }).then((r) => r.data);

export const getPortfolioAnalytics = () =>
  client.get("/portfolio/analytics").then((r) => r.data);

export const getPortfolioHealthScore = () =>
  client.get("/portfolio/health-score").then((r) => r.data);

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
