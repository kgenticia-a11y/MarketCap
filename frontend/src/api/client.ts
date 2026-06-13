import axios from "axios";
import { API_URL } from "../env";

const client = axios.create({
  baseURL: API_URL,
  // 30s ceiling so a hung backend doesn't translate to an infinite spinner.
  // Long-running endpoints (screener) bypass this client and use raw fetch.
  timeout: 30_000,
});

client.interceptors.request.use((config) => {
  const token = sessionStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    // On 401, clear the stored token and redirect to login so the user is
    // never left on a broken page with stale/missing data after session expiry.
    if (status === 401) {
      sessionStorage.removeItem("token");
      if (
        !window.location.pathname.startsWith("/login") &&
        !window.location.pathname.startsWith("/register")
      ) {
        window.location.href = "/login";
      }
    }

    // On 429, surface the Retry-After delay so callers can show a helpful
    // message rather than a generic network error.
    if (status === 429) {
      const retryAfter = error.response?.headers?.["retry-after"];
      const seconds = retryAfter ? parseInt(retryAfter, 10) : 60;
      error.retryAfterSeconds = isNaN(seconds) ? 60 : seconds;
    }

    return Promise.reject(error);
  },
);

export default client;
