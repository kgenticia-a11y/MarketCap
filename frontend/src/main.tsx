// Apply saved theme + accent colour before first render to avoid a flash
try {
  const theme = localStorage.getItem("mc_theme");
  if (theme !== "dark") document.documentElement.setAttribute("data-theme", "light");
  const saved = localStorage.getItem("mc_accent");
  if (saved) {
    const { base, light } = JSON.parse(saved);
    document.documentElement.style.setProperty("--accent",       base);
    document.documentElement.style.setProperty("--accent-light", light);
  }
} catch { /* ignore */ }

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import App from "./App.tsx";
import { ThemeProvider, useTheme } from "./context/ThemeContext.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Respect the server's Retry-After on 429s (client.ts stashes it on
      // the error); otherwise exponential back-off 1s → max 10s.
      retryDelay: (attempt, error) => {
        const ra = (error as { retryAfterSeconds?: number })?.retryAfterSeconds;
        if (ra) return ra * 1_000;
        return Math.min(1_000 * 2 ** attempt, 10_000);
      },
      // Data was stale-at-0ms by default, so every remount and every
      // window focus refired the whole page's requests — a burst of
      // dozens of calls that read as "slow loading". 30s matches the
      // backend cache TTLs; screens that need faster data set their own.
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster position="bottom-right" theme={theme} richColors closeButton />;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found in DOM — check index.html");

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <App />
        <ThemedToaster />
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
