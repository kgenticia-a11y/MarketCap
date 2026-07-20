import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { getWatchlist, removeFromWatchlist } from "../api/watchlist";
import { getQuote, getChart } from "../api/stocks";
import { addToPortfolio } from "../api/portfolio";
import { useAuth } from "../context/AuthContext";
import { Trash2, Star, Plus, X } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";

interface WatchItem { id: number; ticker: string }

/* ── Tiny 5-day sparkline ─────────────────────────────────────────────── */
function Sparkline({ ticker }: { ticker: string }) {
  const { data } = useQuery({
    queryKey: ["chart", ticker, "5D"],
    queryFn:  () => getChart(ticker, "5D"),
    staleTime: 300_000,
  });

  const bars: Array<{ c: number }> = data?.results ?? [];
  if (bars.length < 2) return <div className="w-16 h-8" />;

  const chartData = bars.map((b, i) => ({ i, v: b.c }));
  const isUp  = chartData.at(-1)!.v >= chartData[0].v;
  const color = isUp ? "#1ed688" : "#ff5c5c";

  return (
    <ResponsiveContainer width={64} height={32}>
      <AreaChart data={chartData} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
        <defs>
          <linearGradient id={`wl-${ticker}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
            <stop offset="95%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#wl-${ticker})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ── Add-to-Portfolio mini-modal ─────────────────────────────────────── */
interface PortModalProps {
  ticker: string;
  currentPrice: number;
  onClose: () => void;
}

function PortModal({ ticker, currentPrice, onClose }: PortModalProps) {
  const qc = useQueryClient();
  const [shares,   setShares]   = useState("1");
  const [buyPrice, setBuyPrice] = useState(currentPrice.toFixed(2));

  const mut = useMutation({
    mutationFn: () => addToPortfolio(ticker, parseFloat(shares), parseFloat(buyPrice)),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      toast.success(`${ticker} added to portfolio`);
      onClose();
    },
    onError: () => toast.error("Failed to add to portfolio"),
  });

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-raised border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white">Add {ticker} to Portfolio</h3>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 mb-5">
          <div>
            <label className="text-xs text-muted mb-1 block">Shares</label>
            <input
              type="number" min="0.001" step="any" value={shares}
              onChange={(e) => setShares(e.target.value)}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors"
            />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Avg Buy Price ($)</label>
            <input
              type="number" min="0" step="any" value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-accent transition-colors"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-muted border border-border hover:border-border-strong transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !shares || !buyPrice}
            className="flex-1 py-2.5 rounded-xl text-sm bg-accent hover:bg-accent/90 disabled:opacity-50 text-white font-medium transition-all"
          >
            {mut.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Single watchlist row ────────────────────────────────────────────── */
interface WatchRowProps {
  item: WatchItem;
  onAddToPortfolio: (ticker: string, price: number) => void;
}

function WatchRow({ item, onAddToPortfolio }: WatchRowProps) {
  const qc = useQueryClient();

  const { data: quote } = useQuery({
    queryKey: ["quote", item.ticker],
    queryFn:  () => getQuote(item.ticker),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const rawPrice  = quote?.price as number | undefined;
  const price     = rawPrice ?? 0;
  const changePct: number = quote?.change_pct ?? 0;
  const positive  = changePct >= 0;
  const priceLoaded = rawPrice != null;

  const delMutation = useMutation({
    mutationFn: () => removeFromWatchlist(item.ticker),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["watchlist"] });
      const prev = qc.getQueryData<{ ticker: string; id: number }[]>(["watchlist"]) ?? [];
      qc.setQueryData(["watchlist"], prev.filter(w => w.ticker !== item.ticker));
      return { prev };
    },
    onSuccess:  () => toast.success(`${item.ticker} removed from watchlist`),
    onError:    (_e, _v, ctx) => {
      if (ctx) qc.setQueryData(["watchlist"], ctx.prev);
      toast.error("Failed to remove from watchlist");
    },
    onSettled:  () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors">
      {/* Ticker */}
      <Link
        to={`/stock/${item.ticker}`}
        className="text-sm font-semibold text-white hover:text-accent-light transition-colors w-14 shrink-0"
      >
        {item.ticker}
      </Link>

      {/* Sparkline */}
      <div className="shrink-0">
        <Sparkline ticker={item.ticker} />
      </div>

      {/* Price + change */}
      <div className="flex-1 text-right">
        {priceLoaded ? (
          <>
            <div className="text-sm font-medium text-white">${price.toFixed(2)}</div>
            <div className={clsx("text-xs font-medium", positive ? "text-positive" : "text-negative")}>
              {positive ? "+" : ""}{changePct.toFixed(2)}%
            </div>
          </>
        ) : (
          <div className="text-sm text-muted">—</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          title="Add to portfolio"
          onClick={() => onAddToPortfolio(item.ticker, price)}
          className="p-1.5 rounded-lg text-muted hover:text-accent hover:bg-accent/10 transition-colors"
        >
          <Plus size={13} />
        </button>
        <button
          title="Remove from watchlist"
          onClick={() => delMutation.mutate()}
          className="p-1.5 rounded-lg text-muted hover:text-negative hover:bg-negative/10 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */
export default function Watchlist() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["watchlist"],
    queryFn:  getWatchlist,
    enabled:  !!user,
  });

  // portfolio modal state
  const [modalTicker, setModalTicker] = useState<string | null>(null);
  const [modalPrice,  setModalPrice]  = useState(0);

  const openModal = (ticker: string, price: number) => {
    setModalTicker(ticker);
    setModalPrice(price);
  };

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Star size={40} className="text-muted mb-3" />
        <p className="text-sm text-muted">
          <Link to="/login" className="text-accent-light hover:text-accent">Sign in</Link>{" "}
          to view your watchlist.
        </p>
      </div>
    );
  }

  const items: WatchItem[] = data ?? [];

  return (
    <div className="p-6">
      {isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 bg-surface rounded-xl animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <Star size={40} className="text-muted mb-3" />
          <p className="text-sm text-muted">
            Watchlist is empty — click "Watch" on any stock page.
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden max-w-lg">
          {items.map((item) => (
            <WatchRow key={item.id} item={item} onAddToPortfolio={openModal} />
          ))}
        </div>
      )}

      {modalTicker && (
        <PortModal
          ticker={modalTicker}
          currentPrice={modalPrice}
          onClose={() => setModalTicker(null)}
        />
      )}
    </div>
  );
}
