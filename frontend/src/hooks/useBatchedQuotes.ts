import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getQuotes } from "../api/stocks";

/**
 * Fetch quotes for many tickers in ONE request and seed the per-ticker
 * ["quote", ticker] cache entries. Existing row/tab components keep their
 * individual useQuery(["quote", t]) as cache readers — with the entries
 * seeded fresh every cycle they never fire their own network calls. This
 * replaced the per-row pattern that hit /stocks/quote/{t} once per holding
 * (40+ requests/min from a single portfolio page — the main "slow UI"
 * culprit).
 */
export function useBatchedQuotes(tickers: string[], refetchMs = 60_000) {
  const qc = useQueryClient();
  const key = [...new Set(tickers)].sort();
  return useQuery({
    queryKey: ["quotes-batch", key.join(",")],
    enabled: key.length > 0,
    queryFn: async () => {
      const data = await getQuotes(key);
      const results: Record<string, unknown> = data?.results ?? {};
      for (const [t, quote] of Object.entries(results)) {
        qc.setQueryData(["quote", t], quote);
      }
      return results;
    },
    staleTime: refetchMs - 5_000,
    refetchInterval: refetchMs,
  });
}
