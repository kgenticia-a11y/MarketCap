import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAlerts, deleteAlert } from "../api/alerts";
import type { Alert } from "../api/alerts";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";
import { Bell, Trash2, Plus, TrendingUp, TrendingDown } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";
import AlertModal from "../components/AlertModal";

/* ── Helpers ──────────────────────────────────────────────────────────── */
function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function fmtMoney(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── Alert row ────────────────────────────────────────────────────────── */
function AlertRow({ alert }: { alert: Alert }) {
  const qc = useQueryClient();
  const triggered = alert.triggered_at != null;
  const isAbove = alert.condition === "above";

  const del = useMutation({
    mutationFn: () => deleteAlert(alert.id),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ["alerts"] });
      const prev = qc.getQueryData<Alert[]>(["alerts"]) ?? [];
      qc.setQueryData(["alerts"], prev.filter(a => a.id !== alert.id));
      return { prev };
    },
    onSuccess: () => toast.success(`Alert for ${alert.ticker} deleted`),
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["alerts"], ctx.prev);
      toast.error("Failed to delete alert");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors group">
      <td className="py-3 px-5">
        <Link to={`/stock/${alert.ticker}`} className="font-semibold text-white hover:text-accent-light transition-colors text-sm">
          {alert.ticker}
        </Link>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1.5 text-sm text-white">
          {isAbove ? <TrendingUp size={13} className="text-positive" /> : <TrendingDown size={13} className="text-negative" />}
          {isAbove ? "Price Above" : "Price Below"}
        </div>
      </td>
      <td className="py-3 px-4 text-right text-sm text-white">${fmtMoney(alert.target_price)}</td>
      <td className="py-3 px-4">
        {triggered ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2.5 py-1">
            Triggered
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-semibold bg-positive/10 text-positive border border-positive/20 rounded-full px-2.5 py-1">
            Active
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-sm text-muted">{fmtDate(alert.created_at)}</td>
      <td className="py-3 px-4 text-sm text-muted">
        {triggered && alert.triggered_at ? fmtDate(alert.triggered_at) : "—"}
      </td>
      <td className="py-3 px-5 text-right">
        <button
          onClick={() => del.mutate()}
          disabled={del.isPending}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted hover:text-negative"
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────── */
export default function Alerts() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: getAlerts,
    enabled: !!user,
  });

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <Bell size={40} className="text-muted mb-3" />
        <p className="text-sm text-muted">
          <Link to="/login" className="text-accent-light hover:text-accent">Sign in</Link> to manage your alerts.
        </p>
      </div>
    );
  }

  const alerts: Alert[] = data ?? [];

  if (isLoading) {
    return (
      <div className="p-6 space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-surface rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-6">
      {showModal && <AlertModal onClose={() => setShowModal(false)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold text-white">Alerts</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-accent hover:bg-accent/90 text-white rounded-xl px-4 py-2 text-sm font-semibold transition-colors"
        >
          <Plus size={15} /> New Alert
        </button>
      </div>

      {alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <Bell size={40} className="text-muted mb-3" />
          <p className="text-sm text-muted max-w-xs">
            No alerts set. Add your first alert to stay informed without watching the market.
          </p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              {alerts.length} Alert{alerts.length !== 1 ? "s" : ""}
            </span>
            <span className="text-[10px] text-muted">
              {alerts.filter(a => !a.triggered_at).length} active
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="py-3 px-5 text-left text-muted font-medium">Ticker</th>
                <th className="py-3 px-4 text-left text-muted font-medium">Type</th>
                <th className="py-3 px-4 text-right text-muted font-medium">Threshold</th>
                <th className="py-3 px-4 text-left text-muted font-medium">Status</th>
                <th className="py-3 px-4 text-left text-muted font-medium">Created</th>
                <th className="py-3 px-4 text-left text-muted font-medium">Triggered</th>
                <th className="py-3 px-5 text-right text-muted font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(alert => <AlertRow key={alert.id} alert={alert} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
