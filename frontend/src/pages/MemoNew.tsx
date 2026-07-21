import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { searchStocks } from "../api/stocks";
import { createMemo } from "../api/memos";
import { ArrowLeft, Search } from "lucide-react";
import { toast } from "sonner";

interface SearchResult { ticker: string; name: string }

export default function MemoNew() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");

  const [debouncedQ, setDebouncedQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debouncedQ],
    queryFn: () => searchStocks(debouncedQ),
    enabled: debouncedQ.length >= 1,
    staleTime: 30_000,
  });
  const results: SearchResult[] = data?.results?.slice(0, 8) ?? [];

  const createMutation = useMutation({
    mutationFn: (ticker: string) => createMemo(ticker),
    onSuccess: (memo) => navigate(`/memos/${memo.id}/edit`),
    onError: () => toast.error("Failed to create memo"),
  });

  return (
    <div className="p-6 max-w-xl">
      <Link to="/memos" className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-white transition-colors mb-5">
        <ArrowLeft size={13} />
        Back to memos
      </Link>

      <h1 className="text-lg font-semibold text-white mb-1">Which company are you evaluating?</h1>
      <p className="text-sm text-muted mb-5">
        Pick the stock this memo is about. The ticker is locked once the memo is created, so the
        analysis always refers to one company.
      </p>

      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by ticker or company name…"
          className="w-full bg-surface border border-border rounded-xl pl-10 pr-4 py-3 text-sm text-white outline-none focus:border-accent transition-colors"
        />
      </div>

      {q.trim().length >= 1 && (
        <div className="mt-3 bg-surface rounded-xl border border-border overflow-hidden">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted">
              {isFetching ? "Searching…" : "No matches found."}
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.ticker}
                disabled={createMutation.isPending}
                onClick={() => createMutation.mutate(r.ticker)}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors text-left disabled:opacity-50"
              >
                <span className="text-sm font-semibold text-white w-16 shrink-0">{r.ticker}</span>
                <span className="text-xs text-muted truncate flex-1">{r.name}</span>
                <span className="text-xs text-accent-light shrink-0">
                  {createMutation.isPending ? "Creating…" : "Start memo →"}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
