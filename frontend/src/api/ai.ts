import client from "./client";

// AI endpoints run a full LLM generation server-side (plus retries on
// provider rate limits), so they legitimately take longer than the client's
// default 30s ceiling. Each call sets its own timeout: without this, the
// browser aborted deep analyst reports (3 sequential generations + market
// data gathering) while the backend was still happily working.
const AI_TIMEOUT_MS = 60_000;
const REPORT_TIMEOUT_MS = 180_000;

export const getDailyBrief = () =>
  client.get("/ai/daily-brief", { timeout: AI_TIMEOUT_MS }).then((r) => r.data);

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
}) => client.post("/ai/chart-analysis", payload, { timeout: AI_TIMEOUT_MS }).then((r) => r.data);

export const getEarningsBrief = (payload: {
  ticker: string;
  name: string;
  earnings_date: string;
  time: string;
  eps_estimate: number;
  eps_actual_prev: number;
  beat_history: string;
}) => client.post("/ai/earnings-brief", payload, { timeout: AI_TIMEOUT_MS }).then((r) => r.data);

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const sendChatMessage = (payload: {
  message: string;
  history: ChatMessage[];
  current_page: string;
}) => client.post("/ai/chat", payload, { timeout: AI_TIMEOUT_MS }).then((r) => r.data);

export const getAnalystReport = (payload: {
  ticker: string;
  timespan: string;
  depth: string;
}) => client.post("/ai/analyst-report", payload, { timeout: REPORT_TIMEOUT_MS }).then((r) => r.data);
