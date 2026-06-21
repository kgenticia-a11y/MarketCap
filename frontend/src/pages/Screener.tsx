import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, SlidersHorizontal, X, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { API_URL } from "../env";

interface ScreenerRow {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  price: number;
  change_pct: number;
  week_52_return: number | null;
  week_52_high: number | null;
  week_52_low: number | null;
  market_cap: number;
  pe_ratio: number | null;
  dividend_yield: number;
}

const SECTORS = [
  "All Sectors",
  "Technology",
  "Financial Services",
  "Healthcare",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Communication Services",
  "Energy",
  "Industrials",
  "Basic Materials",
  "Real Estate",
  "Utilities",
  "Other",
];

// yfinance sometimes returns sector names that differ from our canonical labels
// (e.g. "Financials" vs "Financial Services"). Normalise so the filter still matches.
const SECTOR_ALIASES: Record<string, string> = {
  "Financials": "Financial Services",
  "Financial": "Financial Services",
  "Consumer Discretionary": "Consumer Cyclical",
  "Consumer Staples": "Consumer Defensive",
  "Materials": "Basic Materials",
  "Information Technology": "Technology",
  "Telecommunication Services": "Communication Services",
  "Telecommunications": "Communication Services",
  "Health Care": "Healthcare",
};

const normaliseSector = (s: string) => SECTOR_ALIASES[s] ?? s;

const CAP_PRESETS = [
  { label: "All",           min: 0,   max: Infinity },
  { label: "Mega 200B+",   min: 200,  max: Infinity },
  { label: "Large 10–200B",min: 10,   max: 200 },
  { label: "Mid 2–10B",    min: 2,    max: 10 },
  { label: "Small <2B",    min: 0,    max: 2 },
];

type SortField = "market_cap" | "change_pct" | "week_52_return" | "pe_ratio" | "dividend_yield" | "price";

function fmtCap(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function PctCell({ v }: { v: number | null }) {
  if (v === null || v === undefined)
    return <span className="text-muted text-xs">—</span>;
  return (
    <span className={clsx("text-xs font-semibold", v >= 0 ? "text-positive" : "text-negative")}>
      {v >= 0 ? "+" : ""}{v.toFixed(2)}%
    </span>
  );
}

function SortTh({
  label, field, sortField, sortDir, onSort, className,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: "asc" | "desc";
  onSort: (f: SortField) => void;
  className?: string;
}) {
  const active = sortField === field;
  return (
    <th className={clsx("px-3 py-2.5", className)}>
      <button
        onClick={() => onSort(field)}
        className={clsx(
          "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap transition-colors ml-auto",
          active ? "text-accent" : "text-muted hover:text-white"
        )}
      >
        {label}
        {active
          ? sortDir === "desc"
            ? <ArrowDown size={11} />
            : <ArrowUp size={11} />
          : <ArrowUpDown size={11} className="opacity-40" />}
      </button>
    </th>
  );
}

function RangeInput({
  label, minVal, maxVal, onMin, onMax, placeholder = ["Min", "Max"],
}: {
  label: string;
  minVal: string;
  maxVal: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  placeholder?: [string, string];
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={minVal}
          onChange={(e) => onMin(e.target.value)}
          placeholder={placeholder[0]}
          className="w-full bg-surface-hover border border-border rounded-lg px-2.5 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent/60"
        />
        <span className="text-muted text-xs shrink-0">–</span>
        <input
          type="number"
          value={maxVal}
          onChange={(e) => onMax(e.target.value)}
          placeholder={placeholder[1]}
          className="w-full bg-surface-hover border border-border rounded-lg px-2.5 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent/60"
        />
      </div>
    </div>
  );
}

export default function Screener() {
  const [sector, setSector]       = useState("All Sectors");
  const [capPreset, setCapPreset] = useState(0);
  const [minPE, setMinPE]         = useState("");
  const [maxPE, setMaxPE]         = useState("");
  const [min52W, setMin52W]       = useState("");
  const [max52W, setMax52W]       = useState("");
  const [minYield, setMinYield]   = useState("");
  const [maxYield, setMaxYield]   = useState("");
  const [sortField, setSortField] = useState<SortField>("market_cap");
  const [sortDir, setSortDir]     = useState<"asc" | "desc">("desc");
  const [search, setSearch]       = useState("");

  // ── Streaming fetch ──────────────────────────────────────────────────────
  const [data, setData]           = useState<ScreenerRow[]>([]);
  const [loadedCount, setLoaded]  = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError]     = useState(false);
  const [retryKey, setRetryKey]   = useState(0);
  const pendingRef                = useRef<ScreenerRow[]>([]);
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retry = () => {
    setData([]); setLoaded(0); setIsLoading(true); setIsError(false);
    pendingRef.current = [];
    setRetryKey(k => k + 1);
  };

  useEffect(() => {
    let cancelled = false;

    const flush = () => {
      timerRef.current = null;
      if (cancelled || pendingRef.current.length === 0) return;
      const batch = pendingRef.current.splice(0);
      setData(prev => [...prev, ...batch]);
      setLoaded(c => c + batch.length);
    };

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 150_000);

    (async () => {
      try {
        const res = await fetch(`${API_URL}/stocks/screener`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok || !res.body) throw new Error("stream failed");
        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || cancelled) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const row = JSON.parse(line) as ScreenerRow;
              if (!("error" in row)) pendingRef.current.push(row);
            } catch { /* skip malformed line */ }
          }
          // Show first stocks immediately; batch subsequent ones every 300 ms
          if (!timerRef.current) {
            timerRef.current = setTimeout(flush, pendingRef.current.length > 5 ? 0 : 300);
          }
          setIsLoading(false);
        }
        flush();
        if (!cancelled) setIsLoading(false);
      } catch {
        if (!cancelled) { setIsError(true); setIsLoading(false); }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
      if (timerRef.current) clearTimeout(timerRef.current);
    };

  }, [retryKey]);

  const capFilter = CAP_PRESETS[capPreset];

  const results = useMemo(() => {
    if (!data.length) return [];
    let rows = [...data];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) => r.ticker.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
      );
    }

    if (sector !== "All Sectors") {
      rows = rows.filter((r) => normaliseSector(r.sector) === sector);
    }

    rows = rows.filter((r) => {
      const capB = r.market_cap / 1e9;
      return capB >= capFilter.min && capB <= capFilter.max;
    });

    if (minPE !== "")    rows = rows.filter((r) => r.pe_ratio !== null && r.pe_ratio! >= +minPE);
    if (maxPE !== "")    rows = rows.filter((r) => r.pe_ratio !== null && r.pe_ratio! <= +maxPE);
    if (min52W !== "")   rows = rows.filter((r) => r.week_52_return !== null && r.week_52_return! >= +min52W);
    if (max52W !== "")   rows = rows.filter((r) => r.week_52_return !== null && r.week_52_return! <= +max52W);
    if (minYield !== "") rows = rows.filter((r) => r.dividend_yield >= +minYield);
    if (maxYield !== "") rows = rows.filter((r) => r.dividend_yield <= +maxYield);

    rows.sort((a, b) => {
      // Nulls always sort to the bottom regardless of direction
      const aVal = (a[sortField] as number | null) ?? -Infinity;
      const bVal = (b[sortField] as number | null) ?? -Infinity;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });

    return rows;
  }, [data, search, sector, capPreset, capFilter, minPE, maxPE, min52W, max52W, minYield, maxYield, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function clearFilters() {
    setSector("All Sectors");
    setCapPreset(0);
    setMinPE(""); setMaxPE("");
    setMin52W(""); setMax52W("");
    setMinYield(""); setMaxYield("");
    setSearch("");
  }

  const hasFilters =
    sector !== "All Sectors" || capPreset !== 0 ||
    minPE || maxPE || min52W || max52W || minYield || maxYield || search;

  return (
    <div className="p-6 space-y-5">

      {/* ── Filter Panel ──────────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={13} className="text-muted" />
            <h3 className="text-xs font-semibold text-muted uppercase tracking-widest">Filters</h3>
          </div>
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-muted hover:text-white transition-colors"
            >
              <X size={12} />
              Clear all
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {/* Search */}
          <div className="relative xl:col-span-1">
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Search
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ticker or name…"
                className="w-full bg-surface-hover border border-border rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent/60"
              />
            </div>
          </div>

          {/* Sector */}
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Sector
            </label>
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-accent/60 appearance-none"
            >
              {SECTORS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Market Cap */}
          <div className="xl:col-span-2">
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Market Cap
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CAP_PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => setCapPreset(i)}
                  className={clsx(
                    "text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap",
                    capPreset === i
                      ? "bg-accent/20 border-accent/50 text-accent"
                      : "bg-surface-hover border-border text-muted hover:text-white hover:border-border/80"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <RangeInput
            label="P/E Ratio"
            minVal={minPE} maxVal={maxPE}
            onMin={setMinPE} onMax={setMaxPE}
          />

          <RangeInput
            label="52W Return (%)"
            minVal={min52W} maxVal={max52W}
            onMin={setMin52W} onMax={setMax52W}
            placeholder={["-50", "+200"]}
          />

          <RangeInput
            label="Dividend Yield (%)"
            minVal={minYield} maxVal={maxYield}
            onMin={setMinYield} onMax={setMaxYield}
            placeholder={["0", "10"]}
          />
        </div>
      </div>

      {/* ── Results Table ─────────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-hover/40">
          <span className="text-xs font-semibold text-white uppercase tracking-widest">
            {isLoading && loadedCount === 0
              ? "Loading…"
              : `${results.length} Stocks`}
          </span>
          <span className="text-[10px] text-muted">
            {loadedCount > 0 && loadedCount < 350
              ? `${loadedCount} / 350 loaded`
              : loadedCount >= 350
                ? "350 in universe"
                : null}
          </span>
        </div>

        {isLoading && loadedCount === 0 && (
          <div className="p-4 space-y-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-9 bg-surface-hover rounded-lg animate-pulse" />
            ))}
            <p className="text-center text-xs text-muted pt-2 pb-1">
              Connecting to market data…
            </p>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center h-32 gap-3 text-muted text-sm">
            <span>Failed to load screener data.</span>
            <button onClick={retry}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover text-xs text-muted hover:text-white transition-colors">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        {!isError && loadedCount > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted uppercase tracking-wider w-8">#</th>
                  <th className="px-3 py-2.5 text-left">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Ticker</span>
                  </th>
                  <th className="px-3 py-2.5 text-left">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Company</span>
                  </th>
                  <th className="px-3 py-2.5 text-left">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Sector</span>
                  </th>
                  <SortTh label="Price"   field="price"          sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Day %"   field="change_pct"     sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="52W %"   field="week_52_return" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Mkt Cap" field="market_cap"     sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="P/E"     field="pe_ratio"       sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Yield"   field="dividend_yield" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="pr-5" />
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-12 text-center text-muted text-sm">
                      No stocks match your filters.
                    </td>
                  </tr>
                ) : (
                  results.map((row, i) => (
                    <tr
                      key={row.ticker}
                      className="border-b border-border/40 last:border-0 hover:bg-surface-hover transition-colors"
                    >
                      <td className="px-5 py-3 text-[10px] text-muted">{i + 1}</td>
                      <td className="px-3 py-3">
                        <Link
                          to={`/stock/${row.ticker}`}
                          className="text-sm font-bold text-accent hover:text-accent/80 transition-colors"
                        >
                          {row.ticker}
                        </Link>
                      </td>
                      <td className="px-3 py-3 max-w-[200px]">
                        <div className="text-sm text-white truncate">{row.name}</div>
                        {row.industry && (
                          <div className="text-[10px] text-muted truncate">{row.industry}</div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-muted">{row.sector}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-sm font-medium text-white">${row.price.toFixed(2)}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <PctCell v={row.change_pct} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <PctCell v={row.week_52_return} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-xs text-white">
                          {row.market_cap ? fmtCap(row.market_cap) : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-xs text-white">
                          {row.pe_ratio !== null ? row.pe_ratio?.toFixed(1) : "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="text-xs text-white">
                          {row.dividend_yield > 0 ? `${row.dividend_yield.toFixed(2)}%` : "—"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
