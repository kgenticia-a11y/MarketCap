import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { TrendingUp, TrendingDown, Layers } from "lucide-react";
import client from "../api/client";

interface Fund {
  ticker:        string;
  name:          string;
  price:         number;
  change_pct:    number;
  expense_ratio: number;
  aum_b:         number;
  ytd_return:    number;
  category:      string;
}

const CATEGORIES = ["Broad Market", "Bonds", "International", "Commodities", "Real Assets"];

const getFunds = (cat: string) =>
  client.get(`/stocks/funds/${encodeURIComponent(cat)}`).then((r) => r.data as Fund[]);

function FundRow({ f }: { f: Fund }) {
  const up = f.change_pct >= 0;
  return (
    <Link
      to={`/stock/${f.ticker}`}
      className="grid grid-cols-[2.5rem_1fr_6rem_6rem_6rem_6rem] items-center gap-3 px-5 py-3 border-b border-border/40 last:border-0 hover:bg-surface-hover transition-colors"
    >
      {/* Ticker badge */}
      <div className="text-[10px] font-bold text-accent-light bg-accent/10 rounded-lg px-1.5 py-1 text-center leading-none">
        {f.ticker}
      </div>

      {/* Name */}
      <div className="min-w-0">
        <div className="text-sm font-medium text-white truncate">{f.name}</div>
        {f.category && <div className="text-[10px] text-muted truncate">{f.category}</div>}
      </div>

      {/* Price */}
      <div className="text-sm text-white text-right">
        ${f.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
      </div>

      {/* Day change */}
      <div className={clsx("text-sm font-medium text-right flex items-center justify-end gap-1", up ? "text-positive" : "text-negative")}>
        {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {up ? "+" : ""}{f.change_pct.toFixed(2)}%
      </div>

      {/* Expense ratio */}
      <div className="text-sm text-muted text-right">
        {f.expense_ratio > 0 ? `${f.expense_ratio.toFixed(2)}%` : "—"}
      </div>

      {/* AUM */}
      <div className="text-sm text-muted text-right">
        {f.aum_b > 0 ? `$${f.aum_b.toFixed(1)}B` : "—"}
      </div>
    </Link>
  );
}

function ColumnHeader() {
  return (
    <div className="grid grid-cols-[2.5rem_1fr_6rem_6rem_6rem_6rem] items-center gap-3 px-5 py-2 border-b border-border bg-surface-hover/30">
      <div />
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider">Fund</div>
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider text-right">Price</div>
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider text-right">Day</div>
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider text-right">Exp. Ratio</div>
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider text-right">AUM</div>
    </div>
  );
}

export default function MutualFunds() {
  const [activeTab, setActiveTab] = useState(CATEGORIES[0]);

  const { data: funds, isLoading } = useQuery<Fund[]>({
    queryKey: ["funds", activeTab],
    queryFn:  () => getFunds(activeTab),
    staleTime: 120_000,
  });

  return (
    <div className="p-6">

      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-5 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveTab(cat)}
            className={clsx(
              "flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-colors",
              activeTab === cat
                ? "bg-accent text-white shadow-lg shadow-accent/20"
                : "bg-surface border border-border text-muted hover:text-white hover:border-border-strong"
            )}
          >
            <Layers size={11} />
            {cat}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <ColumnHeader />

        {isLoading ? (
          <div className="space-y-0">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 mx-4 my-1 bg-surface-hover rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !funds || funds.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted">
            No data available.
          </div>
        ) : (
          funds.map((f) => <FundRow key={f.ticker} f={f} />)
        )}
      </div>

      <p className="text-[10px] text-muted mt-3">
        Prices delayed. Expense ratios and AUM from Yahoo Finance. Not financial advice.
      </p>
    </div>
  );
}
