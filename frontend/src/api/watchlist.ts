import client from "./client";

export const getWatchlist = () => client.get("/watchlist").then((r) => r.data);

export const addToWatchlist = (ticker: string) =>
  client.post(`/watchlist/${ticker}`).then((r) => r.data);

export const removeFromWatchlist = (ticker: string) =>
  client.delete(`/watchlist/${ticker}`);
