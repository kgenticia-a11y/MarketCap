import client from "./client";

// AI endpoints run a full LLM generation server-side (plus retries on
// provider rate limits), so they legitimately take longer than the client's
// default 30s ceiling. Each call sets its own timeout: without this, the
// browser aborted deep analyst reports while the backend was still happily
// working. Analyst-report timeouts scale with depth — standard runs 3
// sequential deep-model generations, and a deep dive runs 9 (one per major
// section, ~35-45 pages total), so those get progressively longer ceilings.
const AI_TIMEOUT_MS = 60_000;
const REPORT_TIMEOUT_MS: Record<string, number> = {
  brief: 120_000,
  standard: 480_000,
  deep: 900_000,
};

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
}) =>
  client
    .post("/ai/analyst-report", payload, {
      timeout: REPORT_TIMEOUT_MS[payload.depth] ?? REPORT_TIMEOUT_MS.standard,
    })
    .then((r) => r.data);
