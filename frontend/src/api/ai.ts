import client from "./client";

export const getDailyBrief = () => client.get("/ai/daily-brief").then((r) => r.data);

export interface ChartBar {
  c: number;
  h?: number;
  l?: number;
  v?: number;
}

export const analyzeChart = (payload: {
  ticker: string;
  range: string;
  price: number;
  change_pct: number;
  bars: ChartBar[];
}) => client.post("/ai/chart-analysis", payload).then((r) => r.data);

export const getEarningsBrief = (payload: {
  ticker: string;
  name: string;
  earnings_date: string;
  time: string;
  eps_estimate: number;
  eps_actual_prev: number;
  beat_history: string;
}) => client.post("/ai/earnings-brief", payload).then((r) => r.data);

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const sendChatMessage = (payload: {
  message: string;
  history: ChatMessage[];
  current_page: string;
}) => client.post("/ai/chat", payload).then((r) => r.data);
