import { clsx } from "clsx";
import type { MemoRecommendation, MemoStatus } from "../api/memos";
import { RECOMMENDATION_META, STATUS_META } from "../utils/memo";

export function RecommendationBadge({ value, className }: { value: MemoRecommendation | null; className?: string }) {
  if (!value) return <span className="text-xs text-muted">—</span>;
  const meta = RECOMMENDATION_META[value];
  return (
    <span className={clsx("inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide", meta.className, className)}>
      {meta.label}
    </span>
  );
}

export function StatusBadge({ value, className }: { value: MemoStatus; className?: string }) {
  const meta = STATUS_META[value];
  return (
    <span className={clsx("inline-block text-[11px] font-medium px-2 py-0.5 rounded-full", meta.className, className)}>
      {meta.label}
    </span>
  );
}
