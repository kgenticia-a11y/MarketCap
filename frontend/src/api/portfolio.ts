import client from "./client";

export const getPortfolio = () => client.get("/portfolio").then((r) => r.data);

export const addToPortfolio = (ticker: string, shares: number, avg_buy_price: number) =>
  client.post("/portfolio/items", { ticker, shares, avg_buy_price }).then((r) => r.data);

export const removeFromPortfolio = (ticker: string) =>
  client.delete(`/portfolio/items/${ticker}`);

export const getPortfolioAnalytics = () =>
  client.get("/portfolio/analytics").then((r) => r.data);
