import axios from "axios";
import { API_URL } from "../env";

const client = axios.create({
  baseURL: API_URL,
  // 30s ceiling so a hung backend doesn't translate to an infinite spinner.
  // Long-running endpoints (screener) bypass this client and use raw fetch.
  timeout: 30_000,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, clear the stored token and redirect to login so the user is never
// left on a broken page with stale/missing data after session expiry.
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      // Only redirect if we're not already on an auth page (avoids redirect loops).
      if (!window.location.pathname.startsWith("/login") &&
          !window.location.pathname.startsWith("/register")) {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

export default client;
