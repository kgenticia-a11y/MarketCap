/**
 * Centralised runtime config.
 *
 * VITE_API_URL is the HTTP base URL of the FastAPI backend.
 * If unset (local dev), defaults to http://localhost:8000.
 */

export const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ||
  "http://localhost:8000";
