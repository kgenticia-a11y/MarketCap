import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  addDcfScenario,
  updateDcfScenario,
  type DcfScenario,
  type DcfScenarioInput,
} from "../api/memos";
import type { Fundamentals } from "../api/stocks";
import { fmtBig, fmtPrice } from "../utils/memo";
import { Save } from "lucide-react";
import { clsx } from "clsx";
import { toast } from "sonner";

/* ── DCF math ────────────────────────────────────────────────────────────── */

interface DcfRow {
  year: number;
  revenue: number;
  fcf: number;
  pv: number;
  cumPv: number;
}

interface DcfResult {
  rows: DcfRow[];
  pvFcf: number;
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  fairValuePerShare: number;
  tvPct: number;
  error?: string;
}

function computeDcf(
  baseRevenue: number,
  revenueGrowthPct: number,
  operatingMarginPct: number,
  taxRatePct: number,
  discountRatePct: number,
  terminalGrowthPct: number,
  projectionYears: number,
  sharesOutstanding: number,
): DcfResult {
  const g = revenueGrowthPct / 100;
  const margin = operatingMarginPct / 100;
  const tax = taxRatePct / 100;
  const wacc = discountRatePct / 100;
  const tgr = terminalGrowthPct / 100;

  if (wacc <= tgr) {
    return {
      rows: [],
      pvFcf: 0,
      terminalValue: 0,
      pvTerminal: 0,
      enterpriseValue: 0,
      fairValuePerShare: 0,
      tvPct: 0,
      error: "Discount rate must exceed terminal growth rate.",
    };
  }

  const rows: DcfRow[] = [];
  let cumPv = 0;
  let lastFcf = 0;

  for (let t = 1; t <= projectionYears; t++) {
    const revenue = baseRevenue * Math.pow(1 + g, t);
    const fcf = revenue * margin * (1 - tax);
    const pv = fcf / Math.pow(1 + wacc, t);
    cumPv += pv;
    lastFcf = fcf;
    rows.push({ year: t, revenue, fcf, pv, cumPv });
  }

  const terminalFcf = lastFcf * (1 + tgr);
  const terminalValue = terminalFcf / (wacc - tgr);
  const pvTerminal = terminalValue / Math.pow(1 + wacc, projectionYears);
  const enterpriseValue = cumPv + pvTerminal;
  const fairValuePerShare = sharesOutstanding > 0 ? enterpriseValue / sharesOutstanding : 0;
  const tvPct = enterpriseValue > 0 ? (pvTerminal / enterpriseValue) * 100 : 0;

  return { rows, pvFcf: cumPv, terminalValue, pvTerminal, enterpriseValue, fairValuePerShare, tvPct };
}

/* ── Slider + number input combo ─────────────────────────────────────────── */

function SliderInput({
  label,
  value,
  min,
  max,
  step,
  suffix = "%",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-xs text-muted">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
            }}
            className="w-16 bg-surface border border-border rounded-lg px-2 py-0.5 text-xs text-white text-right outline-none focus:border-accent transition-colors"
          />
          <span className="text-xs text-muted">{suffix}</span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full accent-[var(--color-accent)] cursor-pointer"
      />
    </div>
  );
}

/* ── Scenario form state ─────────────────────────────────────────────────── */

interface ScenarioForm {
  revenue_growth_pct: number;
  operating_margin_pct: number;
  tax_rate_pct: number;
  discount_rate_pct: number;
  terminal_growth_pct: number;
  projection_years: number;
}

const SCENARIO_TABS = ["base", "bull", "bear"] as const;
type ScenarioName = (typeof SCENARIO_TABS)[number];

const DEFAULTS: Record<ScenarioName, ScenarioForm> = {
  base: {
    revenue_growth_pct: 10,
    operating_margin_pct: 15,
    tax_rate_pct: 21,
    discount_rate_pct: 10,
    terminal_growth_pct: 3,
    projection_years: 5,
  },
  bull: {
    revenue_growth_pct: 20,
    operating_margin_pct: 22,
    tax_rate_pct: 21,
    discount_rate_pct: 9,
    terminal_growth_pct: 4,
    projection_years: 10,
  },
  bear: {
    revenue_growth_pct: 4,
    operating_margin_pct: 10,
    tax_rate_pct: 21,
    discount_rate_pct: 12,
    terminal_growth_pct: 2,
    projection_years: 5,
  },
};

function initForm(
  scenarioName: ScenarioName,
  saved: DcfScenario | undefined,
  fundamentals: Fundamentals | undefined,
): ScenarioForm {
  if (saved) {
    return {
      revenue_growth_pct: saved.revenue_growth_pct,
      operating_margin_pct: saved.operating_margin_pct,
      tax_rate_pct: saved.tax_rate_pct,
      discount_rate_pct: saved.discount_rate_pct,
      terminal_growth_pct: saved.terminal_growth_pct,
      projection_years: saved.projection_years,
    };
  }
  const d = { ...DEFAULTS[scenarioName] };
  if (fundamentals && scenarioName === "base") {
    if (fundamentals.revenue_growth_pct != null) d.revenue_growth_pct = parseFloat(fundamentals.revenue_growth_pct.toFixed(1));
    if (fundamentals.operating_margin_pct != null) d.operating_margin_pct = parseFloat(fundamentals.operating_margin_pct.toFixed(1));
  }
  return d;
}

/* ── Main component ──────────────────────────────────────────────────────── */

interface Props {
  memoId: number;
  currentPrice: number | null;
  fundamentals: Fundamentals | undefined;
  initialScenarios: DcfScenario[];
}

export default function DcfCalculator({ memoId, currentPrice, fundamentals, initialScenarios }: Props) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<ScenarioName>("base");

  const findSaved = (name: ScenarioName) => initialScenarios.find((s) => s.scenario_name === name);

  const [forms, setForms] = useState<Record<ScenarioName, ScenarioForm>>({
    base: initForm("base", findSaved("base"), fundamentals),
    bull: initForm("bull", findSaved("bull"), fundamentals),
    bear: initForm("bear", findSaved("bear"), fundamentals),
  });

  // Track scenario IDs returned from the server so we know whether to POST or PATCH.
  const [savedIds, setSavedIds] = useState<Partial<Record<ScenarioName, number>>>(() => {
    const m: Partial<Record<ScenarioName, number>> = {};
    for (const s of initialScenarios) {
      if (SCENARIO_TABS.includes(s.scenario_name as ScenarioName)) {
        m[s.scenario_name as ScenarioName] = s.id;
      }
    }
    return m;
  });

  const saveMut = useMutation({
    mutationFn: async ({ name, form, fairValue }: { name: ScenarioName; form: ScenarioForm; fairValue: number }) => {
      const body: DcfScenarioInput = {
        scenario_name: name,
        ...form,
        fair_value_per_share: fairValue > 0 ? fairValue : null,
      };
      const existingId = savedIds[name];
      if (existingId) {
        return updateDcfScenario(existingId, body);
      }
      return addDcfScenario(memoId, body);
    },
    onSuccess: (scenario, { name }) => {
      setSavedIds((prev) => ({ ...prev, [name]: scenario.id }));
      qc.invalidateQueries({ queryKey: ["memo", memoId] });
      toast.success(`${name.charAt(0).toUpperCase() + name.slice(1)} scenario saved`);
    },
    onError: () => toast.error("Failed to save scenario"),
  });

  const form = forms[activeTab];

  const setField = <K extends keyof ScenarioForm>(key: K, value: ScenarioForm[K]) => {
    setForms((prev) => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], [key]: value },
    }));
  };

  const baseRevenue = fundamentals?.total_revenue ?? null;
  const shares = fundamentals?.shares_outstanding ?? null;

  const result =
    baseRevenue != null && baseRevenue > 0 && shares != null && shares > 0
      ? computeDcf(
          baseRevenue,
          form.revenue_growth_pct,
          form.operating_margin_pct,
          form.tax_rate_pct,
          form.discount_rate_pct,
          form.terminal_growth_pct,
          form.projection_years,
          shares,
        )
      : null;

  const fv = result?.fairValuePerShare ?? null;
  const upside =
    fv != null && currentPrice != null && currentPrice > 0
      ? ((fv - currentPrice) / currentPrice) * 100
      : null;

  return (
    <div className="mt-5 space-y-4">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">DCF calculator</p>

      {/* Scenario tabs */}
      <div className="flex items-center gap-1">
        {SCENARIO_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={clsx(
              "px-4 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors",
              activeTab === tab
                ? "bg-accent/15 text-accent-light"
                : "text-muted hover:text-white hover:bg-surface-hover",
            )}
          >
            {tab}
            {savedIds[tab] && <span className="ml-1 text-[10px] text-positive">✓</span>}
          </button>
        ))}
      </div>

      {baseRevenue == null || shares == null ? (
        <p className="text-xs text-muted py-4">
          Revenue and shares data unavailable — the DCF model will populate once market data loads.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Inputs */}
          <div className="space-y-4">
            <div>
              <p className="text-[11px] text-muted mb-0.5">Base revenue</p>
              <p className="text-sm font-semibold text-white">{fmtBig(baseRevenue)}</p>
            </div>

            <SliderInput
              label="Revenue growth (annual)"
              value={form.revenue_growth_pct}
              min={-20}
              max={80}
              step={0.5}
              onChange={(v) => setField("revenue_growth_pct", v)}
            />
            <SliderInput
              label="Operating margin"
              value={form.operating_margin_pct}
              min={-50}
              max={80}
              step={0.5}
              onChange={(v) => setField("operating_margin_pct", v)}
            />
            <SliderInput
              label="Tax rate"
              value={form.tax_rate_pct}
              min={0}
              max={60}
              step={0.5}
              onChange={(v) => setField("tax_rate_pct", v)}
            />
            <SliderInput
              label="Discount rate (WACC)"
              value={form.discount_rate_pct}
              min={5}
              max={30}
              step={0.1}
              onChange={(v) => setField("discount_rate_pct", v)}
            />
            <SliderInput
              label="Terminal growth rate"
              value={form.terminal_growth_pct}
              min={-2}
              max={8}
              step={0.1}
              onChange={(v) => setField("terminal_growth_pct", v)}
            />

            <div>
              <label className="block text-xs text-muted mb-1">Projection years</label>
              <select
                value={form.projection_years}
                onChange={(e) => setField("projection_years", parseInt(e.target.value, 10))}
                className="bg-surface border border-border rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-accent transition-colors"
              >
                {[5, 7, 10].map((y) => (
                  <option key={y} value={y}>{y} years</option>
                ))}
              </select>
            </div>

            <button
              onClick={() =>
                saveMut.mutate({
                  name: activeTab,
                  form,
                  fairValue: result?.fairValuePerShare ?? 0,
                })
              }
              disabled={saveMut.isPending || !!result?.error}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-accent hover:bg-accent/90 disabled:opacity-40 text-white transition-all shadow-lg shadow-accent/20"
            >
              <Save size={14} />
              {saveMut.isPending ? "Saving…" : `Save ${activeTab} scenario`}
            </button>
          </div>

          {/* Output */}
          <div className="space-y-4">
            {result?.error ? (
              <div className="px-4 py-3 rounded-xl bg-negative/10 border border-negative/30 text-xs text-negative">
                {result.error}
              </div>
            ) : result ? (
              <>
                {/* Fair value highlight */}
                <div className="bg-surface-raised rounded-xl border border-border p-4">
                  <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Fair value / share</p>
                  <p className="text-3xl font-bold text-white">{fmtPrice(fv)}</p>
                  {upside != null && (
                    <p className={clsx("text-sm font-medium mt-0.5", upside >= 0 ? "text-positive" : "text-negative")}>
                      {upside >= 0 ? "+" : ""}{upside.toFixed(1)}% vs current {fmtPrice(currentPrice)}
                    </p>
                  )}
                  <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-muted">Enterprise value</p>
                      <p className="text-white font-medium">{fmtBig(result.enterpriseValue)}</p>
                    </div>
                    <div>
                      <p className="text-muted">Terminal % of EV</p>
                      <p className="text-white font-medium">{result.tvPct.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-muted">PV of FCFs</p>
                      <p className="text-white font-medium">{fmtBig(result.pvFcf)}</p>
                    </div>
                    <div>
                      <p className="text-muted">PV of terminal</p>
                      <p className="text-white font-medium">{fmtBig(result.pvTerminal)}</p>
                    </div>
                  </div>
                </div>

                {/* FCF projection table */}
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-surface-raised">
                        <th className="px-3 py-2 text-[10px] font-semibold text-muted uppercase tracking-widest">Yr</th>
                        <th className="px-3 py-2 text-[10px] font-semibold text-muted uppercase tracking-widest text-right">Revenue</th>
                        <th className="px-3 py-2 text-[10px] font-semibold text-muted uppercase tracking-widest text-right">FCF</th>
                        <th className="px-3 py-2 text-[10px] font-semibold text-muted uppercase tracking-widest text-right">PV(FCF)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row) => (
                        <tr key={row.year} className="border-b border-border/50 last:border-0">
                          <td className="px-3 py-2 text-muted">{row.year}</td>
                          <td className="px-3 py-2 text-right text-white">{fmtBig(row.revenue)}</td>
                          <td className="px-3 py-2 text-right text-white">{fmtBig(row.fcf)}</td>
                          <td className="px-3 py-2 text-right text-white">{fmtBig(row.pv)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-border bg-surface-raised/60">
                        <td className="px-3 py-2 text-muted italic text-[11px]">TV</td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 text-right text-[11px] text-muted">{fmtBig(result.terminalValue)}</td>
                        <td className="px-3 py-2 text-right text-[11px] font-medium text-white">{fmtBig(result.pvTerminal)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
