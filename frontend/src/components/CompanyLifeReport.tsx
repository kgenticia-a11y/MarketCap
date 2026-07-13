import {
  Landmark, LineChart as LineChartIcon, Scale, Droplets, Award,
  HeartPulse, BookOpenText, CheckCircle2, XCircle, MinusCircle, Lightbulb,
} from "lucide-react";
import { clsx } from "clsx";
import {
  AreaChart, Area, BarChart, Bar, ComposedChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

/* eslint-disable @typescript-eslint/no-explicit-any */

const fmtMoney = (v: number | null | undefined) => {
  if (v == null) return "N/A";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  return `${sign}$${a.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

const chartTooltipStyle = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-accent shrink-0" />
        <h3 className="text-xs font-semibold text-muted uppercase tracking-widest">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Insights({ lines }: { lines?: string[] }) {
  if (!lines?.length) return null;
  return (
    <ul className="space-y-2">
      {lines.map((line, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-muted leading-relaxed">
          <Lightbulb size={13} className="text-accent shrink-0 mt-1" />
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className="bg-surface-raised rounded-lg border border-border p-3">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">{label}</p>
      <p className={clsx("text-sm font-semibold", tone === "pos" ? "text-positive" : tone === "neg" ? "text-negative" : "text-white")}>
        {value ?? "N/A"}
      </p>
    </div>
  );
}

const PHASE_COLORS: Record<string, string> = {
  Hypergrowth: "bg-positive/20 text-positive",
  "Rapid growth": "bg-accent/20 text-accent-light",
  "Steady growth": "bg-blue-500/20 text-blue-300",
  Plateau: "bg-yellow-500/20 text-yellow-300",
  Decline: "bg-negative/20 text-negative",
};

export default function CompanyLifeReport({ report }: { report: any }) {
  const p = report.profile || {};
  const s = report.series || {};
  const ins = report.insights || {};
  const story = report.price_story;
  const piotroski = report.scores?.piotroski;
  const altman = report.scores?.altman;

  // Merge net income + net margin into one dataset for the composed chart
  const marginByYear: Record<number, number | null> = {};
  for (const r of report.ratios_by_year || []) marginByYear[r.year] = r.net_margin;
  const profitData = (s.net_income || []).map((pt: any) => ({
    year: pt.year, net_income: pt.value, net_margin: marginByYear[pt.year] ?? null,
  }));

  const bsByYear: Record<number, any> = {};
  for (const pt of s.assets || []) bsByYear[pt.year] = { year: pt.year, assets: pt.value };
  for (const pt of s.liabilities || []) (bsByYear[pt.year] ||= { year: pt.year }).liabilities = pt.value;
  for (const pt of s.equity || []) (bsByYear[pt.year] ||= { year: pt.year }).equity = pt.value;
  const bsData = Object.values(bsByYear).sort((a: any, b: any) => a.year - b.year);

  const cfByYear: Record<number, any> = {};
  for (const pt of s.ocf || []) cfByYear[pt.year] = { year: pt.year, ocf: pt.value };
  for (const pt of s.net_income || []) (cfByYear[pt.year] ||= { year: pt.year }).net_income = pt.value;
  for (const pt of s.fcf || []) (cfByYear[pt.year] ||= { year: pt.year }).fcf = pt.value;
  const cfData = Object.values(cfByYear).sort((a: any, b: any) => a.year - b.year);

  return (
    <div className="space-y-4">
      {/* Header / company life facts */}
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold text-white">{p.name}</h2>
          <span className="text-sm text-muted">({report.ticker})</span>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-accent/15 text-accent-light">
            Document Analysis — No AI
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Tile label="SEC Registrant Since" value={p.first_filing_date?.slice(0, 4)} />
          <Tile label="Annual Reports (10-K)" value={p.form_counts?.["10-K"]} />
          <Tile label="Quarterly Reports (10-Q)" value={p.form_counts?.["10-Q"]} />
          <Tile label="Years of Financials" value={s.revenue?.length || s.net_income?.length} />
        </div>
        <Insights lines={ins.timeline} />
      </div>

      {/* Executive synthesis */}
      {ins.summary?.length > 0 && (
        <Section icon={BookOpenText} title="Executive Synthesis">
          <Insights lines={ins.summary} />
        </Section>
      )}

      {/* Revenue through the company's life */}
      {s.revenue?.length > 0 && (
        <Section icon={LineChartIcon} title="Revenue — The Whole Life">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={s.revenue}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={70} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [fmtMoney(Number(v)), "Revenue"]} />
                <Bar dataKey="value" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {report.phases?.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {report.phases.map((ph: any, i: number) => (
                <span key={i} className={clsx("px-2.5 py-1 rounded-full text-[11px] font-medium", PHASE_COLORS[ph.label] || "bg-surface-hover text-muted")}>
                  {ph.label} FY{ph.start_year}–{ph.end_year} ({ph.avg_growth_pct > 0 ? "+" : ""}{ph.avg_growth_pct}%/yr)
                </span>
              ))}
            </div>
          )}
          <Insights lines={ins.revenue} />
        </Section>
      )}

      {/* Profitability evolution */}
      {profitData.length > 0 && (
        <Section icon={Award} title="Profitability Evolution">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={profitData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="ni" tickFormatter={(v) => fmtMoney(v)} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={70} />
                <YAxis yAxisId="margin" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => name === "Net margin" ? [`${Number(v).toFixed(1)}%`, name] : [fmtMoney(Number(v)), name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="ni" dataKey="net_income" name="Net income" radius={[3, 3, 0, 0]}>
                  {/* recharts colors cells via fill on Bar; negative years shown in red via Cell would need mapping — keep single tone */}
                </Bar>
                <Line yAxisId="margin" type="monotone" dataKey="net_margin" name="Net margin" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <Insights lines={ins.profitability} />
        </Section>
      )}

      {/* Balance sheet evolution */}
      {bsData.length > 0 && (
        <Section icon={Scale} title="Balance Sheet Evolution">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={bsData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={70} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [fmtMoney(Number(v)), name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="assets" name="Total assets" stroke="var(--color-accent)" fill="var(--color-accent)" fillOpacity={0.15} strokeWidth={1.5} />
                <Area type="monotone" dataKey="liabilities" name="Total liabilities" stroke="#ef4444" fill="#ef4444" fillOpacity={0.1} strokeWidth={1.5} />
                <Area type="monotone" dataKey="equity" name="Shareholders' equity" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <Insights lines={ins.balance_sheet} />
        </Section>
      )}

      {/* Cash flow quality */}
      {cfData.length > 0 && (
        <Section icon={Droplets} title="Cash Flow Quality">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cfData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={70} />
                <Tooltip contentStyle={chartTooltipStyle} formatter={(v, name) => [fmtMoney(Number(v)), name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="net_income" name="Net income" fill="#64748b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="ocf" name="Operating cash flow" fill="var(--color-accent)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="fcf" name="Free cash flow" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Insights lines={ins.cash_flow} />
        </Section>
      )}

      {/* Shareholder returns */}
      {report.price_bars?.length > 0 && (
        <Section icon={Landmark} title="Shareholder Returns — Since Listing">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={report.price_bars}>
                <defs>
                  <linearGradient id="lifeGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="d" tickFormatter={(d) => d.slice(0, 4)} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} minTickGap={50} />
                <YAxis scale="log" domain={["auto", "auto"]} tickFormatter={(v) => `$${Number(v) >= 100 ? Number(v).toFixed(0) : Number(v).toFixed(1)}`} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} width={55} />
                <Tooltip contentStyle={chartTooltipStyle} labelFormatter={(d) => d} formatter={(v) => [`$${Number(v).toFixed(2)}`, "Close"]} />
                <Area type="monotone" dataKey="c" stroke="var(--color-accent)" fill="url(#lifeGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[10px] text-muted/60 -mt-2">Log scale — equal vertical distances represent equal percentage moves.</p>
          {story && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tile label="Total Return" value={story.total_return_pct != null ? `${story.total_return_pct > 0 ? "+" : ""}${story.total_return_pct.toLocaleString()}%` : "N/A"} tone={story.total_return_pct > 0 ? "pos" : "neg"} />
              <Tile label="CAGR" value={story.cagr_pct != null ? `${story.cagr_pct > 0 ? "+" : ""}${story.cagr_pct}%/yr` : "N/A"} tone={story.cagr_pct > 0 ? "pos" : "neg"} />
              <Tile label="Max Drawdown" value={story.max_drawdown ? `${story.max_drawdown.pct}%` : "N/A"} tone="neg" />
              <Tile label="All-Time High" value={story.all_time_high ? `$${story.all_time_high.price.toLocaleString()} (${story.all_time_high.date.slice(0, 7)})` : "N/A"} />
            </div>
          )}
          <Insights lines={ins.shareholder_returns} />
        </Section>
      )}

      {/* Financial health scores */}
      {(piotroski || altman) && (
        <Section icon={HeartPulse} title="Financial Health Scores">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {piotroski && (
              <div className="bg-surface-raised rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white">{piotroski.score}<span className="text-sm text-muted">/9</span></span>
                  <span className="text-xs text-muted">Piotroski F-Score (FY{piotroski.fiscal_year})</span>
                </div>
                <ul className="space-y-1.5">
                  {piotroski.checks.map((c: any, i: number) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      {c.pass === true ? <CheckCircle2 size={13} className="text-positive shrink-0 mt-0.5" />
                        : c.pass === false ? <XCircle size={13} className="text-negative shrink-0 mt-0.5" />
                        : <MinusCircle size={13} className="text-muted shrink-0 mt-0.5" />}
                      <span>
                        <span className="text-white">{c.name}</span>
                        <span className="text-muted"> — {c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {altman && (
              <div className="bg-surface-raised rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className={clsx("text-2xl font-bold",
                    altman.zone === "Safe" ? "text-positive" : altman.zone === "Grey" ? "text-yellow-400" : "text-negative")}>
                    {altman.score}
                  </span>
                  <span className="text-xs text-muted">Altman Z-Score (FY{altman.fiscal_year})</span>
                </div>
                <div className="flex gap-1 text-[10px] font-semibold">
                  <span className={clsx("flex-1 text-center py-1.5 rounded-l-md", altman.zone === "Distress" ? "bg-negative text-white" : "bg-surface-hover text-muted")}>Distress &lt;1.81</span>
                  <span className={clsx("flex-1 text-center py-1.5", altman.zone === "Grey" ? "bg-yellow-500 text-black" : "bg-surface-hover text-muted")}>Grey 1.81–2.99</span>
                  <span className={clsx("flex-1 text-center py-1.5 rounded-r-md", altman.zone === "Safe" ? "bg-positive text-black" : "bg-surface-hover text-muted")}>Safe &gt;2.99</span>
                </div>
                {!altman.complete && (
                  <p className="text-[10px] text-muted/70">Computed from available components only — some inputs were not reported.</p>
                )}
              </div>
            )}
          </div>
          <Insights lines={ins.health} />
        </Section>
      )}

      {/* Ratio history table */}
      {report.ratios_by_year?.length > 0 && (
        <Section icon={Scale} title="Ratio History — Every Filed Year">
          <div className="overflow-x-auto">
            <table className="w-full text-xs whitespace-nowrap">
              <thead>
                <tr className="text-muted border-b border-border">
                  <th className="text-left py-2 px-2 font-medium">FY</th>
                  <th className="text-right py-2 px-2 font-medium">Gross %</th>
                  <th className="text-right py-2 px-2 font-medium">Oper. %</th>
                  <th className="text-right py-2 px-2 font-medium">Net %</th>
                  <th className="text-right py-2 px-2 font-medium">ROE %</th>
                  <th className="text-right py-2 px-2 font-medium">ROA %</th>
                  <th className="text-right py-2 px-2 font-medium">Liab/Eq</th>
                  <th className="text-right py-2 px-2 font-medium">Curr. Ratio</th>
                  <th className="text-right py-2 px-2 font-medium">OCF/NI</th>
                </tr>
              </thead>
              <tbody>
                {report.ratios_by_year.map((r: any) => (
                  <tr key={r.year} className="border-b border-border/40">
                    <td className="py-1.5 px-2 text-white font-medium">{r.year}</td>
                    {["gross_margin", "operating_margin", "net_margin", "roe", "roa", "debt_to_equity", "current_ratio", "ocf_to_ni"].map((k) => (
                      <td key={k} className="py-1.5 px-2 text-right text-muted">{r[k] ?? "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Methodology footer */}
      <div className="bg-surface rounded-xl border border-border p-4 space-y-1">
        <p className="text-xs text-muted">{report.methodology}</p>
        <p className="text-xs text-muted/60">
          Sources: {(report.sources || []).join(" · ")} | Generated {new Date(report.generated_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
