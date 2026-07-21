import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCheckpoint, listCheckpoints, type ThesisCheckpoint } from "../api/memos";
import { fmtPct, fmtPrice } from "../utils/memo";
import { Clipboard, Loader2, Plus } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";

function Sparkline({ points, width = 220, height = 46 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  const stroke = last >= first ? "#22c55e" : "#ef4444";
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={path} stroke={stroke} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function CheckpointPanel({
  memoId,
  published,
}: {
  memoId: number;
  published: boolean;
}) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const { data: checkpoints, isLoading } = useQuery({
    queryKey: ["checkpoints", memoId],
    queryFn: () => listCheckpoints(memoId),
    enabled: published,
  });

  const addMut = useMutation({
    mutationFn: (n: string) => createCheckpoint(memoId, n.trim() || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["checkpoints", memoId] });
      setNotes("");
      setShowAdd(false);
      toast.success("Reflection saved");
    },
    onError: () => toast.error("Failed to save reflection"),
  });

  if (!published) return null;

  const list = checkpoints ?? [];
  const priceSeries = list.map((c: ThesisCheckpoint) => c.price_at_check);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-muted uppercase tracking-widest">
          Thesis reflections
        </h2>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border text-muted hover:text-white hover:border-border-strong transition-all"
        >
          <Plus size={12} />
          {showAdd ? "Cancel" : "Add reflection"}
        </button>
      </div>

      {showAdd && (
        <div className="bg-surface rounded-xl border border-border p-4 mb-4">
          <label className="block text-xs text-muted mb-1.5">
            What has changed since your last read?
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Earnings hit, guidance cut, new competitor, thesis still intact…"
            className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent transition-colors resize-y min-h-[70px] placeholder:text-muted/60"
          />
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px] text-muted">
              The current price is snapshotted automatically for tracking.
            </p>
            <button
              onClick={() => addMut.mutate(notes)}
              disabled={addMut.isPending}
              className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent hover:bg-accent/90 text-white disabled:opacity-50 transition-all"
            >
              {addMut.isPending ? "Saving…" : "Save reflection"}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="h-16 bg-surface rounded-xl animate-pulse" />
      ) : list.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-5 text-center">
          <Clipboard size={22} className="text-muted mx-auto mb-2" />
          <p className="text-sm text-white/90">No reflections yet.</p>
          <p className="text-xs text-muted mt-1">
            Auto-checkpoints run weekly; you can add your own read at any time.
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          {priceSeries.length >= 2 && (
            <div className="p-4 border-b border-border flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">
                  Price trail
                </p>
                <p className="text-xs text-muted">{list.length} checkpoints on file</p>
              </div>
              <Sparkline points={priceSeries} />
            </div>
          )}
          <ul>
            {[...list].reverse().map((c) => (
              <li key={c.id} className="px-4 py-3 border-b border-border/50 last:border-0">
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs text-muted">
                      Day {c.days_since_memo} · {new Date(c.checked_at).toLocaleDateString()}
                    </p>
                    <p className="text-sm text-white mt-0.5">{fmtPrice(c.price_at_check)}</p>
                  </div>
                  <span
                    className={clsx(
                      "text-sm font-semibold",
                      c.pct_change_since_memo >= 0 ? "text-positive" : "text-negative",
                    )}
                  >
                    {fmtPct(c.pct_change_since_memo)}
                  </span>
                </div>
                {c.notes && c.notes !== "[auto]" && (
                  <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap mt-2">
                    {c.notes}
                  </p>
                )}
                {c.notes === "[auto]" && (
                  <p className="text-[11px] text-muted italic mt-1">Auto-checkpoint</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {addMut.isPending && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" />
          Fetching current price…
        </div>
      )}
    </section>
  );
}
