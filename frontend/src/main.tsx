// Apply saved theme + accent colour before first render to avoid a flash
try {
  const theme = localStorage.getItem("mc_theme");
  if (theme === "light") document.documentElement.setAttribute("data-theme", "light");
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
      // Exponential back-off: 1 s, then max 10 s — avoids hammering a struggling server.
      retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 10_000),
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
