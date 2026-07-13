import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { searchStocks } from "../api/stocks";
import { getAnalystReport } from "../api/ai";
import {
  Search, X, FileText, Download, TrendingUp, TrendingDown,
  Building2, DollarSign, BarChart3, ShieldCheck, Users, Rocket, AlertTriangle, Server,
} from "lucide-react";
import { clsx } from "clsx";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts";
import { toast } from "sonner";

const TIMESPANS = ["1M", "6M", "1Y", "5Y"] as const;
const DEPTHS = [
  { key: "brief", label: "Executive Brief", pages: "1–3 pages", desc: "Concise summary for quick decisions" },
  { key: "standard", label: "Standard Report", pages: "10–15 pages", desc: "Full institutional-format analysis" },
  { key: "deep", label: "Deep Dive", pages: "35–45 pages", desc: "Comprehensive research with peer comparisons" },
] as const;

interface SearchResult { ticker: string; name: string }

function TickerSearch({ onSelect }: { onSelect: (r: SearchResult) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ["search", q],
    queryFn: () => searchStocks(q),
    enabled: q.length >= 1,
    staleTime: 30_000,
  });

  const results: SearchResult[] = data?.results?.slice(0, 7) ?? [];

  const pick = (r: SearchResult) => {
    onSelect(r);
    setQ("");
    setOpen(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2.5 w-72 focus-within:border-accent transition-colors">
        <Search size={14} className="text-muted shrink-0" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search company or ticker..."
          className="bg-transparent text-sm text-white placeholder-muted outline-none w-full"
        />
        {q && (
          <button onClick={() => { setQ(""); setOpen(false); }} className="text-muted hover:text-white">
            <X size={14} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full mt-1.5 left-0 w-80 bg-surface-raised border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
          {results.map((r) => (
            <button
              key={r.ticker}
              onMouseDown={() => pick(r)}
              className="w-full text-left px-4 py-2.5 hover:bg-surface-hover transition-colors flex items-center gap-3"
            >
              <span className="text-xs font-bold text-accent-light w-14 shrink-0">{r.ticker}</span>
              <span className="text-sm text-muted truncate">{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, prefix, suffix }: { label: string; value: unknown; prefix?: string; suffix?: string }) {
  const fmt = (v: unknown) => {
    if (v == null) return "N/A";
    const n = Number(v);
    if (isNaN(n)) return String(v);
    if (suffix === "%") return `${(n * 100).toFixed(1)}%`;
    if (prefix === "$") {
      if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
      if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  return (
    <div className="bg-surface rounded-lg border border-border p-3">
      <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">{label}</p>
      <p className="text-sm font-semibold text-white">{fmt(value)}</p>
    </div>
  );
}

function SectionCard({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
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

function RatingBadge({ rating }: { rating: string }) {
  const r = rating?.toLowerCase();
  const color = r === "buy" ? "bg-positive text-black" : r === "sell" ? "bg-negative text-white" : "bg-yellow-500 text-black";
  return <span className={clsx("px-3 py-1 rounded-full text-xs font-bold uppercase", color)}>{rating}</span>;
}

function PriceTargetBar({ low, mean, high, current }: { low: number; mean: number; high: number; current: number }) {
  const min = Math.min(low, current) * 0.95;
  const max = Math.max(high, current) * 1.05;
  const range = max - min;
  const pos = (v: number) => `${((v - min) / range) * 100}%`;

  return (
    <div className="relative h-10 mt-2">
      <div className="absolute top-4 left-0 right-0 h-2 bg-border rounded-full" />
      <div className="absolute top-4 h-2 bg-accent/30 rounded-full" style={{ left: pos(low), width: `calc(${pos(high)} - ${pos(low)})` }} />
      <div className="absolute top-2.5 w-0.5 h-5 bg-muted" style={{ left: pos(low) }} />
      <div className="absolute top-2.5 w-0.5 h-5 bg-muted" style={{ left: pos(high) }} />
      <div className="absolute top-2.5 w-1 h-5 bg-accent rounded" style={{ left: pos(mean) }} />
      <div className="absolute top-2 w-2 h-6 bg-white rounded" style={{ left: pos(current), transform: "translateX(-50%)" }} />
      <div className="absolute top-10 text-[9px] text-muted" style={{ left: pos(low), transform: "translateX(-50%)" }}>${low}</div>
      <div className="absolute top-10 text-[9px] text-accent font-semibold" style={{ left: pos(mean), transform: "translateX(-50%)" }}>${mean}</div>
      <div className="absolute top-10 text-[9px] text-muted" style={{ left: pos(high), transform: "translateX(-50%)" }}>${high}</div>
      <div className="absolute -top-0.5 text-[9px] text-white font-semibold" style={{ left: pos(current), transform: "translateX(-50%)" }}>${current}</div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function AnalystReport() {
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [timespan, setTimespan] = useState<string>("1Y");
  const [depth, setDepth] = useState<string>("standard");
  const reportRef = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: () => getAnalystReport({ ticker: selected!.ticker, timespan, depth }),
    onError: () => toast.error("Failed to generate report. Please try again."),
  });

  const report: any = mutation.data;
  const loading = mutation.isPending;

  const generate = () => {
    if (selected) mutation.mutate();
  };

  const exportPDF = async () => {
    if (!reportRef.current) return;
    toast.info("Generating PDF...");
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const el = reportRef.current;
      el.classList.add("pdf-export-mode");
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      el.classList.remove("pdf-export-mode");
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();
      const imgW = pdfW - 20;
      const imgH = (canvas.height * imgW) / canvas.width;
      let y = 10;
      let page = 0;
      while (y < imgH + 10) {
        if (page > 0) pdf.addPage();
        pdf.addImage(imgData, "PNG", 10, 10 - y + (page === 0 ? 0 : 0), imgW, imgH);
        y += pdfH - 20;
        page++;
      }
      const date = new Date().toISOString().slice(0, 10);
      pdf.save(`${selected?.ticker || "Report"}_Analyst_Report_${date}.pdf`);
      toast.success("PDF downloaded!");
    } catch {
      toast.error("PDF export failed.");
    }
  };

  const exportDOCX = async () => {
    if (!report) return;
    toast.info("Generating DOCX...");
    try {
      const docx = await import("docx");
      const { saveAs } = await import("file-saver");
      const { Document, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } = docx;

      const n = report.narrative || {};
      const sections: { title: string; text: string }[] = [
        { title: "Investment Thesis", text: n.investment_thesis || "" },
        { title: "Company Overview", text: n.company_overview || "" },
        { title: "Financial Analysis", text: n.financial_analysis || "" },
        { title: "Valuation Assessment", text: n.valuation_assessment || "" },
        { title: "Financial Health", text: n.balance_sheet_health || "" },
        { title: "Analyst Consensus", text: n.analyst_consensus || "" },
        { title: "Growth Outlook", text: n.growth_outlook || "" },
        { title: "Risk Factors", text: n.risk_factors || "" },
      ];
      if (n.arr_mrr_note) sections.push({ title: "ARR/MRR & Subscription Metrics", text: n.arr_mrr_note });

      const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
      const borders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

      const makeMetricTable = (rows: [string, string][]) =>
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(([label, value]) =>
            new TableRow({
              children: [
                new TableCell({ borders, width: { size: 50, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20 })] })] }),
                new TableCell({ borders, width: { size: 50, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: value, size: 20 })] })] }),
              ],
            })
          ),
        });

      const fmtNum = (v: any, p = "") => {
        if (v == null) return "N/A";
        const num = Number(v);
        if (isNaN(num)) return String(v);
        if (Math.abs(num) >= 1e12) return `${p}${(num / 1e12).toFixed(2)}T`;
        if (Math.abs(num) >= 1e9) return `${p}${(num / 1e9).toFixed(2)}B`;
        if (Math.abs(num) >= 1e6) return `${p}${(num / 1e6).toFixed(1)}M`;
        return `${p}${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      };
      const fmtPct = (v: any) => v != null ? `${(Number(v) * 100).toFixed(1)}%` : "N/A";

      const children: any[] = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          children: [new TextRun({ text: `${report.company?.name || selected?.ticker} (${selected?.ticker})`, bold: true, size: 36 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [new TextRun({ text: `Rating: ${n.rating || "N/A"} | Price: $${report.quote?.price} | Market Cap: ${fmtNum(report.company?.market_cap, "$")}`, size: 22 })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({ text: `Generated ${new Date(report.generated_at).toLocaleDateString()} | Timespan: ${report.timespan} | Depth: ${report.depth}`, size: 18, color: "666666" })],
        }),
      ];

      for (const s of sections) {
        children.push(
          new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 }, children: [new TextRun({ text: s.title, bold: true })] }),
          ...s.text.split("\n").filter(Boolean).map((p: string) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: p, size: 22 })] })),
        );
      }

      children.push(
        new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 100 }, children: [new TextRun({ text: "Key Metrics", bold: true })] }),
        makeMetricTable([
          ["P/E Ratio", String(report.valuation?.pe ?? "N/A")],
          ["Forward P/E", String(report.valuation?.forward_pe ?? "N/A")],
          ["Price/Sales", String(report.valuation?.ps ?? "N/A")],
          ["Price/Book", String(report.valuation?.pb ?? "N/A")],
          ["Gross Margin", fmtPct(report.margins?.gross)],
          ["Operating Margin", fmtPct(report.margins?.operating)],
          ["Net Margin", fmtPct(report.margins?.profit)],
          ["Debt/Equity", String(report.health?.debt_to_equity ?? "N/A")],
          ["Current Ratio", String(report.health?.current_ratio ?? "N/A")],
          ["ROE", fmtPct(report.health?.roe)],
          ["Free Cash Flow", fmtNum(report.health?.fcf, "$")],
        ]),
      );

      children.push(
        new Paragraph({ spacing: { before: 400 }, children: [new TextRun({ text: report.disclaimer || "", italics: true, size: 18, color: "999999" })] }),
        new Paragraph({ children: [new TextRun({ text: "Powered by Meta Llama", size: 18, color: "999999" })] }),
      );

      const doc = new Document({
        sections: [{ children }],
      });

      const blob = await docx.Packer.toBlob(doc);
      const date = new Date().toISOString().slice(0, 10);
      saveAs(blob, `${selected?.ticker || "Report"}_Analyst_Report_${date}.docx`);
      toast.success("DOCX downloaded!");
    } catch {
      toast.error("DOCX export failed.");
    }
  };

  const fmtChart = (v: number) => {
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toLocaleString()}`;
  };

  return (
    <div className="space-y-6">
      {/* Input bar */}
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1.5">Company</p>
            <TickerSearch onSelect={(r) => setSelected(r)} />
            {selected && (
              <p className="text-xs text-accent mt-1.5">{selected.ticker} — {selected.name}</p>
            )}
          </div>

          <div>
            <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1.5">Timespan</p>
            <div className="flex gap-1">
              {TIMESPANS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTimespan(t)}
                  className={clsx(
                    "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                    timespan === t ? "bg-accent text-white" : "bg-surface-hover text-muted hover:text-white"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={generate}
            disabled={!selected || loading}
            className={clsx(
              "px-5 py-2.5 rounded-lg text-sm font-semibold transition-all",
              selected && !loading
                ? "bg-accent text-white hover:bg-accent/80"
                : "bg-surface-hover text-muted cursor-not-allowed"
            )}
          >
            {loading ? "Generating..." : "Generate Report"}
          </button>
        </div>

        {/* Depth selector */}
        <div>
          <p className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-1.5">Report Depth</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {DEPTHS.map((d) => (
              <button
                key={d.key}
                onClick={() => setDepth(d.key)}
                className={clsx(
                  "text-left p-3 rounded-lg border transition-all",
                  depth === d.key
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-muted"
                )}
              >
                <p className="text-sm font-semibold text-white">{d.label}</p>
                <p className="text-[10px] text-accent font-medium">{d.pages}</p>
                <p className="text-xs text-muted mt-0.5">{d.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="bg-surface rounded-xl border border-border p-10 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted">Analyzing {selected?.ticker}...</p>
          <p className="text-xs text-muted/60">Fetching market data, financials, and generating AI narrative</p>
        </div>
      )}

      {/* Report */}
      {report && !loading && (
        <>
          {/* Export bar */}
          <div className="flex gap-2">
            <button onClick={exportPDF} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-xs font-medium text-muted hover:text-white hover:border-accent transition-all">
              <Download size={14} /> Export PDF
            </button>
            <button onClick={exportDOCX} className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-xs font-medium text-muted hover:text-white hover:border-accent transition-all">
              <FileText size={14} /> Export DOCX
            </button>
          </div>

          <div ref={reportRef} className="space-y-4">
            {/* Executive Summary */}
            <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-bold text-white">{report.company?.name}</h2>
                <span className="text-sm text-muted">({selected?.ticker})</span>
                {report.narrative?.rating && <RatingBadge rating={report.narrative.rating} />}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile label="Price" value={report.quote?.price} prefix="$" />
                <StatTile label="Market Cap" value={report.company?.market_cap} prefix="$" />
                <StatTile label="P/E Ratio" value={report.valuation?.pe} />
                <StatTile label="52-Week Range" value={
                  report.quote?.week_52_low != null && report.quote?.week_52_high != null
                    ? `$${report.quote.week_52_low.toFixed(2)} – $${report.quote.week_52_high.toFixed(2)}`
                    : null
                } />
              </div>

              {report.narrative?.investment_thesis && (
                <p className="text-sm text-muted leading-relaxed">{report.narrative.investment_thesis}</p>
              )}
            </div>

            {/* Company Overview */}
            {report.narrative?.company_overview && (
              <SectionCard icon={Building2} title="Company Overview">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatTile label="Sector" value={report.company?.sector} />
                  <StatTile label="Industry" value={report.company?.industry} />
                  <StatTile label="Employees" value={report.company?.employees?.toLocaleString()} />
                  <StatTile label="Today" value={
                    report.quote?.change_pct != null
                      ? `${report.quote.change_pct >= 0 ? "+" : ""}${report.quote.change_pct.toFixed(2)}%`
                      : null
                  } />
                </div>
                <p className="text-sm text-muted leading-relaxed">{report.narrative.company_overview}</p>
              </SectionCard>
            )}

            {/* Price Performance */}
            {report.price_history?.length > 0 && (
              <SectionCard icon={report.quote?.change_pct >= 0 ? TrendingUp : TrendingDown} title="Stock Price Performance">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={report.price_history}>
                      <defs>
                        <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis
                        dataKey="t"
                        tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}
                        tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                        axisLine={false}
                        tickLine={false}
                        minTickGap={40}
                      />
                      <YAxis
                        tickFormatter={(v) => `$${v.toFixed(0)}`}
                        tick={{ fontSize: 10, fill: "var(--color-muted)" }}
                        axisLine={false}
                        tickLine={false}
                        domain={["auto", "auto"]}
                      />
                      <Tooltip
                        contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
                        labelFormatter={(t) => new Date(t).toLocaleDateString()}
                        formatter={(v) => [`$${Number(v).toFixed(2)}`, "Close"]}
                      />
                      <Area type="monotone" dataKey="c" stroke="var(--color-accent)" fill="url(#priceGrad)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>
            )}

            {/* Financial Analysis */}
            <SectionCard icon={BarChart3} title="Financial Analysis">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatTile label="Gross Margin" value={report.margins?.gross} suffix="%" />
                <StatTile label="Operating Margin" value={report.margins?.operating} suffix="%" />
                <StatTile label="Net Margin" value={report.margins?.profit} suffix="%" />
                <StatTile label="EBITDA Margin" value={report.margins?.ebitda} suffix="%" />
              </div>

              {(report.financials?.annual_revenue?.length > 0 || report.financials?.annual_net_income?.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {report.financials?.annual_revenue?.length > 0 && (
                    <div>
                      <p className="text-xs text-muted mb-2 font-medium">Annual Revenue</p>
                      <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={report.financials.annual_revenue}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="year" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                            <YAxis tickFormatter={fmtChart} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmtChart(Number(v)), "Revenue"]} />
                            <Bar dataKey="value" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                  {report.financials?.annual_net_income?.length > 0 && (
                    <div>
                      <p className="text-xs text-muted mb-2 font-medium">Annual Net Income</p>
                      <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={report.financials.annual_net_income}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                            <XAxis dataKey="year" tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                            <YAxis tickFormatter={fmtChart} tick={{ fontSize: 10, fill: "var(--color-muted)" }} axisLine={false} tickLine={false} />
                            <Tooltip contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} formatter={(v) => [fmtChart(Number(v)), "Net Income"]} />
                            <Bar dataKey="value" fill="#22c55e" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <StatTile label="Revenue Growth" value={report.growth?.revenue_growth} suffix="%" />
                <StatTile label="Earnings Growth" value={report.growth?.earnings_growth} suffix="%" />
              </div>

              {report.narrative?.financial_analysis && (
                <p className="text-sm text-muted leading-relaxed">{report.narrative.financial_analysis}</p>
              )}
            </SectionCard>

            {/* Valuation */}
            <SectionCard icon={DollarSign} title="Valuation">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatTile label="P/E" value={report.valuation?.pe} />
                <StatTile label="Forward P/E" value={report.valuation?.forward_pe} />
                <StatTile label="P/S" value={report.valuation?.ps} />
                <StatTile label="P/B" value={report.valuation?.pb} />
                <StatTile label="EV/Revenue" value={report.valuation?.ev_to_revenue} />
                <StatTile label="EV/EBITDA" value={report.valuation?.ev_to_ebitda} />
              </div>
              <StatTile label="Enterprise Value" value={report.valuation?.enterprise_value} prefix="$" />
              {report.narrative?.valuation_assessment && (
                <p className="text-sm text-muted leading-relaxed">{report.narrative.valuation_assessment}</p>
              )}
            </SectionCard>

            {/* Financial Health */}
            <SectionCard icon={ShieldCheck} title="Financial Health & Balance Sheet">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatTile label="Debt/Equity" value={report.health?.debt_to_equity} />
                <StatTile label="Current Ratio" value={report.health?.current_ratio} />
                <StatTile label="ROE" value={report.health?.roe} suffix="%" />
                <StatTile label="ROA" value={report.health?.roa} suffix="%" />
                <StatTile label="Free Cash Flow" value={report.health?.fcf} prefix="$" />
                <StatTile label="Total Debt" value={report.health?.total_debt} prefix="$" />
              </div>
              {report.narrative?.balance_sheet_health && (
                <p className="text-sm text-muted leading-relaxed">{report.narrative.balance_sheet_health}</p>
              )}
            </SectionCard>

            {/* Analyst Consensus */}
            <SectionCard icon={Users} title="Analyst Consensus & Price Targets">
              {report.analyst_targets?.low != null && report.analyst_targets?.high != null && report.analyst_targets?.mean != null && (
                <PriceTargetBar
                  low={report.analyst_targets.low}
                  mean={report.analyst_targets.mean}
                  high={report.analyst_targets.high}
                  current={report.quote?.price || 0}
                />
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-6">
                <StatTile label="Recommendation" value={report.analyst_targets?.recommendation} />
                <StatTile label="Analysts Covering" value={report.analyst_targets?.num_analysts} />
                <StatTile label="Mean Target" value={report.analyst_targets?.mean} prefix="$" />
              </div>

              {report.recommendations_history?.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-muted border-b border-border">
                        <th className="text-left py-2 px-2 font-medium">Date</th>
                        <th className="text-left py-2 px-2 font-medium">Firm</th>
                        <th className="text-left py-2 px-2 font-medium">Rating</th>
                        <th className="text-left py-2 px-2 font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.recommendations_history.slice(0, 8).map((r: any, i: number) => (
                        <tr key={i} className="border-b border-border/50">
                          <td className="py-2 px-2 text-muted">{r.date}</td>
                          <td className="py-2 px-2 text-white">{r.firm}</td>
                          <td className="py-2 px-2 text-accent">{r.to_grade}</td>
                          <td className="py-2 px-2 text-muted">{r.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {report.narrative?.analyst_consensus && (
                <p className="text-sm text-muted leading-relaxed">{report.narrative.analyst_consensus}</p>
              )}
            </SectionCard>

            {/* Growth Outlook */}
            {report.narrative?.growth_outlook && (
              <SectionCard icon={Rocket} title="Growth Outlook & Catalysts">
                <p className="text-sm text-muted leading-relaxed">{report.narrative.growth_outlook}</p>
              </SectionCard>
            )}

            {/* Risk Factors */}
            {report.narrative?.risk_factors && (
              <SectionCard icon={AlertTriangle} title="Risk Factors">
                <p className="text-sm text-muted leading-relaxed">{report.narrative.risk_factors}</p>
              </SectionCard>
            )}

            {/* ARR/MRR */}
            {report.narrative?.arr_mrr_note && (
              <SectionCard icon={Server} title="ARR/MRR & Subscription Metrics">
                <p className="text-sm text-muted leading-relaxed">{report.narrative.arr_mrr_note}</p>
              </SectionCard>
            )}

            {/* Footer */}
            <div className="bg-surface rounded-xl border border-border p-4 space-y-1">
              <p className="text-xs text-muted">{report.disclaimer}</p>
              <p className="text-xs text-muted/60">Powered by Meta Llama | Generated {new Date(report.generated_at).toLocaleString()}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
