export interface Prefs {
  defaultRange:   string;
  refetchSec:     number;
  compactNumbers: boolean;
  chartType:      "area" | "candle";
}

export const DEFAULT_PREFS: Prefs = {
  defaultRange:   "1M",
  refetchSec:     30,
  compactNumbers: false,
  chartType:      "area",
};

const PREF_KEY = "mc_prefs";

export function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREF_KEY) || "{}") }; }
  catch { return DEFAULT_PREFS; }
}

export function savePrefs(p: Prefs) {
  localStorage.setItem(PREF_KEY, JSON.stringify(p));
}
