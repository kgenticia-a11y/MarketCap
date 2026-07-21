import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { listMemos, type Memo, type MemoStatus } from "../api/memos";
import { useBatchedQuotes } from "../hooks/useBatchedQuotes";
import { RecommendationBadge, StatusBadge } from "../components/MemoBadges";
import { fmtPrice, fmtPct, pctSince } from "../utils/memo";
import { NotebookPen, Plus } from "lucide-react";
import { clsx } from "clsx";

const FILTERS: Array<{ label: string; value: MemoStatus | "all" }> = [
  { label: "All",       value: "all" },
  { label: "Drafts",    value: "draft" },
  { label: "Published", value: "published" },
  { label: "Archived",  value: "archived" },
];

function MemoRow({ memo, currentPrice }: { memo: Memo; currentPrice: number | null }) {
  const navigate = useNavigate();
  const changePct = pctSince(memo.price_at_memo, currentPrice);
  const target = memo.status === "published" ? `/memos/${memo.id}` : `/memos/${memo.id}/edit`;

  return (
    <tr
      onClick={() => navigate(target)}
      className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors"
    >
      <td className="px-4 py-3">
        <span className="text-sm font-semibold text-white">{memo.ticker}</span>
      </td>
      <td className="px-4 py-3 max-w-[280px]">
        <span className="text-xs text-muted line-clamp-2">
          {memo.thesis_summary?.trim() || <span className="italic">No thesis yet</span>}
        </span>
      </td>
      <td className="px-4 py-3"><RecommendationBadge value={memo.recommendation} /></td>
      <td className="px-4 py-3 text-right text-sm text-muted hidden sm:table-cell">{fmtPrice(memo.price_at_memo)}</td>
      <td className="px-4 py-3 text-right text-sm text-white hidden sm:table-cell">{fmtPrice(currentPrice)}</td>
      <td className="px-4 py-3 text-right">
        {changePct != null ? (
          <span className={clsx("text-sm font-medium", changePct >= 0 ? "text-positive" : "text-negative")}>
            {fmtPct(changePct)}
          </span>
        ) : (
          <span className="text-sm text-muted">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right"><StatusBadge value={memo.status} /></td>
    </tr>
  );
}

export default function Memos() {
  const [filter, setFilter] = useState<MemoStatus | "all">("all");

  const { data, isLoading } = useQuery({
    queryKey: ["memos", filter],
    queryFn: () => listMemos(filter === "all" ? undefined : { status: filter }),
  });

  const memos: Memo[] = data ?? [];
  // One batched request covers every row; memo views are non-critical, so
  // the 15-minute cadence applies (see INFRASTRUCTURE.md).
  const { data: quotes } = useBatchedQuotes(memos.map((m) => m.ticker), 15 * 60_000);
  const priceOf = (t: string): number | null =>
    (quotes?.[t] as { price?: number } | undefined)?.price ?? null;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <div className="flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                filter === f.value
                  ? "bg-accent/15 text-accent-light"
                  : "text-muted hover:text-white hover:bg-surface-hover"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Link
          to="/memos/new"
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all shadow-lg shadow-accent/20"
        >
          <Plus size={15} />
          New memo
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
      ) : memos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <NotebookPen size={40} className="text-muted mb-4" />
          <h2 className="text-base font-semibold text-white mb-2">Write your first investment memo</h2>
          <p className="text-sm text-muted max-w-md mb-6">
            A memo walks you through evaluating a stock the way a corp-dev team evaluates an
            acquisition — business, moat, financials, valuation, risks — and then tracks how your
            thesis actually plays out.
          </p>
          <Link
            to="/memos/new"
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all shadow-lg shadow-accent/20"
          >
            <Plus size={15} />
            Start a memo
          </Link>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest">Ticker</th>
                <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest">Thesis</th>
                <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest">Rec</th>
                <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right hidden sm:table-cell">At memo</th>
                <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right hidden sm:table-cell">Current</th>
                <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right">Since memo</th>
                <th className="px-4 py-3 text-[10px] font-semibold text-muted uppercase tracking-widest text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {memos.map((m) => (
                <MemoRow key={m.id} memo={m} currentPrice={priceOf(m.ticker)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
