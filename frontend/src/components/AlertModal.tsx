import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createAlert } from "../api/alerts";
import { X, TrendingUp, TrendingDown, Percent, Activity } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";

const ALERT_TYPES = [
  { value: "above", label: "Price Above", icon: TrendingUp, active: true },
  { value: "below", label: "Price Below", icon: TrendingDown, active: true },
  { value: "pct_up", label: "% Change Up", icon: Percent, active: false },
  { value: "pct_down", label: "% Change Down", icon: Percent, active: false },
  { value: "volume", label: "Volume Spike", icon: Activity, active: false },
] as const;

interface AlertModalProps {
  ticker?: string;
  onClose: () => void;
}

export default function AlertModal({ ticker: initialTicker, onClose }: AlertModalProps) {
  const qc = useQueryClient();
  const [ticker, setTicker] = useState(initialTicker ?? "");
  const [alertType, setAlertType] = useState<"above" | "below">("above");
  const [targetPrice, setTargetPrice] = useState("");
  const [err, setErr] = useState("");

  const mut = useMutation({
    mutationFn: () => createAlert(ticker.trim().toUpperCase(), parseFloat(targetPrice), alertType),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["alerts"] });
      toast.success(`Alert created for ${ticker.toUpperCase()}`);
      onClose();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErr(msg ?? "Failed to create alert.");
    },
  });

  function submit() {
    setErr("");
    if (!ticker.trim()) return setErr("Ticker is required.");
    const p = parseFloat(targetPrice);
    if (!p || p <= 0) return setErr("Price must be a positive number.");
    mut.mutate();
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-white">New Alert</h2>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          {/* Ticker */}
          <div>
            <label className="text-[10px] font-semibold text-muted uppercase tracking-widest block mb-1">
              Ticker
            </label>
            <input
              value={ticker}
              onChange={e => setTicker(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent"
            />
          </div>

          {/* Alert type */}
          <div>
            <label className="text-[10px] font-semibold text-muted uppercase tracking-widest block mb-2">
              Alert Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ALERT_TYPES.map(t => {
                const Icon = t.icon;
                if (t.active) {
                  return (
                    <button
                      key={t.value}
                      onClick={() => setAlertType(t.value as "above" | "below")}
                      className={clsx(
                        "flex items-center gap-2 rounded-lg border py-2 px-3 text-xs font-medium transition-colors",
                        alertType === t.value
                          ? "bg-accent/20 border-accent text-white"
                          : "border-border text-muted hover:text-white hover:border-border/80"
                      )}
                    >
                      <Icon size={13} />
                      {t.label}
                    </button>
                  );
                }
                return (
                  <div
                    key={t.value}
                    title="Coming Soon"
                    className="flex items-center gap-2 rounded-lg border border-border/50 py-2 px-3 text-xs font-medium text-muted/40 cursor-not-allowed relative"
                  >
                    <Icon size={13} />
                    {t.label}
                    <span className="ml-auto text-[9px] bg-border/60 text-muted rounded px-1.5 py-0.5 leading-none">
                      Soon
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Target price */}
          <div>
            <label className="text-[10px] font-semibold text-muted uppercase tracking-widest block mb-1">
              Target Price ($)
            </label>
            <input
              type="number"
              value={targetPrice}
              onChange={e => setTargetPrice(e.target.value)}
              placeholder="150.00"
              className="w-full bg-surface-hover border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-muted focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {err && <p className="text-xs text-negative mt-3">{err}</p>}

        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-muted border border-border hover:border-border/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={mut.isPending}
            className="flex-1 bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
          >
            {mut.isPending ? "Creating..." : "Create Alert"}
          </button>
        </div>
      </div>
    </div>
  );
}
