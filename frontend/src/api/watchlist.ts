import client from "./client";

export interface WatchlistItem {
  id: number;
  ticker: string;
  added_at: string;
  notes: string | null;
  notes_updated_at: string | null;
}

export const getWatchlist = () =>
  client.get("/watchlist").then((r) => r.data as WatchlistItem[]);

export const addToWatchlist = (ticker: string) =>
  client.post(`/watchlist/${ticker}`).then((r) => r.data as WatchlistItem);

export const removeFromWatchlist = (ticker: string) =>
  client.delete(`/watchlist/${ticker}`);

export const updateWatchlistNotes = (ticker: string, notes: string | null) =>
  client
    .patch(`/watchlist/${ticker}/notes`, { notes })
    .then((r) => r.data as WatchlistItem);
