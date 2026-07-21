import type { MemoDetail, MemoPatch, MemoRecommendation, MemoStatus, MoatUpsert } from "../api/memos";

/** The five moat dimensions with the one-line explanation each tooltip shows. */
export const MOAT_DIMENSIONS: Array<{ key: keyof MoatUpsert & string; label: string; tooltip: string }> = [
  { key: "pricing_power",    label: "Pricing power",    tooltip: "Can the company raise prices without losing customers?" },
  { key: "switching_costs",  label: "Switching costs",  tooltip: "How painful (time, money, risk) is it for a customer to move to a competitor?" },
  { key: "network_effects",  label: "Network effects",  tooltip: "Does the product get more valuable as more people use it?" },
  { key: "scale_advantages", label: "Scale advantages", tooltip: "Do size and volume give structurally lower costs than smaller rivals?" },
  { key: "brand_moat",       label: "Brand",            tooltip: "Does the brand alone command loyalty or a price premium?" },
];

export const RECOMMENDATION_META: Record<MemoRecommendation, { label: string; className: string }> = {
  buy:   { label: "Buy",   className: "bg-positive/15 text-positive" },
  hold:  { label: "Hold",  className: "bg-amber-500/15 text-amber-400" },
  pass:  { label: "Pass",  className: "bg-negative/15 text-negative" },
  watch: { label: "Watch", className: "bg-accent/15 text-accent-light" },
};

export const STATUS_META: Record<MemoStatus, { label: string; className: string }> = {
  draft:     { label: "Draft",     className: "bg-surface-hover text-muted" },
  published: { label: "Published", className: "bg-positive/15 text-positive" },
  archived:  { label: "Archived",  className: "bg-surface-hover text-muted line-through" },
};

/** Soft limit for the thesis summary (hard cap is 500 server-side). */
export const THESIS_SOFT_LIMIT = 200;

export type MemoFormState = MemoPatch;

/** Whether the moat section counts as "filled". */
export function moatFilled(moat: MoatUpsert | null): boolean {
  if (!moat) return false;
  return MOAT_DIMENSIONS.some((d) => moat[d.key] != null) || !!moat.notes?.trim();
}

const hasText = (v: string | null | undefined) => !!v?.trim();

/**
 * Builder progress: which of the 7 guided sections are filled.
 * Section 1 (ticker & basics) is always filled — a memo can't exist without
 * a ticker. Order matches the on-screen section order.
 */
export function sectionFill(memo: Pick<MemoDetail, "ticker">, form: MemoFormState, moat: MoatUpsert | null): boolean[] {
  return [
    !!memo.ticker,
    hasText(form.business_overview),
    moatFilled(moat),
    hasText(form.financial_health_notes),
    hasText(form.valuation_notes),
    hasText(form.risks),
    hasText(form.thesis_summary) && !!form.recommendation && !!form.price_target,
  ];
}

export function canPublish(form: MemoFormState): boolean {
  return hasText(form.thesis_summary) && !!form.recommendation && !!form.price_target && form.price_target > 0;
}

export const fmtPrice = (v: number | null | undefined) =>
  v != null ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";

export const fmtPct = (v: number | null | undefined, signed = true) =>
  v != null ? `${signed && v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—";

export const fmtBig = (v: number | null | undefined) => {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString("en-US")}`;
};

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function pctSince(priceAtMemo: number | null, current: number | null | undefined): number | null {
  if (priceAtMemo == null || priceAtMemo <= 0 || current == null) return null;
  return (current - priceAtMemo) / priceAtMemo * 100;
}
