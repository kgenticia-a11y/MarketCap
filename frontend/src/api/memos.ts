import client from "./client";

/* Mirrors backend/app/schemas.py — the memo section. */

export type MemoStatus = "draft" | "published" | "archived";
export type MemoRecommendation = "buy" | "hold" | "pass" | "watch";

export interface Memo {
  id: number;
  ticker: string;
  status: MemoStatus;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  business_overview: string | null;
  moat_notes: string | null;
  financial_health_notes: string | null;
  valuation_notes: string | null;
  risks: string | null;
  thesis_summary: string | null;
  recommendation: MemoRecommendation | null;
  price_at_memo: number | null;
  price_target: number | null;
  target_horizon_months: number | null;
}

export interface MoatScorecard {
  id: number;
  memo_id: number;
  pricing_power: number | null;
  switching_costs: number | null;
  network_effects: number | null;
  scale_advantages: number | null;
  brand_moat: number | null;
  notes: string | null;
}

export interface CompsAnalysis {
  id: number;
  memo_id: number;
  peer_tickers: string[];
  notes: string | null;
}

export interface DcfScenario {
  id: number;
  memo_id: number;
  scenario_name: string;
  revenue_growth_pct: number;
  operating_margin_pct: number;
  tax_rate_pct: number;
  discount_rate_pct: number;
  terminal_growth_pct: number;
  projection_years: number;
  fair_value_per_share: number | null;
  created_at: string;
}

export interface ThesisCheckpoint {
  id: number;
  memo_id: number;
  checked_at: string;
  price_at_check: number;
  pct_change_since_memo: number;
  days_since_memo: number;
  notes: string | null;
}

export interface MemoDetail extends Memo {
  moat: MoatScorecard | null;
  comps: CompsAnalysis | null;
  scenarios: DcfScenario[];
}

export type MemoPatch = Partial<Pick<Memo,
  | "business_overview"
  | "moat_notes"
  | "financial_health_notes"
  | "valuation_notes"
  | "risks"
  | "thesis_summary"
  | "recommendation"
  | "price_target"
  | "target_horizon_months"
>>;

export type MoatUpsert = Omit<MoatScorecard, "id" | "memo_id">;

export interface DcfScenarioInput {
  scenario_name: string;
  revenue_growth_pct: number;
  operating_margin_pct: number;
  tax_rate_pct: number;
  discount_rate_pct: number;
  terminal_growth_pct: number;
  projection_years: number;
  fair_value_per_share: number | null;
}

export interface MemoPerformanceRow {
  memo_id: number;
  ticker: string;
  recommendation: MemoRecommendation | null;
  published_at: string;
  price_at_memo: number;
  price_target: number | null;
  current_price: number | null;
  pct_change: number | null;
  days_since_memo: number;
  checkpoints_count: number;
  last_checkpoint_at: string | null;
  days_since_last_reflection: number | null;
  price_series: number[];
}

export const listMemos = (params?: { status?: MemoStatus; ticker?: string }) =>
  client.get("/memos", { params }).then((r) => r.data as Memo[]);

export const getMemoPerformance = () =>
  client.get("/memos/performance").then((r) => r.data as MemoPerformanceRow[]);

export const createMemo = (ticker: string) =>
  client.post("/memos", { ticker }).then((r) => r.data as Memo);

export const getMemo = (id: number) =>
  client.get(`/memos/${id}`).then((r) => r.data as MemoDetail);

export const updateMemo = (id: number, patch: MemoPatch) =>
  client.patch(`/memos/${id}`, patch).then((r) => r.data as Memo);

export const publishMemo = (id: number) =>
  client.post(`/memos/${id}/publish`).then((r) => r.data as Memo);

export const archiveMemo = (id: number) =>
  client.delete(`/memos/${id}`).then((r) => r.data);

export const upsertMoat = (memoId: number, body: MoatUpsert) =>
  client.put(`/memos/${memoId}/moat`, body).then((r) => r.data as MoatScorecard);

export const upsertComps = (memoId: number, peer_tickers: string[], notes: string | null) =>
  client.put(`/memos/${memoId}/comps`, { peer_tickers, notes }).then((r) => r.data as CompsAnalysis);

export const addDcfScenario = (memoId: number, body: DcfScenarioInput) =>
  client.post(`/memos/${memoId}/dcf`, body).then((r) => r.data as DcfScenario);

export const updateDcfScenario = (scenarioId: number, body: Partial<DcfScenarioInput>) =>
  client.patch(`/dcf/${scenarioId}`, body).then((r) => r.data as DcfScenario);

export const deleteDcfScenario = (scenarioId: number) =>
  client.delete(`/dcf/${scenarioId}`).then((r) => r.data);

export const createCheckpoint = (memoId: number, notes?: string) =>
  client.post(`/memos/${memoId}/checkpoints`, { notes: notes ?? null }).then((r) => r.data as ThesisCheckpoint);

export const listCheckpoints = (memoId: number) =>
  client.get(`/memos/${memoId}/checkpoints`).then((r) => r.data as ThesisCheckpoint[]);
