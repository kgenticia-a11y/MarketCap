/**
 * Centralised runtime config.
 *
 * VITE_API_URL is the HTTP base URL of the FastAPI backend.
 * If unset (local dev), defaults to http://localhost:8000.
 */

export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ||
  "http://localhost:8000";

/**
 * Paper trading is parked behind a feature flag while the workflow is
 * reworked (planned relaunch: gated to tickers with a written memo).
 * Default: ON in local dev, OFF in production builds. Set
 * VITE_ENABLE_PAPER_TRADING=true|false to override either way.
 * The backend endpoints and all paper-trading data stay intact.
 */
const _paperFlag = import.meta.env.VITE_ENABLE_PAPER_TRADING as string | undefined;
export const PAPER_TRADING_ENABLED: boolean =
  _paperFlag != null ? _paperFlag === "true" : import.meta.env.DEV;
