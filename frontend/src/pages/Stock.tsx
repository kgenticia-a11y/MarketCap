import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQuote, getDetails } from "../api/stocks";
import { addToPortfolio } from "../api/portfolio";
import { addToWatchlist, removeFromWatchlist, getWatchlist } from "../api/watchlist";
import StockChart from "../components/StockChart";
import ErrorBoundary from "../components/ErrorBoundary";
import { Star, Plus, Building2, TrendingUp, TrendingDown } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { clsx } from "clsx";
import { toast } from "sonner";

export default function Stock() {
  const { ticker = "" } = useParams<{ ticker: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const upper = ticker.toUpperCase();

  const { data: quote, isLoading: qLoading } = useQuery({
    queryKey: ["quote", upper],
    queryFn: () => getQuote(upper),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: details } = useQuery({
    queryKey: ["details", upper],
    queryFn: () => getDetails(upper),
    staleTime: 300_000,
  });

  const { data: watchlistData } = useQuery({
    queryKey: ["watchlist"],
    queryFn: getWatchlist,
    enabled: !!user,
  });

  const isWatched = watchlistData?.some((w: { ticker: string }) => w.ticker === upper) ?? false;

  const watchMutation = useMutation({
    mutationFn: async () => { await (isWatched ? removeFromWatchlist(upper) : addToWatchlist(upper)); },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["watchlist"] });
      const prev = qc.getQueryData<{ ticker: string }[]>(["watchlist"]) ?? [];
      const next = isWatched
        ? prev.filter(w => w.ticker !== upper)
        : [...prev, { ticker: upper, id: -1 }];
      qc.setQueryData(["watchlist"], next);
      return { prev };
    },
    onSuccess: () => toast.success(isWatched ? `Removed ${upper} from watchlist` : `Added ${upper} to watchlist`),
    onError:   (_e, _v, ctx) => {
      if (ctx) qc.setQueryData(["watchlist"], ctx.prev);
      toast.error("Failed to update watchlist");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const [showPortModal,  setShowPortModal]  = useState(false);
  const [shares,         setShares]         = useState("1");
  const [buyPrice,       setBuyPrice]       = useState("");

  const portMutation = useMutation({
    mutationFn: () => {
      const s = parseFloat(shares);
      const p = parseFloat(buyPrice);
      if (!isFinite(s) || s <= 0) { toast.error("Enter a valid number of shares."); throw new Error("invalid"); }
      if (!isFinite(p) || p <= 0) { toast.error("Enter a valid buy price."); throw new Error("invalid"); }
      return addToPortfolio(upper, s, p);
    },
    onSuccess: () => {
      setShowPortModal(false);
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      toast.success(`${upper} added to portfolio`);
    },
    onError: (e: unknown) => { if ((e as Error)?.message !== "invalid") toast.error("Failed to add to portfolio"); },
  });

  const price: number | null = qLoading ? null : (quote?.price ?? null);
  const changePct: number = quote?.change_pct ?? 0;
  const positive = changePct >= 0;
  const priceDisplay = price !== null ? `$${price.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—";

  const info = details?.results ?? {};

  const stats = [
    { label: "Price",      value: priceDisplay },
    { label: "Open",       value: quote?.open != null ? `$${(quote.open as number).toFixed(2)}` : "—" },
    { label: "High",       value: quote?.high != null ? `$${(quote.high as number).toFixed(2)}` : "—" },
    { label: "Low",        value: quote?.low  != null ? `$${(quote.low  as number).toFixed(2)}` : "—" },
    { label: "Volume",     value: quote?.volume != null ? `${((quote.volume as number) / 1e6).toFixed(2)}M` : "—" },
    { label: "Market Cap", value: info.market_cap != null ? `$${(info.market_cap / 1e9).toFixed(1)}B` : "—" },
    { label: "P/E Ratio",  value: info.pe_ratio != null ? (info.pe_ratio as number).toFixed(2) : "—" },
    { label: "52W High",   value: info.week_52_high != null ? `$${(info.week_52_high as number).toFixed(2)}` : "—" },
    { label: "52W Low",    value: info.week_52_low  != null ? `$${(info.week_52_low  as number).toFixed(2)}` : "—" },
    { label: "Sector",     value: (info.sector as string) || "—" },
    { label: "Industry",   value: (info.industry as string) || "—" },
    { label: "Employees",  value: info.total_employees?.toLocaleString() ?? "—" },
  ];

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 sm:mb-6 flex-wrap gap-3">
        <div>
          <div className="flex items-baseline gap-3 mb-1">
            <h1 className="text-2xl font-bold text-white">{upper}</h1>
            {info.name && <span className="text-muted text-sm">{info.name}</span>}
          </div>
          {qLoading ? (
            <div className="h-8 w-48 bg-surface rounded-lg animate-pulse" />
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">{priceDisplay}</span>
              <span className={clsx("flex items-center gap-1 text-base font-medium", positive ? "text-positive" : "text-negative")}>
                {positive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                {positive ? "+" : ""}{changePct.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {user && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => watchMutation.mutate()}
              disabled={watchMutation.isPending}
              className={clsx(
                "flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium border transition-all",
                isWatched
                  ? "border-accent/50 bg-accent/10 text-accent-light"
                  : "border-border text-muted hover:text-white hover:border-border-strong"
              )}
            >
              <Star size={15} fill={isWatched ? "currentColor" : "none"} />
              {isWatched ? "Watching" : "Watch"}
            </button>
            <button
              onClick={() => { setBuyPrice(price != null ? price.toFixed(2) : ""); setShowPortModal(true); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 text-white transition-all shadow-lg shadow-accent/20"
            >
              <Plus size={15} />
              Add to Portfolio
            </button>
          </div>
        )}
      </div>

      {/* Chart */}
      <ErrorBoundary label="Chart failed to load">
        <div className="bg-surface rounded-xl border border-border p-5 mb-6">
          <StockChart ticker={upper} />
        </div>
      </ErrorBoundary>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="space-y-4">
          <div className="bg-surface rounded-xl border border-border p-5">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">Key Stats</h3>
            <div className="grid grid-cols-2 gap-3">
              {stats.map((s) => (
                <div key={s.label}>
                  <div className="text-[10px] text-muted mb-0.5">{s.label}</div>
                  <div className="text-sm font-semibold text-white">{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {info.description && (
            <div className="bg-surface rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted uppercase tracking-widest mb-2">
                <Building2 size={12} />
                About
              </div>
              <p className="text-xs text-muted leading-relaxed line-clamp-8">{info.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Portfolio modal */}
      {showPortModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowPortModal(false)}>
          <div className="bg-surface-raised border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-white mb-4">Add {upper} to Portfolio</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs text-muted mb-1 block">Shares</label>
                <input type="number" min="0.001" step="any" value={shares} onChange={(e) => setShares(e.target.value)}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors" />
              </div>
              <div>
                <label className="text-xs text-muted mb-1 block">Avg Buy Price ($)</label>
                <input type="number" min="0" step="any" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)}
                  className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowPortModal(false)} className="flex-1 py-2.5 rounded-xl text-sm text-muted border border-border hover:border-border-strong transition-colors">Cancel</button>
              <button onClick={() => portMutation.mutate()} disabled={portMutation.isPending || !shares || !buyPrice}
                className="flex-1 py-2.5 rounded-xl text-sm bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-medium transition-all">
                {portMutation.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
