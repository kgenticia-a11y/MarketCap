import client from "./client";

export const getNews = (ticker?: string, limit = 10) =>
  client.get("/news", { params: { ticker, limit } }).then((r) => r.data);
