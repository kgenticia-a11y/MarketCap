import { useState, useRef, useCallback } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { getFundamentals, type Fundamentals } from "../api/stocks";
import { upsertComps, type CompsAnalysis } from "../api/memos";
import { fmtBig, fmtPct } from "../utils/memo";
import { Loader2, Plus, X } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";

const MAX_PEERS = 10;

function medianOf(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

type ColDef = {
  key: keyof Fundamentals;
  label: string;
  format: (v: number | null) => string;
  deltaFmt?: (diff: number) => string;
};

const COLS: ColDef[] = [
  {
    key: "market_cap",
    label: "Mkt Cap",
    format: fmtBig,
  },
  {
    key: "pe",
    label: "P/E",
    format: (v) => (v != null ? `${v.toFixed(1)}×` : "—"),
    deltaFmt: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}×`,
  },
  {
    key: "ev_to_ebitda",
    label: "EV/EBITDA",
    format: (v) => (v != null ? `${v.toFixed(1)}×` : "—"),
    deltaFmt: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}×`,
  },
  {
    key: "revenue_growth_pct",
    label: "Rev Growth",
    format: (v) => fmtPct(v, false),
    deltaFmt: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}pp`,
  },
  {
    key: "gross_margin_pct",
    label: "Gross Margin",
    format: (v) => fmtPct(v, false),
    deltaFmt: (d) => `${d >= 0 ? "+" : ""}${d.toFixed(1)}pp`,
  },
];

interface Props {
  memoId: number;
  ticker: string;
  initialComps: CompsAnalysis | null;
}

export default function CompsTable({ memoId, ticker, initialComps }: Props) {
  const qc = useQueryClient();
  const [peers, setPeers] = useState<string[]>(() => initialComps?.peer_tickers ?? []);
  const [notes, setNotes] = useState(initialComps?.notes ?? "");
  const [input, setInput] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allTickers = [ticker, ...peers];
  const results = useQueries({
    queries: allTickers.map((t) => ({
      queryKey: ["fundamentals", t] as const,
      queryFn: () => getFundamentals(t),
      staleTime: 30 * 60_000,
    })),
  });

  const subjectData = results[0]?.data ?? null;
  const peerResults = results.slice(1);
  const peerData = peerResults.map((r) => r.data ?? null).filter((d): d is Fundamentals => d != null);

  const saveMut = useMutation({
    mutationFn: ({ p, n }: { p: string[]; n: string | null }) => upsertComps(memoId, p, n),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memo", memoId] }),
    onError: () => toast.error("Failed to save comps"),
  });

  const schedSave = useCallback(
    (p: string[], n: string | null) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => saveMut.mutate({ p, n }), 2_000);
    },
    [saveMut],
  );

  const saveNow = useCallback(
    (p: string[], n: string | null) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      saveMut.mutate({ p, n });
    },
    [saveMut],
  );

  const addPeer = () => {
    const t = input.trim().toUpperCase();
    if (!t || peers.includes(t) || t === ticker || peers.length >= MAX_PEERS) return;
    const next = [...peers, t];
    setPeers(next);
    setInput("");
    schedSave(next, notes || null);
  };

  const removePeer = (t: string) => {
    const next = peers.filter((p) => p !== t);
    setPeers(next);
    schedSave(next, notes || null);
  };

  const medians: Partial<Record<keyof Fundamentals, number | null>> = {};
  for (const col of COLS) {
    if (!col.deltaFmt) continue;
    const vals = peerData.map((d) => d[col.key] as number | null).filter((v): v is number => v != null);
    medians[col.key] = medianOf(vals);
  }

  return (
    <div className="mt-5 space-y-4">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Peer comparison</p>

      {/* Ticker input + chip list */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPeer();
            }
          }}
          placeholder={peers.length >= MAX_PEERS ? "Max peers reached" : "Add peer ticker…"}
          disabled={peers.length >= MAX_PEERS}
          className="w-44 bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-accent transition-colors placeholder:text-muted/60 disabled:opacity-50"
        />
        <button
          onClick={addPeer}
          disabled={!input.trim() || peers.length >= MAX_PEERS}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium border border-border text-muted hover:text-white hover:border-border-strong disabled:opacity-40 transition-all"
        >
          <Plus size={13} />
          Add
        </button>
        {peers.map((p) => (
          <span key={p} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-hover text-xs text-white">
            {p}
            <button onClick={() => removePeer(p)} className="text-muted hover:text-white transition-colors">
              <X size={11} />
            </button>
          </span>
        ))}
        {saveMut.isPending && <Loader2 size={13} className="animate-spin text-muted" />}
      </div>

      {/* Comparison table */}
      {(peers.length > 0 || subjectData != null) && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-raised">
                <th className="px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest">Company</th>
                {COLS.map((col) => (
                  <th key={col.key} className="px-4 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-widest text-right">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Subject */}
              <tr className="border-b border-border bg-accent/5">
                <td className="px-4 py-2.5">
                  <span className="font-semibold text-white">{ticker}</span>
                  {subjectData?.name && (
                    <span className="ml-1.5 text-[11px] text-muted">{subjectData.name}</span>
                  )}
                  {results[0]?.isLoading && <Loader2 size={11} className="inline ml-1.5 animate-spin text-muted" />}
                </td>
                {COLS.map((col) => {
                  const val = subjectData ? (subjectData[col.key] as number | null) : null;
                  const med = col.deltaFmt ? (medians[col.key] ?? null) : null;
                  const diff = val != null && med != null ? val - med : null;
                  return (
                    <td key={col.key} className="px-4 py-2.5 text-right">
                      <div className="font-semibold text-white">{col.format(val)}</div>
                      {diff != null && peers.length > 0 && col.deltaFmt && (
                        <div className={clsx("text-[10px] mt-0.5", diff >= 0 ? "text-positive" : "text-negative")}>
                          {col.deltaFmt(diff)}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Peer rows */}
              {peers.map((p, i) => {
                const res = peerResults[i];
                const data = res?.data ?? null;
                return (
                  <tr key={p} className="border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="font-medium text-white">{p}</span>
                      {data?.name && <span className="ml-1.5 text-[11px] text-muted">{data.name}</span>}
                      {res?.isLoading && <Loader2 size={11} className="inline ml-1.5 animate-spin text-muted" />}
                    </td>
                    {COLS.map((col) => (
                      <td key={col.key} className="px-4 py-2.5 text-right text-white">
                        {col.format(data ? (data[col.key] as number | null) : null)}
                      </td>
                    ))}
                  </tr>
                );
              })}

              {/* Median row */}
              {peers.length > 0 && peerData.length > 0 && (
                <tr className="border-t border-border bg-surface-raised/60">
                  <td className="px-4 py-2.5 text-[11px] font-medium text-muted italic">Peer median</td>
                  {COLS.map((col) => (
                    <td key={col.key} className="px-4 py-2.5 text-right text-[11px] font-medium text-muted">
                      {col.key === "market_cap" ? "—" : col.format(medians[col.key] ?? null)}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="block text-xs text-muted mb-1">Comps notes</label>
        <textarea
          className="w-full bg-surface-raised border border-border rounded-xl px-3.5 py-3 text-sm text-white outline-none focus:border-accent transition-colors resize-y min-h-[80px] placeholder:text-muted/60"
          placeholder="How does this company's valuation compare to peers? What explains the premium or discount?"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => saveNow(peers, notes || null)}
        />
      </div>
    </div>
  );
}
