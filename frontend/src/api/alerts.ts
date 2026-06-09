import client from "./client";

export interface Alert {
  id:           number;
  ticker:       string;
  target_price: number;
  condition:    "above" | "below";
  created_at:   string;
}

export const getAlerts   = ()                                             =>
  client.get("/alerts").then((r) => r.data as Alert[]);

export const createAlert = (ticker: string, target_price: number, condition: "above" | "below") =>
  client.post("/alerts", { ticker, target_price, condition }).then((r) => r.data as Alert);

export const deleteAlert = (id: number) =>
  client.delete(`/alerts/${id}`);
