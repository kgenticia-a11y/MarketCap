import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import {
  User, BarChart2, Bell, Shield, Palette, Download,
  ChevronRight, Check, Pencil, X, Eye, EyeOff, Trash2, Plus,
  Moon, Sun, ExternalLink,
} from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import client from "../api/client";


import { loadPrefs, savePrefs, type Prefs } from "../utils/prefs";

/* ══════════════════════════════════════════════════════════════
   Accent colour presets
══════════════════════════════════════════════════════════════ */
const ACCENTS = [
  { name: "Purple",  base: "124 92 252",  light: "155 125 253", hex: "#7c5cfc" },
  { name: "Blue",    base: "59 130 246",  light: "96 165 250",  hex: "#3b82f6" },
  { name: "Cyan",    base: "6 182 212",   light: "34 211 238",  hex: "#06b6d4" },
  { name: "Green",   base: "16 185 129",  light: "52 211 153",  hex: "#10b981" },
  { name: "Orange",  base: "249 115 22",  light: "251 146 60",  hex: "#f97316" },
  { name: "Pink",    base: "236 72 153",  light: "244 114 182", hex: "#ec4899" },
];

function applyAccent(a: { base: string; light: string }) {
  document.documentElement.style.setProperty("--accent",       a.base);
  document.documentElement.style.setProperty("--accent-light", a.light);
  localStorage.setItem("mc_accent", JSON.stringify(a));
}

function currentAccentHex(): string {
  try {
    const saved = localStorage.getItem("mc_accent");
    if (!saved) return "#7c5cfc";
    const { base } = JSON.parse(saved);
    const [r, g, b] = base.split(" ").map(Number);
    return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
  } catch { return "#7c5cfc"; }
}

/* ══════════════════════════════════════════════════════════════
   Reusable layout components
══════════════════════════════════════════════════════════════ */
function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-surface-hover/30">
        <span className="text-muted">{icon}</span>
        <h3 className="text-xs font-semibold text-white uppercase tracking-widest">{title}</h3>
      </div>
      <div className="divide-y divide-border/50">{children}</div>
    </div>
  );
}

function Row({ label, sub, children, full }: { label: string; sub?: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={clsx("px-5 py-3.5 gap-4", full ? "space-y-3" : "flex items-center justify-between")}>
      <div>
        <div className="text-sm text-white">{label}</div>
        {sub && <div className="text-xs text-muted mt-0.5">{sub}</div>}
      </div>
      <div className={full ? "" : "shrink-0"}>{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} style={{ height: 22 }}
      className={clsx("relative w-10 rounded-full transition-colors duration-200", value ? "bg-accent" : "bg-border")}
    >
      <span className={clsx("absolute top-0.5 w-4 h-4 bg-[#ffffff] rounded-full shadow transition-transform duration-200",
        value ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

function Pill({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)}
          className={clsx("px-2.5 py-1 rounded-lg text-xs font-medium transition-colors",
            value === o ? "bg-accent text-white" : "bg-surface-hover text-muted hover:text-white")}
        >{o}</button>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Profile section
══════════════════════════════════════════════════════════════ */
function ProfileSection() {
  const { user, refreshUser } = useAuth();
  const [editingName, setEditingName] = useState(false);
  const [nameVal,     setNameVal]     = useState(user?.name ?? "");
  const [showPwForm,  setShowPwForm]  = useState(false);
  const [currentPw,   setCurrentPw]  = useState("");
  const [newPw,       setNewPw]       = useState("");
  const [showPw,      setShowPw]      = useState(false);
  const [pwMsg,       setPwMsg]       = useState<{ ok: boolean; text: string } | null>(null);

  const nameMut = useMutation({
    mutationFn: (name: string) => client.patch("/auth/profile", { name }).then(r => r.data),
    onSuccess:  async () => { await refreshUser(); setEditingName(false); toast.success("Name updated"); },
    onError:    () => toast.error("Failed to update name"),
  });

  const pwMut = useMutation({
    mutationFn: () => client.patch("/auth/password", { current_password: currentPw, new_password: newPw }),
    onSuccess:  () => { setPwMsg({ ok: true, text: "Password updated!" }); setCurrentPw(""); setNewPw(""); setShowPwForm(false); },
    onError:    (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Failed to update password";
      setPwMsg({ ok: false, text: msg });
    },
  });

  if (!user) {
    return (
      <Section icon={<User size={13} />} title="Account">
        <Row label="Sign in to manage your account" sub="">
          <Link to="/login" className="text-xs text-accent-light hover:text-accent flex items-center gap-1">
            Sign in <ChevronRight size={12} />
          </Link>
        </Row>
      </Section>
    );
  }

  const memberSince = (() => {
    try { return format(parseISO(user.created_at), "MMM d, yyyy"); } catch { return "—"; }
  })();

  return (
    <Section icon={<User size={13} />} title="Account">
      {/* Display name */}
      <div className="px-5 py-3.5 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-white">Display Name</div>
          <div className="text-xs text-muted mt-0.5">Shown in the sidebar</div>
        </div>
        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") nameMut.mutate(nameVal); if (e.key === "Escape") setEditingName(false); }}
              placeholder="Your name"
              className="bg-surface-raised border border-border rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-accent w-36 transition-colors"
            />
            <button onClick={() => nameMut.mutate(nameVal)} disabled={nameMut.isPending}
              className="p-1.5 rounded-lg bg-accent/20 text-accent-light hover:bg-accent/30 transition-colors">
              <Check size={13} />
            </button>
            <button onClick={() => setEditingName(false)} className="p-1.5 rounded-lg text-muted hover:text-white transition-colors">
              <X size={13} />
            </button>
          </div>
        ) : (
          <button onClick={() => { setNameVal(user.name ?? ""); setEditingName(true); }}
            className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors group">
            <span>{user.name || <span className="italic text-muted/60">Not set</span>}</span>
            <Pencil size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        )}
      </div>

      {/* Email */}
      <Row label="Email" sub="Your login email">
        <span className="text-sm text-muted">{user.email}</span>
      </Row>

      {/* Member since */}
      <Row label="Member since" sub="">
        <span className="text-sm text-muted">{memberSince}</span>
      </Row>

      {/* Change password */}
      <div className="px-5 py-3.5">
        <button onClick={() => setShowPwForm(v => !v)}
          className="flex items-center gap-2 text-sm text-muted hover:text-white transition-colors w-full justify-between">
          <span>Change Password</span>
          <ChevronRight size={13} className={clsx("transition-transform", showPwForm && "rotate-90")} />
        </button>
        {showPwForm && (
          <div className="mt-3 space-y-2">
            <div className="relative">
              <input type={showPw ? "text" : "password"} placeholder="Current password" value={currentPw}
                onChange={e => setCurrentPw(e.target.value)}
                className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted outline-none focus:border-accent transition-colors pr-9" />
              <button onClick={() => setShowPw(v => !v)} className="absolute right-2.5 top-2.5 text-muted hover:text-white">
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <input type={showPw ? "text" : "password"} placeholder="New password (min 8 chars)" value={newPw}
              onChange={e => setNewPw(e.target.value)}
              className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted outline-none focus:border-accent transition-colors" />
            {pwMsg && (
              <p className={clsx("text-xs", pwMsg.ok ? "text-positive" : "text-negative")}>{pwMsg.text}</p>
            )}
            <button onClick={() => pwMut.mutate()} disabled={!currentPw || newPw.length < 8 || pwMut.isPending}
              className="w-full py-2 rounded-lg bg-accent hover:bg-accent/90 disabled:opacity-40 text-white text-sm font-medium transition-all">
              {pwMut.isPending ? "Updating…" : "Update Password"}
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════
   Appearance section
══════════════════════════════════════════════════════════════ */
function AppearanceSection() {
  const { theme, toggle } = useTheme();
  const [activeHex, setActiveHex] = useState(currentAccentHex);

  const pick = (a: typeof ACCENTS[0]) => {
    applyAccent(a);
    setActiveHex(a.hex);
  };

  return (
    <Section icon={<Palette size={13} />} title="Appearance">
      <Row label="Interface Mode" sub="Switch between dark and light theme">
        <div className="flex items-center gap-2">
          <Moon size={13} className={clsx("transition-colors", theme === "dark" ? "text-accent" : "text-muted")} />
          <Toggle value={theme === "light"} onChange={toggle} />
          <Sun  size={13} className={clsx("transition-colors", theme === "light" ? "text-accent" : "text-muted")} />
        </div>
      </Row>
      <Row label="Accent Colour" sub="Applied across the whole app instantly">
        <div className="flex gap-2">
          {ACCENTS.map((a) => (
            <button key={a.name} title={a.name} onClick={() => pick(a)}
              style={{ background: a.hex }}
              className={clsx(
                "w-6 h-6 rounded-full transition-all",
                activeHex === a.hex
                  ? "ring-2 ring-offset-2 ring-offset-surface scale-110"
                  : "hover:scale-110 opacity-70 hover:opacity-100"
              )}
              // ring colour matches the swatch
              aria-label={a.name}
            >
              {activeHex === a.hex && (
                <Check size={12} className="text-white mx-auto" />
              )}
            </button>
          ))}
        </div>
      </Row>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════
   Export section
══════════════════════════════════════════════════════════════ */
function ExportSection() {
  const { user } = useAuth();
  const [exporting, setExporting] = useState<string | null>(null);

  const downloadCSV = async (type: "portfolio" | "watchlist") => {
    setExporting(type);
    try {
      if (type === "portfolio") {
        const r = await client.get("/portfolio");
        const items = r.data?.items ?? [];
        const rows = [
          ["Ticker", "Shares", "Avg Buy Price", "Total Cost", "Added At"],
          ...items.map((i: { ticker: string; shares: number; avg_buy_price: number; added_at: string }) => [
            i.ticker, i.shares, i.avg_buy_price,
            (i.shares * i.avg_buy_price).toFixed(2),
            i.added_at ? format(parseISO(i.added_at), "yyyy-MM-dd") : "",
          ]),
        ];
        triggerDownload(rows, "portfolio.csv");
      } else {
        const r = await client.get("/watchlist");
        const items = r.data ?? [];
        const rows = [
          ["Ticker", "Added At"],
          ...items.map((i: { ticker: string; added_at: string }) => [
            i.ticker,
            i.added_at ? format(parseISO(i.added_at), "yyyy-MM-dd") : "",
          ]),
        ];
        triggerDownload(rows, "watchlist.csv");
      }
    } finally {
      setExporting(null);
    }
  };

  function sanitizeCell(v: string | number): string {
    const s = String(v);
    // Prefix with apostrophe if the value could be interpreted as a formula
    if (/^[=\-+@\t\r]/.test(s)) return `'${s}`;
    return s;
  }

  function triggerDownload(rows: (string | number)[][], filename: string) {
    const csv = rows.map(r => r.map(v => `"${sanitizeCell(v)}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  if (!user) {
    return (
      <Section icon={<Download size={13} />} title="Export Data">
        <Row label="Sign in to export your data" sub="">
          <Link to="/login" className="text-xs text-accent-light hover:text-accent flex items-center gap-1">
            Sign in <ChevronRight size={12} />
          </Link>
        </Row>
      </Section>
    );
  }

  return (
    <Section icon={<Download size={13} />} title="Export Data">
      <Row label="Portfolio" sub="Download all holdings as CSV">
        <button onClick={() => downloadCSV("portfolio")} disabled={exporting === "portfolio"}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-hover text-muted hover:text-white hover:bg-border transition-colors disabled:opacity-50">
          <Download size={12} />
          {exporting === "portfolio" ? "Exporting…" : "Download CSV"}
        </button>
      </Row>
      <Row label="Watchlist" sub="Download all watched tickers as CSV">
        <button onClick={() => downloadCSV("watchlist")} disabled={exporting === "watchlist"}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-hover text-muted hover:text-white hover:bg-border transition-colors disabled:opacity-50">
          <Download size={12} />
          {exporting === "watchlist" ? "Exporting…" : "Download CSV"}
        </button>
      </Row>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main Settings page
══════════════════════════════════════════════════════════════ */
export default function Settings() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [saved, setSaved]  = useState(false);
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    savePrefs(prefs);
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(t);
  }, [prefs]);

  const set = <K extends keyof Prefs>(key: K, val: Prefs[K]) =>
    setPrefs(p => ({ ...p, [key]: val }));

  return (
    <div className="p-6 w-full space-y-5">
      <div className={clsx("flex items-center gap-1.5 text-xs text-positive transition-opacity duration-300 h-4",
        saved ? "opacity-100" : "opacity-0")}>
        <Check size={12} /> Preferences saved
      </div>

      <ProfileSection />
      <AppearanceSection />

      {/* Chart Preferences */}
      <Section icon={<BarChart2 size={13} />} title="Chart Preferences">
        <Row label="Default range" sub="Opening range shown on stock pages">
          <Pill options={["1D","5D","1M","6M","1Y","5Y"]} value={prefs.defaultRange}
            onChange={v => set("defaultRange", v)} />
        </Row>
        <Row label="Default chart type" sub="Area chart or Candlestick">
          <Pill options={["area","candle"]} value={prefs.chartType}
            onChange={v => set("chartType", v as "area" | "candle")} />
        </Row>
        <Row label="Compact numbers" sub="Show 1.2M instead of 1,200,000">
          <Toggle value={prefs.compactNumbers} onChange={v => set("compactNumbers", v)} />
        </Row>
      </Section>

      {/* Data & Refresh */}
      <Section icon={<Bell size={13} />} title="Data & Refresh">
        <Row label="Price refresh interval" sub="How often live prices update">
          <Pill options={["15s","30s","60s"]} value={`${prefs.refetchSec}s`}
            onChange={v => set("refetchSec", parseInt(v))} />
        </Row>
      </Section>

      <ConnectedAccountsSection />
      <ExportSection />

      {/* About */}
      <Section icon={<Shield size={13} />} title="About & Legal">
        <Row label="MarketCap" sub="Real-time stock tracker">
          <span className="text-xs text-muted">v1.0</span>
        </Row>
        <Row label="Data source" sub="">
          <span className="text-xs text-muted">Yahoo Finance (yfinance)</span>
        </Row>
        <Row label="Disclaimer" sub="For informational purposes only">
          <span className="text-xs text-muted text-right max-w-[200px]">Not financial advice. Past performance does not guarantee future results.</span>
        </Row>
        <Row label="Terms of Service & Privacy Policy" sub="View our legal terms and data practices">
          <Link to="/terms" target="_blank"
            className="flex items-center gap-1.5 text-xs text-accent-light hover:text-accent transition-colors">
            View <ExternalLink size={11} />
          </Link>
        </Row>
      </Section>

      <DangerZone />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Connected Accounts — multi-account aggregation
══════════════════════════════════════════════════════════════ */
import { listAccounts, createAccount, deleteAccount, type UserAccount, type AccountType } from "../api/accounts";

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "brokerage",  label: "Brokerage" },
  { value: "retirement", label: "Retirement (IRA/401k)" },
  { value: "crypto",     label: "Crypto" },
  { value: "other",      label: "Other" },
];

function ConnectedAccountsSection() {
  const qc = useQueryClient();
  const { data: accounts = [], isLoading } = useQuery<UserAccount[]>({
    queryKey: ["accounts"],
    queryFn: listAccounts,
    staleTime: 5 * 60_000,
  });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("brokerage");

  const createMut = useMutation({
    mutationFn: () => createAccount(name.trim(), type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success(`${name} added`);
      setName(""); setType("brokerage"); setAdding(false);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg ?? "Failed to add account");
    },
  });

  const delMut = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["portfolio"] });
      qc.invalidateQueries({ queryKey: ["portfolio-analytics"] });
      toast.success("Account removed");
    },
  });

  return (
    <Section icon={<BarChart2 size={13} />} title="Connected Accounts">
      <div className="px-4 py-3">
        <p className="text-xs text-muted mb-3 leading-relaxed">
          Tag holdings with the real-world account they belong to (Robinhood, Fidelity, Roth IRA, etc.).
          Switch between accounts on the Portfolio page or view an aggregated total.
        </p>

        {isLoading ? (
          <div className="h-10 bg-surface-hover rounded-lg animate-pulse" />
        ) : (
          <div className="space-y-2 mb-3">
            {accounts.length === 0 && (
              <p className="text-xs text-muted italic">No accounts yet — add one below.</p>
            )}
            {accounts.map(a => (
              <div key={a.id} className="flex items-center justify-between bg-surface-hover rounded-lg px-3 py-2">
                <div>
                  <div className="text-sm font-semibold text-white">{a.name}</div>
                  <div className="text-[10px] text-muted capitalize">{a.type}</div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Remove account "${a.name}"? Holdings tagged to it will become unassigned.`)) {
                      delMut.mutate(a.id);
                    }
                  }}
                  disabled={delMut.isPending}
                  className="text-muted hover:text-negative transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {adding ? (
          <div className="bg-surface-hover rounded-lg p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="Account name (e.g., Robinhood)"
                className="bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-white placeholder-muted focus:outline-none focus:border-accent" />
              <select
                value={type} onChange={e => setType(e.target.value as AccountType)}
                className="bg-surface border border-border rounded-md px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-accent">
                {ACCOUNT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { if (!name.trim()) return toast.error("Enter an account name"); createMut.mutate(); }}
                disabled={createMut.isPending}
                className="bg-accent hover:bg-accent/90 disabled:opacity-50 text-white rounded-md px-3 py-1.5 text-xs font-semibold transition-colors">
                {createMut.isPending ? "Adding…" : "Add"}
              </button>
              <button onClick={() => { setAdding(false); setName(""); }}
                className="text-xs text-muted hover:text-white transition-colors px-2">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs text-accent-light hover:text-accent transition-colors">
            <Plus size={12} /> Add Account
          </button>
        )}
      </div>
    </Section>
  );
}

/* ══════════════════════════════════════════════════════════════
   Danger Zone — account deletion
══════════════════════════════════════════════════════════════ */
function DangerZone() {
  const { user, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [input,      setInput]      = useState("");
  const [deleting,   setDeleting]   = useState(false);

  if (!user) return null;

  const handleDelete = async () => {
    if (input !== "DELETE") return;
    setDeleting(true);
    try {
      await client.delete("/auth/account");
      logout();
    } catch {
      toast.error("Failed to delete account. Try again.");
      setDeleting(false);
    }
  };

  return (
    <div className="bg-surface rounded-xl border border-negative/30 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-negative/20 bg-negative/5">
        <Trash2 size={13} className="text-negative" />
        <h3 className="text-xs font-semibold text-negative uppercase tracking-widest">Danger Zone</h3>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div>
          <div className="text-sm text-white">Delete Account</div>
          <div className="text-xs text-muted mt-0.5">
            Permanently deletes your account, portfolio, watchlist, and all associated data. This cannot be undone.
          </div>
        </div>
        {!confirming ? (
          <button onClick={() => setConfirming(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-negative/40 text-negative hover:bg-negative/10 transition-colors">
            Delete my account
          </button>
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-muted">
              Type <span className="font-mono font-bold text-white">DELETE</span> to confirm.
            </p>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type DELETE"
              className="w-full bg-surface-raised border border-negative/40 rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted outline-none focus:border-negative transition-colors font-mono"
            />
            <div className="flex gap-2">
              <button onClick={handleDelete}
                disabled={input !== "DELETE" || deleting}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-negative hover:bg-negative/90 disabled:opacity-40 text-white transition-colors">
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
              <button onClick={() => { setConfirming(false); setInput(""); }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-white bg-surface-hover transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
