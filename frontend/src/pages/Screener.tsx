import { useState, useMemo, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpDown, ArrowUp, ArrowDown, Search, SlidersHorizontal, X, RefreshCw,
  Star, Bookmark, LayoutGrid, List as ListIcon, Check,
} from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import { API_URL } from "../env";
import { getWatchlist, addToWatchlist, removeFromWatchlist } from "../api/watchlist";
import { getSavedScreens, saveScreen, deleteSavedScreen, type SavedScreen } from "../api/screener";

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
  volume: number | null;
  volume_level: "Low" | "Average" | "High" | "Very High";
  country: string;
}

const SECTORS = [
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
  { label: "All",          min: 0,    max: Infinity },
  { label: "Mega 200B+",   min: 200,  max: Infinity },
  { label: "Large 10–200B",min: 10,   max: 200 },
  { label: "Mid 2–10B",    min: 2,    max: 10 },
  { label: "Small 0.3–2B", min: 0.3,  max: 2 },
  { label: "Micro <0.3B",  min: 0,    max: 0.3 },
];

const VOLUME_LEVELS = ["Low", "Average", "High", "Very High"] as const;

const PE_BOUNDS: [number, number] = [0, 100];
const YIELD_BOUNDS: [number, number] = [0, 10];
const RETURN_BOUNDS: [number, number] = [-50, 200];

type SortField = "market_cap" | "change_pct" | "week_52_return" | "pe_ratio" | "dividend_yield" | "price" | "volume";
type ViewMode = "table" | "grid";

interface FilterState {
  sectors: string[];
  capPreset: number;
  minPE: number; maxPE: number;
  min52W: number; max52W: number;
  minYield: number; maxYield: number;
  volumeLevels: string[];
  minPrice: string; maxPrice: string;
  country: "All" | "US" | "International";
}

const DEFAULT_FILTERS: FilterState = {
  sectors: [],
  capPreset: 0,
  minPE: PE_BOUNDS[0], maxPE: PE_BOUNDS[1],
  min52W: RETURN_BOUNDS[0], max52W: RETURN_BOUNDS[1],
  minYield: YIELD_BOUNDS[0], maxYield: YIELD_BOUNDS[1],
  volumeLevels: [],
  minPrice: "", maxPrice: "",
  country: "All",
};

const PRESET_SCREENS: { key: string; label: string; filters: Partial<FilterState> }[] = [
  { key: "all",         label: "All Stocks",          filters: {} },
  { key: "dividend",    label: "Dividend Aristocrats", filters: { minYield: 2 } },
  { key: "growth",      label: "High Growth",          filters: { min52W: 20 } },
  { key: "undervalued", label: "Undervalued",          filters: { maxPE: 15 } },
  { key: "volume",      label: "Top Volume Today",     filters: { volumeLevels: ["High", "Very High"] } },
];

function fmtCap(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  return `$${n.toFixed(0)}`;
}

function fmtVolume(n: number | null): string {
  if (!n) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
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

/* Dual-handle range slider built from two overlapping native <input type="range">
   elements — avoids pulling in a slider dependency for four sliders total. */
const THUMB_CLASS =
  "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none " +
  "[&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full " +
  "[&::-webkit-slider-thumb]:bg-accent [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 " +
  "[&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow " +
  "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none " +
  "[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full " +
  "[&::-moz-range-thumb]:bg-accent [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-2 " +
  "[&::-moz-range-thumb]:border-white";

function RangeSlider({
  label, bounds, minVal, maxVal, onMin, onMax, suffix = "", step = 1,
}: {
  label: string;
  bounds: [number, number];
  minVal: number;
  maxVal: number;
  onMin: (v: number) => void;
  onMax: (v: number) => void;
  suffix?: string;
  step?: number;
}) {
  const [lo, hi] = bounds;
  const span = hi - lo || 1;
  const fmt = (v: number) => (v === hi ? `${v}${suffix}+` : `${v}${suffix}`);
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</label>
        <span className="text-[10px] text-muted tabular-nums">{fmt(minVal)} – {fmt(maxVal)}</span>
      </div>
      <div className="relative h-4 flex items-center">
        <div className="absolute inset-x-0 h-1 bg-border rounded-full" />
        <div
          className="absolute h-1 bg-accent rounded-full"
          style={{
            left: `${((minVal - lo) / span) * 100}%`,
            right: `${100 - ((maxVal - lo) / span) * 100}%`,
          }}
        />
        <input
          type="range" min={lo} max={hi} step={step} value={minVal}
          onChange={(e) => onMin(Math.min(+e.target.value, maxVal))}
          className={clsx("absolute inset-x-0 w-full h-4 appearance-none bg-transparent pointer-events-none", THUMB_CLASS)}
        />
        <input
          type="range" min={lo} max={hi} step={step} value={maxVal}
          onChange={(e) => onMax(Math.max(+e.target.value, minVal))}
          className={clsx("absolute inset-x-0 w-full h-4 appearance-none bg-transparent pointer-events-none", THUMB_CLASS)}
        />
      </div>
    </div>
  );
}

/* Real-data 3-point trend line (52W low → yesterday's close → today's price)
   plotted against the 52-week range. Not a true daily-price sparkline — the
   screener payload doesn't carry per-day history — but it's an honest,
   zero-extra-request visual built entirely from numbers already in the row. */
function MiniTrend({ row }: { row: ScreenerRow }) {
  const lo = row.week_52_low ?? row.price * 0.85;
  const hi = row.week_52_high ?? row.price * 1.15;
  const range = hi - lo || 1;
  const yesterday = row.price / (1 + row.change_pct / 100);
  const xs = [2, 30, 58];
  const ys = [lo, yesterday, row.price].map(
    (v) => 18 - ((Math.min(Math.max(v, lo), hi) - lo) / range) * 16
  );
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x},${ys[i].toFixed(1)}`).join(" ");
  const positive = row.change_pct >= 0;
  return (
    <svg viewBox="0 0 60 20" className="w-full h-5" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={positive ? "#10b981" : "#ef4444"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StockCard({
  row, isWatched, onToggleWatch,
}: { row: ScreenerRow; isWatched: boolean; onToggleWatch: () => void }) {
  return (
    <div className="bg-surface-hover rounded-xl border border-border p-4 hover:border-accent/40 transition-colors">
      <div className="flex items-start justify-between mb-2 gap-2">
        <div className="min-w-0">
          <Link to={`/stock/${row.ticker}`} className="text-sm font-bold text-accent hover:text-accent/80">
            {row.ticker}
          </Link>
          <div className="text-[11px] text-muted truncate">{row.name}</div>
        </div>
        <button
          onClick={onToggleWatch}
          className="shrink-0 p-1 -m-1 text-muted hover:text-amber-400 transition-colors"
          title={isWatched ? "Remove from watchlist" : "Add to watchlist"}
        >
          <Star size={15} fill={isWatched ? "currentColor" : "none"} className={isWatched ? "text-amber-400" : ""} />
        </button>
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-lg font-bold text-white">${row.price.toFixed(2)}</span>
        <PctCell v={row.change_pct} />
      </div>

      <MiniTrend row={row} />

      <div className="grid grid-cols-3 gap-1 text-center pt-2.5 mt-1 border-t border-border/50">
        <div>
          <div className="text-[11px] font-semibold text-white">{row.pe_ratio?.toFixed(1) ?? "—"}</div>
          <div className="text-[9px] text-muted uppercase tracking-wider">P/E</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-white">
            {row.dividend_yield > 0 ? `${row.dividend_yield.toFixed(2)}%` : "—"}
          </div>
          <div className="text-[9px] text-muted uppercase tracking-wider">Yield</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-white">{row.market_cap ? fmtCap(row.market_cap) : "—"}</div>
          <div className="text-[9px] text-muted uppercase tracking-wider">Cap</div>
        </div>
      </div>
    </div>
  );
}

// Module-level cache so the streamed universe survives navigating to another
// tab and back. Without it, every mount fired a fresh /stocks/screener stream
// and the user watched the skeleton reload each time. With it, the first mount
// pays the full streaming cost, subsequent mounts hydrate instantly from cache,
// and a periodic timer quietly refreshes prices in the background.
interface ScreenerCache {
  rows: ScreenerRow[];
  ts: number;            // last successful refresh timestamp (ms)
  refreshingTs: number;  // timestamp of the in-flight refresh (0 = idle)
}
const screenerCache: ScreenerCache = { rows: [], ts: 0, refreshingTs: 0 };

// How often the background refresher re-streams the universe to keep prices
// fresh. 15 minutes: the screener is a non-critical view, and the backend's
// 30-minute cache means we still land in the warm-cache fast path.
const SCREENER_REFRESH_MS = 15 * 60 * 1000;

export default function Screener() {
  const qc = useQueryClient();
  const [filters, setFilters]       = useState<FilterState>(DEFAULT_FILTERS);
  const [activePreset, setActivePreset] = useState<string>("all");
  const [search, setSearch]         = useState("");
  const [sortField, setSortField]   = useState<SortField>("market_cap");
  const [sortDir, setSortDir]       = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode]     = useState<ViewMode>("table");
  const [saveName, setSaveName]     = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);

  // ── Watchlist ────────────────────────────────────────────────────────────
  const { data: watchlistData } = useQuery({ queryKey: ["watchlist"], queryFn: getWatchlist });
  const watchedSet = useMemo(
    () => new Set((watchlistData ?? []).map((w: { ticker: string }) => w.ticker)),
    [watchlistData]
  );
  const watchMutation = useMutation({
    mutationFn: async (ticker: string) => { await (watchedSet.has(ticker) ? removeFromWatchlist(ticker) : addToWatchlist(ticker)); },
    onMutate: async (ticker: string) => {
      await qc.cancelQueries({ queryKey: ["watchlist"] });
      const prev = qc.getQueryData<{ ticker: string }[]>(["watchlist"]) ?? [];
      const wasWatched = watchedSet.has(ticker);
      const next = wasWatched
        ? prev.filter((w) => w.ticker !== ticker)
        : [...prev, { ticker, id: -1 }];
      qc.setQueryData(["watchlist"], next);
      // Capture pre-mutation state here — by the time onSuccess fires, the
      // optimistic update above has already re-rendered the component with a
      // fresh `watchedSet`, so reading it again in onSuccess would report the
      // POST-toggle state and invert the toast message.
      return { prev, wasWatched };
    },
    onSuccess: (_d, ticker, ctx) =>
      toast.success(ctx?.wasWatched ? `Removed ${ticker} from watchlist` : `Added ${ticker} to watchlist`),
    onError: (_e, _v, ctx) => {
      if (ctx) qc.setQueryData(["watchlist"], ctx.prev);
      toast.error("Failed to update watchlist");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  // ── Saved screens ────────────────────────────────────────────────────────
  const { data: savedScreens } = useQuery({ queryKey: ["saved-screens"], queryFn: getSavedScreens });
  const saveMutation = useMutation({
    mutationFn: () => saveScreen(saveName.trim(), { ...filters, search }),
    onSuccess: () => {
      toast.success(`Saved "${saveName.trim()}"`);
      setSaveName(""); setShowSaveInput(false);
      qc.invalidateQueries({ queryKey: ["saved-screens"] });
    },
    onError: () => toast.error("Failed to save screen"),
  });
  const deleteSavedMutation = useMutation({
    mutationFn: (id: number) => deleteSavedScreen(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-screens"] }),
    onError: () => toast.error("Failed to delete saved screen"),
  });

  function applyPreset(key: string) {
    const preset = PRESET_SCREENS.find((p) => p.key === key);
    if (!preset) return;
    setFilters({ ...DEFAULT_FILTERS, ...preset.filters });
    setActivePreset(key);
  }

  function applySaved(s: SavedScreen) {
    const f = s.filters as Partial<FilterState> & { search?: string };
    setFilters({ ...DEFAULT_FILTERS, ...f });
    setSearch(f.search ?? "");
    setActivePreset("");
  }

  function update<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setActivePreset("");
  }

  function toggleSector(s: string) {
    update("sectors", filters.sectors.includes(s)
      ? filters.sectors.filter((x) => x !== s)
      : [...filters.sectors, s]);
  }

  function toggleVolumeLevel(v: string) {
    update("volumeLevels", filters.volumeLevels.includes(v)
      ? filters.volumeLevels.filter((x) => x !== v)
      : [...filters.volumeLevels, v]);
  }

  // ── Streaming fetch ──────────────────────────────────────────────────────
  // The cache (declared at module scope above) lets the streamed universe
  // survive navigating to another tab and back. First mount in a session
  // streams the full universe; later mounts hydrate from cache immediately
  // and quietly refresh prices in the background.
  const [data, setData]           = useState<ScreenerRow[]>(() => screenerCache.rows);
  const [loadedCount, setLoaded]  = useState(() => screenerCache.rows.length);
  const [isLoading, setIsLoading] = useState(() => screenerCache.rows.length === 0);
  const [isError, setIsError]     = useState(false);
  const [retryKey, setRetryKey]   = useState(0);
  const [errorMsg, setErrorMsg]   = useState("");
  const pendingRef                = useRef<ScreenerRow[]>([]);
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retry = () => {
    // Manual retry: wipe both component state and the module cache so the
    // user gets a guaranteed fresh stream (e.g. after an error).
    screenerCache.rows = [];
    screenerCache.ts = 0;
    setData([]); setLoaded(0); setIsLoading(true); setIsError(false);
    pendingRef.current = [];
    setRetryKey(k => k + 1);
  };

  // Refresh the in-memory cache + state without flipping isLoading/isError.
  // Used by the periodic timer below — silent price update with no skeleton.
  async function refreshScreenerInBackground() {
    if (Date.now() - screenerCache.refreshingTs < 15_000) return;  // dedupe
    screenerCache.refreshingTs = Date.now();
    try {
      const res = await fetch(`${API_URL}/stocks/screener`);
      if (!res.ok || !res.body) return;
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      const buf: ScreenerRow[] = [];
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const lines = acc.split("\n");
        acc = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line) as ScreenerRow;
            if (!("error" in row)) buf.push(row);
          } catch { /* skip */ }
        }
      }
      if (buf.length > 0) {
        screenerCache.rows = buf;
        screenerCache.ts = Date.now();
        setData(buf);
        setLoaded(buf.length);
      }
    } catch {
      // Silent — user keeps the previously cached rows.
    } finally {
      screenerCache.refreshingTs = 0;
    }
  }

  useEffect(() => {
    let cancelled = false;
    // Already have cached rows? Skip the foreground stream — the user sees
    // their stocks instantly and the background refresher (below) keeps
    // prices current. This is the fix for "screener reloads every time the
    // user navigates back to the tab".
    const hasCache = screenerCache.rows.length > 0;

    const flush = () => {
      timerRef.current = null;
      if (cancelled || pendingRef.current.length === 0) return;
      const batch = pendingRef.current.splice(0);
      setData(prev => [...prev, ...batch]);
      setLoaded(c => c + batch.length);
    };

    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 150_000);

    if (!hasCache || retryKey > 0) {
      // First mount of the session (or explicit retry) — full foreground stream.
      (async () => {
        try {
          const res = await fetch(`${API_URL}/stocks/screener`, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.status === 429) {
            const ra = parseInt(res.headers.get("retry-after") ?? "", 10);
            throw new Error(`rate-limited:${Number.isNaN(ra) ? 60 : ra}`);
          }
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
            // Keep rows in `pendingRef` while the stream is still running so
            // the UI doesn't reveal a half-loaded universe (users used to see
            // the row count climb 30 → 36 → 41 → … → 599 live).
          }
          // Stream complete — drop the whole accumulated batch at once and
          // promote it into the module cache so subsequent mounts skip the
          // stream entirely.
          if (!cancelled) {
            flush();
            setData(prev => {
              if (prev.length > 0) {
                screenerCache.rows = prev;
                screenerCache.ts = Date.now();
              }
              return prev;
            });
            setIsLoading(false);
          }
        } catch (e) {
          if (!cancelled) {
            const m = /^rate-limited:(\d+)$/.exec((e as Error)?.message ?? "");
            if (m) setErrorMsg(`Rate limited — retry in ~${m[1]}s.`);
            setIsError(true);
            setIsLoading(false);
          }
        }
      })();
    }

    // Periodic background refresh — keeps prices fresh while the user stays on
    // the tab AND while they're elsewhere. Only fires when the document is
    // visible so we don't burn bandwidth on hidden tabs.
    const refreshTimer = setInterval(() => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      if (Date.now() - screenerCache.ts < SCREENER_REFRESH_MS) return;
      void refreshScreenerInBackground();
    }, 30_000);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
      clearInterval(refreshTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };

  }, [retryKey]);

  const capFilter = CAP_PRESETS[filters.capPreset];

  const results = useMemo(() => {
    if (!data.length) return [];
    let rows = [...data];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) => r.ticker.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
      );
    }

    if (filters.sectors.length) {
      rows = rows.filter((r) => filters.sectors.includes(normaliseSector(r.sector)));
    }

    rows = rows.filter((r) => {
      const capB = r.market_cap / 1e9;
      return capB >= capFilter.min && capB <= capFilter.max;
    });

    const peMax = filters.maxPE >= PE_BOUNDS[1] ? Infinity : filters.maxPE;
    if (filters.minPE > PE_BOUNDS[0] || peMax < Infinity) {
      rows = rows.filter((r) => r.pe_ratio !== null && r.pe_ratio >= filters.minPE && r.pe_ratio <= peMax);
    }

    const retMax = filters.max52W >= RETURN_BOUNDS[1] ? Infinity : filters.max52W;
    const retMin = filters.min52W <= RETURN_BOUNDS[0] ? -Infinity : filters.min52W;
    if (retMin > -Infinity || retMax < Infinity) {
      rows = rows.filter((r) => r.week_52_return !== null && r.week_52_return >= retMin && r.week_52_return <= retMax);
    }

    const yieldMax = filters.maxYield >= YIELD_BOUNDS[1] ? Infinity : filters.maxYield;
    if (filters.minYield > YIELD_BOUNDS[0] || yieldMax < Infinity) {
      rows = rows.filter((r) => r.dividend_yield >= filters.minYield && r.dividend_yield <= yieldMax);
    }

    if (filters.volumeLevels.length) {
      rows = rows.filter((r) => filters.volumeLevels.includes(r.volume_level));
    }

    if (filters.minPrice !== "") rows = rows.filter((r) => r.price >= +filters.minPrice);
    if (filters.maxPrice !== "") rows = rows.filter((r) => r.price <= +filters.maxPrice);

    if (filters.country === "US") rows = rows.filter((r) => r.country === "United States");
    if (filters.country === "International") rows = rows.filter((r) => r.country !== "United States");

    // "Undervalued" preset implies positive earnings — a real trailing P/E is
    // only reported by yfinance when EPS is positive, so excluding nulls here
    // already enforces that; this guard just keeps the rule explicit.
    if (activePreset === "undervalued") {
      rows = rows.filter((r) => r.pe_ratio !== null && r.pe_ratio > 0);
    }

    rows.sort((a, b) => {
      const aVal = (a[sortField] as number | null) ?? -Infinity;
      const bVal = (b[sortField] as number | null) ?? -Infinity;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });

    return rows;
  }, [data, search, filters, capFilter, sortField, sortDir, activePreset]);

  // Render the (up to 2,099-row) result set incrementally: mounting every
  // row at once re-layouts the whole list on each sort/filter/watch toggle,
  // which visibly janks on low-end devices at the widened universe size.
  // 200 rows cover a deep scroll; "Show more" extends in 300-row steps and
  // the window resets whenever the result set changes shape.
  const PAGE_SIZE = 200;
  const PAGE_STEP = 300;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [data, search, filters, capFilter, sortField, sortDir, activePreset]);
  const visible = useMemo(() => results.slice(0, visibleCount), [results, visibleCount]);
  const hiddenCount = Math.max(0, results.length - visible.length);
  const showMoreButton = hiddenCount > 0 && (
    <div className="py-3 flex justify-center">
      <button
        onClick={() => setVisibleCount((c) => c + PAGE_STEP)}
        className="px-4 py-2 rounded-lg bg-surface-hover text-xs text-muted hover:text-white transition-colors"
      >
        Show {Math.min(PAGE_STEP, hiddenCount)} more ({hiddenCount} remaining)
      </button>
    </div>
  );

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  function clearFilters() {
    setFilters(DEFAULT_FILTERS);
    setSearch("");
    setActivePreset("all");
  }

  const hasFilters =
    filters.sectors.length || filters.capPreset !== 0 ||
    filters.minPE > PE_BOUNDS[0] || filters.maxPE < PE_BOUNDS[1] ||
    filters.min52W > RETURN_BOUNDS[0] || filters.max52W < RETURN_BOUNDS[1] ||
    filters.minYield > YIELD_BOUNDS[0] || filters.maxYield < YIELD_BOUNDS[1] ||
    filters.volumeLevels.length || filters.minPrice || filters.maxPrice ||
    filters.country !== "All" || search;

  return (
    <div className="p-6 space-y-5">

      {/* ── Pre-built screens ─────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {PRESET_SCREENS.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            className={clsx(
              "shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap",
              activePreset === p.key
                ? "bg-accent/20 border-accent/50 text-accent"
                : "bg-surface border-border text-muted hover:text-white hover:border-border/80"
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Filter Panel ──────────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={13} className="text-muted" />
            <h3 className="text-xs font-semibold text-muted uppercase tracking-widest">Filters</h3>
          </div>
          <div className="flex items-center gap-3">
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-muted hover:text-white transition-colors"
              >
                <X size={12} />
                Clear all
              </button>
            )}
            {showSaveInput ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && saveName.trim()) saveMutation.mutate(); if (e.key === "Escape") setShowSaveInput(false); }}
                  placeholder="Screen name…"
                  className="bg-surface-hover border border-border rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-muted focus:outline-none focus:border-accent/60 w-36"
                />
                <button
                  onClick={() => saveName.trim() && saveMutation.mutate()}
                  disabled={!saveName.trim() || saveMutation.isPending}
                  className="p-1.5 rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors disabled:opacity-40"
                >
                  <Check size={13} />
                </button>
                <button onClick={() => setShowSaveInput(false)} className="p-1.5 rounded-lg text-muted hover:text-white transition-colors">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowSaveInput(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-white transition-colors"
              >
                <Bookmark size={12} />
                Save this Screen
              </button>
            )}
          </div>
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

          {/* Market Cap */}
          <div className="xl:col-span-2">
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Market Cap
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CAP_PRESETS.map((p, i) => (
                <button
                  key={i}
                  onClick={() => update("capPreset", i)}
                  className={clsx(
                    "text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap",
                    filters.capPreset === i
                      ? "bg-accent/20 border-accent/50 text-accent"
                      : "bg-surface-hover border-border text-muted hover:text-white hover:border-border/80"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Country */}
          <div className="xl:col-span-1">
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Country
            </label>
            <div className="flex gap-1.5">
              {(["All", "US", "International"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => update("country", c)}
                  className={clsx(
                    "flex-1 text-[10px] font-semibold px-2 py-1.5 rounded-lg border transition-colors whitespace-nowrap",
                    filters.country === c
                      ? "bg-accent/20 border-accent/50 text-accent"
                      : "bg-surface-hover border-border text-muted hover:text-white hover:border-border/80"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <RangeInput
            label="Price ($)"
            minVal={filters.minPrice} maxVal={filters.maxPrice}
            onMin={(v) => update("minPrice", v)} onMax={(v) => update("maxPrice", v)}
          />

          {/* Sectors — multi-select */}
          <div className="xl:col-span-3">
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Sector
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => update("sectors", [])}
                className={clsx(
                  "text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors",
                  filters.sectors.length === 0
                    ? "bg-accent/20 border-accent/50 text-accent"
                    : "bg-surface-hover border-border text-muted hover:text-white hover:border-border/80"
                )}
              >
                All Sectors
              </button>
              {SECTORS.map((s) => (
                <button
                  key={s}
                  onClick={() => toggleSector(s)}
                  className={clsx(
                    "text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap",
                    filters.sectors.includes(s)
                      ? "bg-accent/20 border-accent/50 text-accent"
                      : "bg-surface-hover border-border text-muted hover:text-white hover:border-border/80"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Volume — multi-select */}
          <div className="xl:col-span-3">
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1.5">
              Volume
            </label>
            <div className="flex flex-wrap gap-1.5">
              {VOLUME_LEVELS.map((v) => (
                <button
                  key={v}
                  onClick={() => toggleVolumeLevel(v)}
                  className={clsx(
                    "text-[10px] font-semibold px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap",
                    filters.volumeLevels.includes(v)
                      ? "bg-accent/20 border-accent/50 text-accent"
                      : "bg-surface-hover border-border text-muted hover:text-white hover:border-border/80"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <RangeSlider
            label="P/E Ratio" bounds={PE_BOUNDS}
            minVal={filters.minPE} maxVal={filters.maxPE}
            onMin={(v) => update("minPE", v)} onMax={(v) => update("maxPE", v)}
          />

          <RangeSlider
            label="52W Performance" bounds={RETURN_BOUNDS} suffix="%"
            minVal={filters.min52W} maxVal={filters.max52W}
            onMin={(v) => update("min52W", v)} onMax={(v) => update("max52W", v)}
          />

          <RangeSlider
            label="Dividend Yield" bounds={YIELD_BOUNDS} suffix="%" step={0.1}
            minVal={filters.minYield} maxVal={filters.maxYield}
            onMin={(v) => update("minYield", v)} onMax={(v) => update("maxYield", v)}
          />
        </div>
      </div>

      {/* ── Saved screens ─────────────────────────────────────────────── */}
      {!!savedScreens?.length && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold text-muted uppercase tracking-wider mr-1">Saved:</span>
          {savedScreens.map((s) => (
            <div
              key={s.id}
              className="group flex items-center gap-1 text-[11px] font-medium pl-2.5 pr-1.5 py-1 rounded-full border border-border bg-surface-hover text-muted hover:text-white hover:border-accent/40 transition-colors"
            >
              <button onClick={() => applySaved(s)}>{s.name}</button>
              <button
                onClick={() => deleteSavedMutation.mutate(s.id)}
                className="opacity-50 hover:opacity-100 hover:text-negative transition-opacity"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────── */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-hover/40">
          <span className="text-xs font-semibold text-white uppercase tracking-widest">
            {isLoading && loadedCount === 0
              ? "Loading…"
              : `${results.length} Stocks`}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-muted">
              {loadedCount > 0 && isLoading
                ? `${loadedCount} / ${loadedCount} loaded`
                : loadedCount > 0
                  ? `${loadedCount} in universe`
                  : null}
            </span>
            <div className="flex items-center gap-1 bg-surface-hover rounded-lg p-0.5 border border-border">
              <button
                onClick={() => setViewMode("table")}
                className={clsx("p-1.5 rounded-md transition-colors", viewMode === "table" ? "bg-accent/20 text-accent" : "text-muted hover:text-white")}
                title="Table view"
              >
                <ListIcon size={13} />
              </button>
              <button
                onClick={() => setViewMode("grid")}
                className={clsx("p-1.5 rounded-md transition-colors", viewMode === "grid" ? "bg-accent/20 text-accent" : "text-muted hover:text-white")}
                title="Card view"
              >
                <LayoutGrid size={13} />
              </button>
            </div>
          </div>
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
            <span>{errorMsg || "Failed to load screener data."}</span>
            <button onClick={retry}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-hover text-xs text-muted hover:text-white transition-colors">
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        )}

        {!isError && loadedCount > 0 && viewMode === "grid" && (
          <div className="p-4">
            {results.length === 0 ? (
              <div className="py-12 text-center text-muted text-sm">No stocks match your filters.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {visible.map((row) => (
                    <StockCard
                      key={row.ticker}
                      row={row}
                      isWatched={watchedSet.has(row.ticker)}
                      onToggleWatch={() => watchMutation.mutate(row.ticker)}
                    />
                  ))}
                </div>
                {showMoreButton}
              </>
            )}
          </div>
        )}

        {!isError && loadedCount > 0 && viewMode === "table" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-muted uppercase tracking-wider w-8">#</th>
                  <th className="px-3 py-2.5 text-left">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Ticker</span>
                  </th>
                  <th className="px-3 py-2.5 text-left">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Company</span>
                  </th>
                  <SortTh label="Price"   field="price"          sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Day %"   field="change_pct"     sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="P/E"     field="pe_ratio"       sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Mkt Cap" field="market_cap"     sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Yield"   field="dividend_yield" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="52W %"   field="week_52_return" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <SortTh label="Volume"  field="volume"         sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-2.5 pr-5 text-right">
                    <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">Watch</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-5 py-12 text-center text-muted text-sm">
                      No stocks match your filters.
                    </td>
                  </tr>
                ) : (
                  visible.map((row, i) => {
                    const watched = watchedSet.has(row.ticker);
                    return (
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
                          <div className="text-[10px] text-muted truncate">{normaliseSector(row.sector)}</div>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className="text-sm font-medium text-white">${row.price.toFixed(2)}</span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <PctCell v={row.change_pct} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className="text-xs text-white">
                            {row.pe_ratio !== null ? row.pe_ratio?.toFixed(1) : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className="text-xs text-white">
                            {row.market_cap ? fmtCap(row.market_cap) : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className="text-xs text-white">
                            {row.dividend_yield > 0 ? `${row.dividend_yield.toFixed(2)}%` : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <PctCell v={row.week_52_return} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className="text-xs text-white">{fmtVolume(row.volume)}</span>
                          <div className="text-[9px] text-muted">{row.volume_level}</div>
                        </td>
                        <td className="px-3 py-3 pr-5 text-right">
                          <button
                            onClick={() => watchMutation.mutate(row.ticker)}
                            className="p-1 text-muted hover:text-amber-400 transition-colors"
                            title={watched ? "Remove from watchlist" : "Add to watchlist"}
                          >
                            <Star size={14} fill={watched ? "currentColor" : "none"} className={watched ? "text-amber-400" : ""} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            {showMoreButton}
          </div>
        )}
      </div>
    </div>
  );
}
