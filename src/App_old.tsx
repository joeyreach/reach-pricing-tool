import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Papa from "papaparse";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const STORAGE_KEY = "reach_pricing_v8";
const PASSWORD = "reach2026";

const TIERS = [
  { label: "1 Connection",        min: 1,   max: 1,        basePrice: 149  },
  { label: "2–10 Connections",    min: 2,   max: 10,       basePrice: 290  },
  { label: "11–25 Connections",   min: 11,  max: 25,       basePrice: 550  },
  { label: "26–50 Connections",   min: 26,  max: 50,       basePrice: 950  },
  { label: "51–100 Connections",  min: 51,  max: 100,      basePrice: 1700 },
  { label: "101–200 Connections", min: 101, max: 200,      basePrice: 3060 },
  { label: "201–300 Connections", min: 201, max: 300,      basePrice: 4200 },
  { label: "301+ Connections",    min: 301, max: Infinity, basePrice: 4200 },
];

const CONN_TIER_DEFS = [
  { label: "1 Connection",        key: 1,   sliderMax: 150 },
  { label: "2–10 Connections",    key: 10,  sliderMax: 100 },
  { label: "11–25 Connections",   key: 25,  sliderMax: 100 },
  { label: "26–50 Connections",   key: 50,  sliderMax: 100 },
  { label: "51–100 Connections",  key: 100, sliderMax: 100 },
  { label: "101–200 Connections", key: 200, sliderMax: 100 },
  { label: "201–300 Connections", key: 300, sliderMax: 100 },
];

const FORECAST_COUNTS = [1639, ...Array.from({ length: Math.ceil((5000 - 1750) / 250) + 1 }, (_, i) => 1750 + i * 250)];

const DEFAULT_SETTINGS = {
  annualDiscount: 30,
  perConnectionPrice: 10,
  connTierPrices: { 1: 149, 10: 29, 25: 22, 50: 19, 100: 17, 200: 15.30, 300: 14 },
  perReportMonthly: 5,    perReportUse: 0.50,   reportPackSize: 10,  reportPackPrice: 40,
  perDashboardMonthly: 8, perDashboardUse: 0.75, dashPackSize: 10,   dashPackPrice: 60,
  perTemplateMonthly: 10, perTemplateUse: 1.00,  templatePackSize: 5, templatePackPrice: 40,
  perBudgetsProMonthly: 20, perBudgetsProUse: 2.00, budgetsProPackSize: 5, budgetsProPackPrice: 75,
  marketplaceTake: 10,
  mktReportSellPct: 5,  mktDashSellPct: 5,
  mktReportSubPrice: 15, mktDashSubPrice: 25,
  mktReportBuyers: 2,    mktDashBuyers: 2,
};

const DEFAULT_HYBRID = {
  connMode: "current",
  useReportMonthly: false,   useReportPayPerUse: false,   useReportPacks: false,
  useDashMonthly: false,     useDashPayPerUse: false,     useDashPacks: false,
  useTemplateMonthly: false, useTemplatePayPerUse: false, useTemplatePacks: false,
  useBudgetsProMonthly: false, useBudgetsProPayPerUse: false, useBudgetsProPacks: false,
  useMarketplace: false,
};

// ── connection pricing ────────────────────────────────────────────
// 1 conn  = $149 flat
// 2–10    = $290 flat
// 11–25   = all connections × $29  (rate of completed 10-conn tier)
// 26–50   = all connections × $22  (rate of completed 25-conn tier)
// 51–100  = all connections × $19
// 101–200 = all connections × $17
// 201–300 = all connections × $15.30
// 301+    = all connections × $14
function calcConnPrice(c) {
  if (c <= 0)   return 0;
  if (c === 1)  return 149;
  if (c <= 10)  return 290;
  if (c <= 25)  return c * 29;
  if (c <= 50)  return c * 22;
  if (c <= 100) return c * 19;
  if (c <= 200) return c * 17;
  if (c <= 300) return c * 15.3;
  return c * 14;
}

// Same logic but uses rates from settings (for hybrid/scenario calcs)
function calcConnPriceWithRates(c, tp) {
  if (c <= 0)   return 0;
  if (c === 1)  return tp[1];
  if (c <= 10)  return 290;
  if (c <= 25)  return c * tp[10];
  if (c <= 50)  return c * tp[25];
  if (c <= 100) return c * tp[50];
  if (c <= 200) return c * tp[100];
  if (c <= 300) return c * tp[200];
  return c * tp[300];
}

// ── helpers ──────────────────────────────────────────────────────
const getTier = c => TIERS.find(t => c >= t.min && c <= t.max) || TIERS[TIERS.length - 1];

const fmt  = n => isNaN(n) ? "$0" : "$" + Math.round(n).toLocaleString();
const fmtD = n => Number(n).toFixed(2);
const fmtK = n => n >= 1e6 ? "$" + (n/1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n/1e3).toFixed(1) + "K" : "$" + Math.round(n);

const mktMrrFor = (c, s) => {
  const rGMV = c.reportsPerMonth * (s.mktReportSellPct/100) * s.mktReportBuyers * s.mktReportSubPrice;
  const dGMV = c.dashPerMonth    * (s.mktDashSellPct/100)   * s.mktDashBuyers   * s.mktDashSubPrice;
  return (rGMV + dGMV) * (s.marketplaceTake / 100);
};

const pctDelta = (val, base) => {
  if (!base) return null;
  const p = ((val - base) / base * 100).toFixed(1);
  const up = val >= base;
  return <span className={"text-xs font-bold " + (up ? "text-green-600" : "text-rose-600")}>{up ? "▲" : "▼"} {Math.abs(p)}%</span>;
};

const connBase = (c, h, s) => {
  if (h.connMode === "current") return c.mrr;
  if (h.connMode === "flat")    return c.connections * s.perConnectionPrice;
  if (h.connMode === "tiered")  return calcConnPriceWithRates(c.connections, s.connTierPrices);
  return 0;
};

const calcHybridOne = (c, h, s) => {
  let b = connBase(c, h, s);
  if      (h.useReportMonthly)     b += c.reportsPerMonth      * s.perReportMonthly;
  else if (h.useReportPayPerUse)   b += c.downloadsPerMonth     * s.perReportUse;
  else if (h.useReportPacks)       b += Math.ceil(c.reportsPerMonth    / s.reportPackSize)    * s.reportPackPrice;
  if      (h.useDashMonthly)       b += c.dashPerMonth          * s.perDashboardMonthly;
  else if (h.useDashPayPerUse)     b += c.dashPublishedPerMonth * s.perDashboardUse;
  else if (h.useDashPacks)         b += Math.ceil(c.dashPerMonth       / s.dashPackSize)       * s.dashPackPrice;
  if      (h.useTemplateMonthly)   b += c.templatesPerMonth     * s.perTemplateMonthly;
  else if (h.useTemplatePayPerUse) b += c.templatesPerMonth     * s.perTemplateUse;
  else if (h.useTemplatePacks)     b += Math.ceil(c.templatesPerMonth  / s.templatePackSize)  * s.templatePackPrice;
  if      (h.useBudgetsProMonthly)   b += c.budgetsProPerMonth  * s.perBudgetsProMonthly;
  else if (h.useBudgetsProPayPerUse) b += c.budgetsProPerMonth  * s.perBudgetsProUse;
  else if (h.useBudgetsProPacks)     b += Math.ceil(c.budgetsProPerMonth / s.budgetsProPackSize) * s.budgetsProPackPrice;
  if (h.useMarketplace) b += mktMrrFor(c, s);
  return b;
};

function scaleCustomers(base, targetCount) {
  if (!base || !base.length) return [];
  const ratio = targetCount / base.length;
  const result = [];
  base.forEach(c => {
    const whole = Math.floor(ratio);
    for (let i = 0; i < whole; i++) result.push(c);
    if (Math.random() < (ratio - whole)) result.push(c);
  });
  while (result.length > targetCount) result.pop();
  while (result.length < targetCount) result.push(base[Math.floor(Math.random() * base.length)]);
  return result;
}

// ── UI components ─────────────────────────────────────────────────
const Card = ({ children, className }) => (
  <div className={"bg-white rounded-xl shadow p-4 " + (className || "")}>{children}</div>
);
const Slider = ({ label, value, min, max, step, onChange, prefix, suffix, hint }) => (
  <div className="mb-3">
    <div className="flex justify-between text-xs mb-1">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold text-indigo-700">{prefix || ""}{value}{suffix || ""}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(Number(e.target.value))} className="w-full accent-indigo-600" />
    {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
  </div>
);
const Toggle = ({ label, checked, onChange, hint }) => (
  <label className={"flex items-start gap-3 p-3 rounded-lg cursor-pointer border transition mb-2 " + (checked ? "bg-indigo-50 border-indigo-300" : "bg-gray-50 border-gray-200 hover:bg-gray-100")}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-0.5 accent-indigo-600 w-4 h-4 flex-shrink-0" />
    <div>
      <p className={"text-sm font-medium " + (checked ? "text-indigo-700" : "text-gray-600")}>{label}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  </label>
);
const Tab = ({ active, onClick, children }) => (
  <button onClick={onClick}
    className={"px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors " + (active ? "border-indigo-600 text-indigo-700 bg-white" : "border-transparent text-gray-500 hover:text-gray-700")}>
    {children}
  </button>
);
const MetricBox = ({ label, value, sub, color }) => {
  const colors = {
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-800",
    green:  "bg-green-50 border-green-200 text-green-800",
    amber:  "bg-amber-50 border-amber-200 text-amber-800",
    rose:   "bg-rose-50 border-rose-200 text-rose-800",
  };
  return (
    <div className={"rounded-lg border p-3 " + (colors[color || "indigo"])}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
};

const FORECAST_COLORS = { current: "#6366f1", hybrid: "#f59e0b", scenA: "#10b981", scenB: "#3b82f6", scenC: "#ec4899" };
const FORECAST_LABELS = { current: "Current Model", hybrid: "🧩 Hybrid", scenA: "A: Monthly Fees", scenB: "B: Pay-Per-Use", scenC: "C: Packs" };

const ForecastTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-bold text-gray-700 mb-2">{payload[0].payload.count.toLocaleString()} customers</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex justify-between gap-4 mb-0.5">
          <span style={{ color: p.color }}>{FORECAST_LABELS[p.dataKey] || p.name}</span>
          <span className="font-semibold">{fmtK(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

const RECON_PAGE_SIZE = 50;

export default function App() {
  const [authed, setAuthed]   = useState(false);
  const [pw, setPw]           = useState("");
  const [pwErr, setPwErr]     = useState(false);
  const [data, setData]       = useState(null);
  const [tab, setTab]         = useState("overview");
  const [view, setView]       = useState("mrr");
  const [forecastView, setForecastView] = useState("mrr");
  const [forecastScenarios, setForecastScenarios] = useState({ current: true, hybrid: true, scenA: false, scenB: false, scenC: false });
  const fileRef = useRef();

  const [reconSort,   setReconSort]   = useState({ col: "diff", dir: "desc" });
  const [reconFilter, setReconFilter] = useState("all");
  const [reconSearch, setReconSearch] = useState("");
  const [reconPage,   setReconPage]   = useState(0);

  const [settings, setSettings] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY + "_s"); return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : DEFAULT_SETTINGS; }
    catch { return DEFAULT_SETTINGS; }
  });
  const [hybrid, setHybrid] = useState(() => {
    try { const h = localStorage.getItem(STORAGE_KEY + "_h"); return h ? { ...DEFAULT_HYBRID, ...JSON.parse(h) } : DEFAULT_HYBRID; }
    catch { return DEFAULT_HYBRID; }
  });

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY + "_s", JSON.stringify(settings)); } catch {} }, [settings]);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEY + "_h", JSON.stringify(hybrid));   } catch {} }, [hybrid]);

  const set  = k => v => setSettings(s => ({ ...s, [k]: v }));
  const setH = k => v => setHybrid(h => ({ ...h, [k]: v }));
  const setConnTierPrice = (k, val) => setSettings(s => ({ ...s, connTierPrices: { ...s.connTierPrices, [k]: val } }));

  const handleFile = file => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, dynamicTyping: true,
      complete: ({ data: rows }) => {
        const cleaned = rows.map(r => {
          const months  = Math.max(r["Months Active"] || 1, 1);
          const conns   = r["Connections"] || 0;
          const billing = (r["Billing Type"] || "month").toLowerCase().trim().startsWith("y") ? "annual" : "monthly";
          return {
            id: r["Customer ID"], months, connections: conns,
            tier: getTier(conns), billing,
            mrr:                   r["MRR"] || 0,
            reportsPerMonth:       (r["Reports Created"]      || 0) / months,
            dashPerMonth:          (r["Dashboards Created"]   || 0) / months,
            downloadsPerMonth:     (r["Report Downloads"]     || 0) / months,
            dashPublishedPerMonth: (r["Dashboards Published"] || 0) / months,
            templatesPerMonth:     (r["Templates Created"]    || 0) / months,
            budgetsProPerMonth:    (r["Budgets Pro"]          || 0) / months,
          };
        }).filter(r => r.connections >= 0);
        setData(cleaned);
        setTab("overview");
      }
    });
  };

  const calcAll = useCallback((customers, s, h) => {
    if (!customers) return null;
    const disc  = 1 - s.annualDiscount / 100;
    const toMrr = (b, billing) => billing === "annual" ? b * disc : b;
    const sum   = (arr, k) => arr.reduce((a, x) => a + (x[k] || 0), 0);

    const baseline   = customers.map(c => ({ mrr: c.mrr, cash: c.mrr * 12 }));
    const scenA      = customers.map(c => { const b = calcConnPriceWithRates(c.connections, s.connTierPrices) + c.reportsPerMonth*s.perReportMonthly + c.dashPerMonth*s.perDashboardMonthly + c.templatesPerMonth*s.perTemplateMonthly + c.budgetsProPerMonth*s.perBudgetsProMonthly; return { mrr: toMrr(b, c.billing), cash: toMrr(b, c.billing)*12 }; });
    const scenB      = customers.map(c => { const b = calcConnPriceWithRates(c.connections, s.connTierPrices) + c.downloadsPerMonth*s.perReportUse + c.dashPublishedPerMonth*s.perDashboardUse + c.templatesPerMonth*s.perTemplateUse + c.budgetsProPerMonth*s.perBudgetsProUse; return { mrr: toMrr(b, c.billing), cash: toMrr(b, c.billing)*12 }; });
    const scenC      = customers.map(c => { const b = calcConnPriceWithRates(c.connections, s.connTierPrices) + Math.ceil(c.reportsPerMonth/s.reportPackSize)*s.reportPackPrice + Math.ceil(c.dashPerMonth/s.dashPackSize)*s.dashPackPrice + Math.ceil(c.templatesPerMonth/s.templatePackSize)*s.templatePackPrice + Math.ceil(c.budgetsProPerMonth/s.budgetsProPackSize)*s.budgetsProPackPrice; return { mrr: toMrr(b, c.billing), cash: toMrr(b, c.billing)*12 }; });
    const scenD      = customers.map(c => { const b = c.tier.basePrice + mktMrrFor(c, s); return { mrr: toMrr(b, c.billing), cash: toMrr(b, c.billing)*12 }; });
    const hybridRows = customers.map(c => { const b = calcHybridOne(c, h, s); return { mrr: toMrr(b, c.billing), cash: toMrr(b, c.billing)*12 }; });

    return {
      baseline: { mrr: sum(baseline,  "mrr"), cash: sum(baseline,  "cash") },
      scenA:    { mrr: sum(scenA,     "mrr"), cash: sum(scenA,     "cash") },
      scenB:    { mrr: sum(scenB,     "mrr"), cash: sum(scenB,     "cash") },
      scenC:    { mrr: sum(scenC,     "mrr"), cash: sum(scenC,     "cash") },
      scenD:    { mrr: sum(scenD,     "mrr"), cash: sum(scenD,     "cash") },
      hybrid:   { mrr: sum(hybridRows,"mrr"), cash: sum(hybridRows,"cash") },
    };
  }, []);

  const calcForecast = useCallback(() => {
    if (!data) return [];
    const disc  = 1 - settings.annualDiscount / 100;
    const toMrr = (b, billing) => billing === "annual" ? b * disc : b;
    const mult  = forecastView === "arr" ? 12 : 1;
    return FORECAST_COUNTS.map(count => {
      const scaled = scaleCustomers(data, count);
      const row = { count };
      if (forecastScenarios.current) row.current = scaled.reduce((s, c) => s + c.mrr, 0) * mult;
      if (forecastScenarios.hybrid)  row.hybrid  = scaled.reduce((s, c) => s + toMrr(calcHybridOne(c, hybrid, settings), c.billing), 0) * mult;
      if (forecastScenarios.scenA)   row.scenA   = scaled.reduce((s, c) => s + toMrr(calcConnPriceWithRates(c.connections, settings.connTierPrices) + c.reportsPerMonth*settings.perReportMonthly + c.dashPerMonth*settings.perDashboardMonthly + c.templatesPerMonth*settings.perTemplateMonthly + c.budgetsProPerMonth*settings.perBudgetsProMonthly, c.billing), 0) * mult;
      if (forecastScenarios.scenB)   row.scenB   = scaled.reduce((s, c) => s + toMrr(calcConnPriceWithRates(c.connections, settings.connTierPrices) + c.downloadsPerMonth*settings.perReportUse + c.dashPublishedPerMonth*settings.perDashboardUse + c.templatesPerMonth*settings.perTemplateUse + c.budgetsProPerMonth*settings.perBudgetsProUse, c.billing), 0) * mult;
      if (forecastScenarios.scenC)   row.scenC   = scaled.reduce((s, c) => s + toMrr(calcConnPriceWithRates(c.connections, settings.connTierPrices) + Math.ceil(c.reportsPerMonth/settings.reportPackSize)*settings.reportPackPrice + Math.ceil(c.dashPerMonth/settings.dashPackSize)*settings.dashPackPrice + Math.ceil(c.templatesPerMonth/settings.templatePackSize)*settings.templatePackPrice + Math.ceil(c.budgetsProPerMonth/settings.budgetsProPackSize)*settings.budgetsProPackPrice, c.billing), 0) * mult;
      return row;
    });
  }, [data, settings, hybrid, forecastView, forecastScenarios]);

  const rev       = data ? calcAll(data, settings, hybrid) : null;
  const chartData = data && tab === "forecast" ? calcForecast() : [];
  const vm        = view === "mrr";

  const totalMrr    = data ? data.reduce((a, c) => a + c.mrr, 0) : 0;
  const annualCount = data ? data.filter(c => c.billing === "annual").length : 0;
  const avgConn     = data ? data.reduce((a, c) => a + c.connections, 0) / data.length : 0;
  const avgRep      = data ? data.reduce((a, c) => a + c.reportsPerMonth, 0) / data.length : 0;
  const avgDash     = data ? data.reduce((a, c) => a + c.dashPerMonth, 0) / data.length : 0;
  const avgTemplate = data ? data.reduce((a, c) => a + c.templatesPerMonth, 0) / data.length : 0;
  const avgBudgets  = data ? data.reduce((a, c) => a + c.budgetsProPerMonth, 0) / data.length : 0;

  const tierBreakdown = data ? TIERS.map(t => {
    const g = data.filter(c => c.tier.label === t.label);
    return { label: t.label, count: g.length, mrr: g.reduce((a,c)=>a+c.mrr,0),
      avgRep:      g.length ? g.reduce((a,c)=>a+c.reportsPerMonth,0)/g.length : 0,
      avgDash:     g.length ? g.reduce((a,c)=>a+c.dashPerMonth,0)/g.length : 0,
      avgTemplate: g.length ? g.reduce((a,c)=>a+c.templatesPerMonth,0)/g.length : 0,
      avgBudgets:  g.length ? g.reduce((a,c)=>a+c.budgetsProPerMonth,0)/g.length : 0,
    };
  }).filter(t => t.count > 0) : [];

  const totalReportsPerMo = data ? data.reduce((a,c)=>a+c.reportsPerMonth,0) : 0;
  const totalDashPerMo    = data ? data.reduce((a,c)=>a+c.dashPerMonth,0) : 0;
  const mktReportListings = totalReportsPerMo * (settings.mktReportSellPct/100);
  const mktDashListings   = totalDashPerMo    * (settings.mktDashSellPct/100);
  const mktReportGMV      = mktReportListings * settings.mktReportBuyers * settings.mktReportSubPrice;
  const mktDashGMV        = mktDashListings   * settings.mktDashBuyers   * settings.mktDashSubPrice;
  const mktGMV            = mktReportGMV + mktDashGMV;
  const mktReachRevMo     = mktGMV * (settings.marketplaceTake/100);

  const connModeLabel = hybrid.connMode === "current" ? "Current connection tiers (actual MRR)"
    : hybrid.connMode === "flat"   ? ("Per-connection flat ($" + settings.perConnectionPrice + "/conn)")
    : hybrid.connMode === "tiered" ? "Per-connection tiered"
    : null;
  const activeHybridLabels = [
    connModeLabel,
    hybrid.useReportMonthly     && "Report monthly fee",
    hybrid.useReportPayPerUse   && "Report pay-per-use",
    hybrid.useReportPacks       && "Report packs",
    hybrid.useDashMonthly       && "Dashboard monthly fee",
    hybrid.useDashPayPerUse     && "Dashboard pay-per-use",
    hybrid.useDashPacks         && "Dashboard packs",
    hybrid.useTemplateMonthly   && "Template monthly fee",
    hybrid.useTemplatePayPerUse && "Template pay-per-use",
    hybrid.useTemplatePacks     && "Template packs",
    hybrid.useBudgetsProMonthly    && "Budgets Pro monthly fee",
    hybrid.useBudgetsProPayPerUse  && "Budgets Pro pay-per-use",
    hybrid.useBudgetsProPacks      && "Budgets Pro packs",
    hybrid.useMarketplace          && "Marketplace rev share",
  ].filter(Boolean);

  // ── recon computed live (not baked into parse) ──
  const reconRows = useMemo(() => {
    if (!data) return [];
    const disc = 1 - settings.annualDiscount / 100;
    return data.map(r => {
      const base    = calcConnPrice(r.connections);
      const calcMrr = r.billing === "annual" ? base * disc : base;
      const diff    = calcMrr - r.mrr;
      const diffPct = r.mrr !== 0 ? (diff / r.mrr * 100) : null;
      return { ...r, calcMrr, diff, diffPct };
    });
  }, [data, settings.annualDiscount]);

  const reconTotals = useMemo(() => {
    if (!reconRows.length) return null;
    return {
      actMrr:  reconRows.reduce((s,r) => s + r.mrr,     0),
      calcMrr: reconRows.reduce((s,r) => s + r.calcMrr, 0),
      diff:    reconRows.reduce((s,r) => s + r.diff,     0),
      over:    reconRows.filter(r => r.diff >  0.01).length,
      under:   reconRows.filter(r => r.diff < -0.01).length,
      exact:   reconRows.filter(r => Math.abs(r.diff) <= 0.01).length,
    };
  }, [reconRows]);

  const reconSorted = useMemo(() => {
    if (!reconRows.length) return [];
    let rows = [...reconRows];
    if (reconSearch.trim()) {
      const q = reconSearch.trim().toLowerCase();
      rows = rows.filter(r => String(r.id).toLowerCase().includes(q));
    }
    if (reconFilter === "over")  rows = rows.filter(r => r.diff >  0.01);
    if (reconFilter === "under") rows = rows.filter(r => r.diff < -0.01);
    if (reconFilter === "exact") rows = rows.filter(r => Math.abs(r.diff) <= 0.01);
    rows.sort((a, b) => {
      const av = a[reconSort.col] != null ? a[reconSort.col] : -Infinity;
      const bv = b[reconSort.col] != null ? b[reconSort.col] : -Infinity;
      return reconSort.dir === "asc" ? av - bv : bv - av;
    });
    return rows;
  }, [reconRows, reconSort, reconFilter, reconSearch]);

  const reconPageRows   = reconSorted.slice(reconPage * RECON_PAGE_SIZE, (reconPage + 1) * RECON_PAGE_SIZE);
  const reconTotalPages = Math.ceil(reconSorted.length / RECON_PAGE_SIZE);
  const toggleReconSort = col => setReconSort(s => ({ col, dir: s.col === col && s.dir === "desc" ? "asc" : "desc" }));

  const filteredActMrr  = reconSorted.reduce((s,r) => s + r.mrr,     0);
  const filteredCalcMrr = reconSorted.reduce((s,r) => s + r.calcMrr, 0);
  const filteredDiff    = reconSorted.reduce((s,r) => s + r.diff,     0);

  // ── password screen ──
  if (!authed) return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 to-indigo-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">🔒</span></div>
          <h1 className="text-xl font-bold text-gray-800">Reach Pricing Tool</h1>
          <p className="text-sm text-gray-500 mt-1">Internal use only</p>
        </div>
        <input type="password" placeholder="Enter password" value={pw}
          onChange={e => { setPw(e.target.value); setPwErr(false); }}
          onKeyDown={e => { if (e.key === "Enter") { if (pw === PASSWORD) setAuthed(true); else setPwErr(true); }}}
          className={"w-full border rounded-lg px-4 py-2.5 text-sm mb-3 outline-none focus:ring-2 focus:ring-indigo-400 " + (pwErr ? "border-rose-400" : "border-gray-300")} />
        {pwErr && <p className="text-xs text-rose-500 mb-2">Incorrect password</p>}
        <button onClick={() => { if (pw === PASSWORD) setAuthed(true); else setPwErr(true); }}
          className="w-full bg-indigo-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-indigo-700 transition">Access Tool</button>
      </div>
    </div>
  );

  // ── upload screen ──
  if (!data) return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 to-indigo-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-3"><span className="text-2xl">📊</span></div>
          <h1 className="text-xl font-bold text-gray-800">Reach Pricing Scenario Modeler</h1>
          <p className="text-sm text-gray-500 mt-1">Upload your anonymized customer CSV to begin</p>
        </div>
        <div onClick={() => fileRef.current.click()}
          className="border-2 border-dashed border-indigo-300 rounded-xl p-8 text-center cursor-pointer hover:bg-indigo-50 transition mb-4">
          <p className="text-3xl mb-2">📁</p>
          <p className="text-sm font-medium text-indigo-700">Click to upload CSV</p>
          <p className="text-xs text-gray-400 mt-1">customer_usage_Feb2026.csv</p>
        </div>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
        <p className="text-xs text-gray-400 text-center">⚠️ Data processed locally only.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-indigo-700 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Reach Pricing Scenario Modeler</h1>
          <p className="text-xs text-indigo-200">{data.length.toLocaleString()} customers · Feb 2026</p>
        </div>
        <div className="flex gap-2">
          {tab !== "forecast" && tab !== "reconciliation" && <>
            <button onClick={() => setView("mrr")}      className={"px-3 py-1.5 rounded-lg text-xs font-semibold transition " + (vm  ? "bg-white text-indigo-700" : "bg-indigo-600 hover:bg-indigo-500")}>MRR</button>
            <button onClick={() => setView("cashflow")} className={"px-3 py-1.5 rounded-lg text-xs font-semibold transition " + (!vm ? "bg-white text-indigo-700" : "bg-indigo-600 hover:bg-indigo-500")}>Cash Flow</button>
          </>}
          {tab === "forecast" && <>
            <button onClick={() => setForecastView("mrr")} className={"px-3 py-1.5 rounded-lg text-xs font-semibold transition " + (forecastView==="mrr" ? "bg-white text-indigo-700" : "bg-indigo-600 hover:bg-indigo-500")}>MRR</button>
            <button onClick={() => setForecastView("arr")} className={"px-3 py-1.5 rounded-lg text-xs font-semibold transition " + (forecastView==="arr" ? "bg-white text-indigo-700" : "bg-indigo-600 hover:bg-indigo-500")}>ARR</button>
          </>}
          <button onClick={() => setData(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 transition">↑ New File</button>
        </div>
      </div>

      <div className="bg-gray-100 border-b px-6 flex gap-1 pt-2 overflow-x-auto">
        {[
          ["overview","📈 Overview"],["settings","⚙️ Settings"],["hybrid","🧩 Hybrid Builder"],
          ["forecast","🔮 Forecast"],["segments","👥 Segments"],["recommendation","💡 Recommendation"],
          ["reconciliation","🔍 Reconciliation"],
        ].map(([k,l]) => <Tab key={k} active={tab===k} onClick={() => setTab(k)}>{l}</Tab>)}
      </div>

      <div className="p-6 max-w-7xl mx-auto">

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricBox label="Current MRR"      value={fmt(totalMrr)}    color="indigo" />
              <MetricBox label="Current ARR"      value={fmt(totalMrr*12)} color="indigo" />
              <MetricBox label="Annual Customers" value={annualCount + " (" + ((annualCount/data.length)*100).toFixed(1) + "%)"} sub={(data.length-annualCount) + " monthly"} color="amber" />
              <MetricBox label="Total Customers"  value={data.length.toLocaleString()} color="green" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <MetricBox label="Avg Connections"    value={fmtD(avgConn)}     color="indigo" />
              <MetricBox label="Avg Reports/mo"     value={fmtD(avgRep)}      color="indigo" />
              <MetricBox label="Avg Dashboards/mo"  value={fmtD(avgDash)}     color="indigo" />
              <MetricBox label="Avg Templates/mo"   value={fmtD(avgTemplate)} color="indigo" />
              <MetricBox label="Avg Budgets Pro/mo" value={fmtD(avgBudgets)}  color="indigo" />
            </div>
            <Card>
              <h2 className="font-semibold text-gray-700 mb-3">Customers by Connection Tier</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2">Tier</th><th className="pb-2">Customers</th><th className="pb-2">%</th>
                    <th className="pb-2">MRR</th><th className="pb-2">Avg Rep/mo</th><th className="pb-2">Avg Dash/mo</th>
                    <th className="pb-2">Avg Tmpl/mo</th><th className="pb-2">Avg BPro/mo</th>
                  </tr></thead>
                  <tbody>
                    {tierBreakdown.map(t => (
                      <tr key={t.label} className="border-b last:border-0">
                        <td className="py-2 font-medium">{t.label}</td>
                        <td className="py-2">{t.count}</td>
                        <td className="py-2">{((t.count/data.length)*100).toFixed(1)}%</td>
                        <td className="py-2">{fmt(t.mrr)}</td>
                        <td className="py-2">{fmtD(t.avgRep)}</td>
                        <td className="py-2">{fmtD(t.avgDash)}</td>
                        <td className="py-2">{fmtD(t.avgTemplate)}</td>
                        <td className="py-2">{fmtD(t.avgBudgets)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {tab === "settings" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <h2 className="font-semibold text-gray-700 mb-3">📅 Annual Discount</h2>
              <Slider label="Annual billing discount" value={settings.annualDiscount} min={0} max={50} step={1} onChange={set("annualDiscount")} suffix="%" hint="Applied to all annual customers" />
            </Card>
            <Card className="lg:col-span-2">
              <h2 className="font-semibold text-gray-700 mb-1">🔗 Per-Connection — Flat</h2>
              <p className="text-xs text-gray-400 mb-3">Used when flat per-connection is selected in Hybrid Builder.</p>
              <Slider label="Price per connection / month" value={settings.perConnectionPrice} min={1} max={100} step={1} onChange={set("perConnectionPrice")} prefix="$" />
            </Card>
            <Card className="md:col-span-2 lg:col-span-3">
              <h2 className="font-semibold text-gray-700 mb-1">🔗 Per-Connection — By Tier</h2>
              <p className="text-xs text-gray-400 mb-4">All connections × rate of last completed tier. 1 conn = $149 flat, 2–10 = $290 flat, 11+ = connections × prior tier rate.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8">
                {CONN_TIER_DEFS.map(({ label, key, sliderMax }) => (
                  <Slider key={key} label={label} value={settings.connTierPrices[key]} min={1} max={sliderMax} step={0.5}
                    onChange={v => setConnTierPrice(key, v)} prefix="$" suffix="/conn/mo" />
                ))}
              </div>
            </Card>
            {[
              { title: "📄 Reports — Monthly Fee",     fields: [{ label: "Per report / month",    key: "perReportMonthly",     min:1,    max:50,  step:0.5,  pre:"$" }] },
              { title: "📄 Reports — Pay-Per-Use",     fields: [{ label: "Per report download",   key: "perReportUse",         min:0.10, max:5,   step:0.05, pre:"$" }] },
              { title: "📦 Report Packs",              fields: [{ label: "Reports per pack",      key: "reportPackSize",       min:5,    max:50,  step:5,    suf:" reports" }, { label:"Pack price", key:"reportPackPrice", min:10, max:200, step:5, pre:"$" }] },
              { title: "📊 Dashboards — Monthly Fee",  fields: [{ label: "Per dashboard / month", key: "perDashboardMonthly",  min:1,    max:50,  step:0.5,  pre:"$" }] },
              { title: "📊 Dashboards — Pay-Per-Use",  fields: [{ label: "Per dashboard view",    key: "perDashboardUse",      min:0.10, max:5,   step:0.05, pre:"$" }] },
              { title: "📦 Dashboard Packs",           fields: [{ label: "Dashboards per pack",   key: "dashPackSize",         min:5,    max:50,  step:5,    suf:" dashboards" }, { label:"Pack price", key:"dashPackPrice", min:10, max:200, step:5, pre:"$" }] },
              { title: "📋 Templates — Monthly Fee",   fields: [{ label: "Per template / month",  key: "perTemplateMonthly",   min:1,    max:100, step:0.5,  pre:"$" }] },
              { title: "📋 Templates — Pay-Per-Use",   fields: [{ label: "Per template use",      key: "perTemplateUse",       min:0.10, max:10,  step:0.1,  pre:"$" }] },
              { title: "📦 Template Packs",            fields: [{ label: "Templates per pack",    key: "templatePackSize",     min:1,    max:20,  step:1,    suf:" templates" }, { label:"Pack price", key:"templatePackPrice", min:10, max:300, step:5, pre:"$" }] },
              { title: "💰 Budgets Pro — Monthly Fee", fields: [{ label: "Budgets Pro / month",   key: "perBudgetsProMonthly", min:5,    max:200, step:1,    pre:"$" }] },
              { title: "💰 Budgets Pro — Pay-Per-Use", fields: [{ label: "Per Budgets Pro use",   key: "perBudgetsProUse",     min:0.50, max:20,  step:0.5,  pre:"$" }] },
              { title: "📦 Budgets Pro Packs",         fields: [{ label: "Uses per pack",         key: "budgetsProPackSize",   min:1,    max:20,  step:1,    suf:" uses" }, { label:"Pack price", key:"budgetsProPackPrice", min:10, max:500, step:5, pre:"$" }] },
            ].map(({ title, fields }) => (
              <Card key={title}>
                <h2 className="font-semibold text-gray-700 mb-3">{title}</h2>
                {fields.map(f => <Slider key={f.key} label={f.label} value={settings[f.key]} min={f.min} max={f.max} step={f.step} onChange={set(f.key)} prefix={f.pre||""} suffix={f.suf||""} />)}
              </Card>
            ))}
            <Card className="md:col-span-2 lg:col-span-3 border-2 border-indigo-200">
              <h2 className="font-semibold text-gray-700 mb-1">🏪 Marketplace</h2>
              <p className="text-xs text-gray-400 mb-4">Buyers pay a monthly subscription per listing. Reach earns a % of all subscription revenue.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8">
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">📄 Reports</p>
                  <Slider label="% of reports listed"         value={settings.mktReportSellPct}  min={0}  max={50}  step={0.5} onChange={set("mktReportSellPct")}  suffix="%" hint={"~" + Math.round(mktReportListings).toLocaleString() + " listings/mo"} />
                  <Slider label="Avg buyers per listing"      value={settings.mktReportBuyers}   min={1}  max={50}  step={1}   onChange={set("mktReportBuyers")}   suffix=" buyers" />
                  <Slider label="Monthly sub price per buyer" value={settings.mktReportSubPrice} min={1}  max={200} step={1}   onChange={set("mktReportSubPrice")} prefix="$" suffix="/mo" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">📊 Dashboards</p>
                  <Slider label="% of dashboards listed"      value={settings.mktDashSellPct}    min={0}  max={50}  step={0.5} onChange={set("mktDashSellPct")}    suffix="%" hint={"~" + Math.round(mktDashListings).toLocaleString() + " listings/mo"} />
                  <Slider label="Avg buyers per listing"      value={settings.mktDashBuyers}     min={1}  max={50}  step={1}   onChange={set("mktDashBuyers")}     suffix=" buyers" />
                  <Slider label="Monthly sub price per buyer" value={settings.mktDashSubPrice}   min={1}  max={500} step={5}   onChange={set("mktDashSubPrice")}   prefix="$" suffix="/mo" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">💸 Reach Commission</p>
                  <Slider label="Reach take rate" value={settings.marketplaceTake} min={5} max={40} step={1} onChange={set("marketplaceTake")} suffix="%" hint={"Reach earns " + settings.marketplaceTake + "% of all subscription revenue"} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">📊 Estimated Impact</p>
                  <div className="space-y-2">
                    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
                      <p className="font-semibold text-gray-600">Reports</p>
                      <p>{Math.round(mktReportListings).toLocaleString()} × {settings.mktReportBuyers} buyers × ${settings.mktReportSubPrice}/mo</p>
                      <p className="font-semibold text-indigo-600">= {fmt(mktReportGMV)} GMV/mo</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
                      <p className="font-semibold text-gray-600">Dashboards</p>
                      <p>{Math.round(mktDashListings).toLocaleString()} × {settings.mktDashBuyers} buyers × ${settings.mktDashSubPrice}/mo</p>
                      <p className="font-semibold text-indigo-600">= {fmt(mktDashGMV)} GMV/mo</p>
                    </div>
                    <div className="bg-indigo-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Total GMV / mo</p>
                      <p className="text-lg font-bold text-indigo-700">{fmt(mktGMV)}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500">Reach revenue / mo</p>
                      <p className="text-lg font-bold text-green-700">{fmt(mktReachRevMo)}</p>
                      <p className="text-xs text-gray-400">{fmt(mktReachRevMo*12)} / yr</p>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
            <Card className="md:col-span-2 lg:col-span-3">
              <div className="flex items-center justify-between">
                <div><h2 className="font-semibold text-gray-700">Reset All Settings</h2><p className="text-xs text-gray-400 mt-0.5">Restore all sliders and toggles to defaults</p></div>
                <button onClick={() => { setSettings(DEFAULT_SETTINGS); setHybrid(DEFAULT_HYBRID); }} className="px-4 py-2 bg-rose-50 text-rose-600 rounded-lg text-sm font-semibold hover:bg-rose-100 transition">Reset to Defaults</button>
              </div>
            </Card>
          </div>
        )}

        {/* ── HYBRID BUILDER ── */}
        {tab === "hybrid" && rev && (
          <div className="space-y-4">
            <div className="sticky top-0 z-20 bg-amber-50 border-2 border-amber-300 rounded-xl shadow-md p-4">
              <div className="flex flex-wrap items-center gap-6">
                <div><p className="text-xs text-amber-700 font-semibold">🧩 Hybrid MRR</p><p className="text-2xl font-bold text-gray-800">{fmt(rev.hybrid.mrr)}</p></div>
                <div><p className="text-xs text-gray-500">ARR</p><p className="text-xl font-bold text-gray-800">{fmt(rev.hybrid.mrr*12)}</p></div>
                <div><p className="text-xs text-gray-500">12-mo Cash Flow</p><p className="text-xl font-bold text-gray-800">{fmt(rev.hybrid.cash)}</p></div>
                <div><p className="text-xs text-gray-500">vs Current MRR</p><p className={"text-xl font-bold " + (rev.hybrid.mrr>=rev.baseline.mrr?"text-green-600":"text-rose-600")}>{fmt(rev.hybrid.mrr-rev.baseline.mrr)}</p></div>
                <div><p className="text-xs text-gray-500">vs Current ARR</p><p className={"text-xl font-bold " + (rev.hybrid.mrr>=rev.baseline.mrr?"text-green-600":"text-rose-600")}>{fmt((rev.hybrid.mrr-rev.baseline.mrr)*12)}</p></div>
                <div className="ml-auto">{pctDelta(rev.hybrid.mrr, rev.baseline.mrr)}</div>
              </div>
              {activeHybridLabels.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {activeHybridLabels.map(l => <span key={l} className="text-xs bg-amber-100 text-amber-800 rounded px-2 py-0.5">✓ {l}</span>)}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <Card>
                  <h2 className="font-semibold text-gray-700 mb-3 text-sm">Hybrid vs all scenarios (MRR)</h2>
                  <div className="space-y-2">
                    {[
                      { label: "Current Model",   val: rev.baseline.mrr, isH: false },
                      { label: "A: Monthly Fees", val: rev.scenA.mrr,    isH: false },
                      { label: "B: Pay-Per-Use",  val: rev.scenB.mrr,    isH: false },
                      { label: "C: Packs",        val: rev.scenC.mrr,    isH: false },
                      { label: "D: Marketplace",  val: rev.scenD.mrr,    isH: false },
                      { label: "🧩 Hybrid",       val: rev.hybrid.mrr,   isH: true  },
                    ].map(({ label, val, isH }) => {
                      const maxVal = Math.max(rev.baseline.mrr, rev.hybrid.mrr, rev.scenA.mrr, rev.scenB.mrr, rev.scenC.mrr, rev.scenD.mrr);
                      return (
                        <div key={label} className="flex items-center gap-2">
                          <span className="text-xs w-32 flex-shrink-0 text-gray-500">{label}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                            <div className={"h-4 rounded-full transition-all " + (isH?"bg-amber-400":"bg-indigo-400")} style={{ width: (maxVal>0?(val/maxVal*100).toFixed(1):0)+"%" }} />
                          </div>
                          <span className="text-xs font-semibold w-20 text-right flex-shrink-0">{fmt(val)}</span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
                <button onClick={() => setHybrid(DEFAULT_HYBRID)} className="w-full px-4 py-2 bg-rose-50 text-rose-600 rounded-lg text-sm font-semibold hover:bg-rose-100 transition">Reset Hybrid</button>
              </div>
              <div className="space-y-4">
                <Card>
                  <h2 className="font-semibold text-gray-700 mb-1">🔗 Connection Pricing <span className="text-xs font-normal text-gray-400">(choose one)</span></h2>
                  {[
                    { mode: "none",    label: "No connection base",                       hint: "Start from $0 — add-ons only" },
                    { mode: "current", label: "Keep current tiers (actual MRR from CSV)", hint: "Uses each customer's real MRR as the connection base" },
                    { mode: "flat",    label: "Per-connection flat ($" + settings.perConnectionPrice + "/conn/mo)", hint: "All connections × flat rate" },
                    { mode: "tiered",  label: "Cumulative tiered ($" + settings.connTierPrices[10] + "/conn at 11–25, $" + settings.connTierPrices[25] + "/conn at 26–50…)", hint: "Edit rates in Settings" },
                  ].map(({ mode, label, hint }) => (
                    <label key={mode} className={"flex items-start gap-3 p-3 rounded-lg cursor-pointer border transition mb-2 " + (hybrid.connMode===mode ? "bg-indigo-50 border-indigo-300" : "bg-gray-50 border-gray-200 hover:bg-gray-100")}>
                      <input type="radio" name="connMode" value={mode} checked={hybrid.connMode===mode} onChange={() => setH("connMode")(mode)} className="mt-0.5 accent-indigo-600 w-4 h-4 flex-shrink-0" />
                      <div>
                        <p className={"text-sm font-medium " + (hybrid.connMode===mode ? "text-indigo-700" : "text-gray-600")}>{label}</p>
                        <p className="text-xs text-gray-400">{hint}</p>
                      </div>
                    </label>
                  ))}
                </Card>
                <Card>
                  <h2 className="font-semibold text-gray-700 mb-1">📄 Reports <span className="text-xs font-normal text-gray-400">(choose one)</span></h2>
                  <Toggle label={"Monthly fee ($" + settings.perReportMonthly + "/report/mo)"}   checked={hybrid.useReportMonthly}   onChange={v => { setH("useReportMonthly")(v);   if(v){setH("useReportPayPerUse")(false);setH("useReportPacks")(false);}}} />
                  <Toggle label={"Pay-per-use ($" + settings.perReportUse + "/download)"}         checked={hybrid.useReportPayPerUse} onChange={v => { setH("useReportPayPerUse")(v); if(v){setH("useReportMonthly")(false);setH("useReportPacks")(false);}}} />
                  <Toggle label={"Packs (" + settings.reportPackSize + " for $" + settings.reportPackPrice + ")"} checked={hybrid.useReportPacks} onChange={v => { setH("useReportPacks")(v); if(v){setH("useReportMonthly")(false);setH("useReportPayPerUse")(false);}}} />
                </Card>
                <Card>
                  <h2 className="font-semibold text-gray-700 mb-1">📊 Dashboards <span className="text-xs font-normal text-gray-400">(choose one)</span></h2>
                  <Toggle label={"Monthly fee ($" + settings.perDashboardMonthly + "/dashboard/mo)"} checked={hybrid.useDashMonthly}   onChange={v => { setH("useDashMonthly")(v);   if(v){setH("useDashPayPerUse")(false);setH("useDashPacks")(false);}}} />
                  <Toggle label={"Pay-per-use ($" + settings.perDashboardUse + "/publish)"}           checked={hybrid.useDashPayPerUse} onChange={v => { setH("useDashPayPerUse")(v); if(v){setH("useDashMonthly")(false);setH("useDashPacks")(false);}}} />
                  <Toggle label={"Packs (" + settings.dashPackSize + " for $" + settings.dashPackPrice + ")"} checked={hybrid.useDashPacks} onChange={v => { setH("useDashPacks")(v); if(v){setH("useDashMonthly")(false);setH("useDashPayPerUse")(false);}}} />
                </Card>
                <Card>
                  <h2 className="font-semibold text-gray-700 mb-1">📋 Templates <span className="text-xs font-normal text-gray-400">(choose one)</span></h2>
                  <Toggle label={"Monthly fee ($" + settings.perTemplateMonthly + "/template/mo)"}  checked={hybrid.useTemplateMonthly}    onChange={v => { setH("useTemplateMonthly")(v);    if(v){setH("useTemplatePayPerUse")(false);setH("useTemplatePacks")(false);}}} />
                  <Toggle label={"Pay-per-use ($" + settings.perTemplateUse + "/use)"}               checked={hybrid.useTemplatePayPerUse}  onChange={v => { setH("useTemplatePayPerUse")(v);  if(v){setH("useTemplateMonthly")(false);setH("useTemplatePacks")(false);}}} />
                  <Toggle label={"Packs (" + settings.templatePackSize + " for $" + settings.templatePackPrice + ")"} checked={hybrid.useTemplatePacks} onChange={v => { setH("useTemplatePacks")(v); if(v){setH("useTemplateMonthly")(false);setH("useTemplatePayPerUse")(false);}}} />
                </Card>
                <Card>
                  <h2 className="font-semibold text-gray-700 mb-1">💰 Budgets Pro <span className="text-xs font-normal text-gray-400">(choose one)</span></h2>
                  <Toggle label={"Monthly fee ($" + settings.perBudgetsProMonthly + "/mo)"}         checked={hybrid.useBudgetsProMonthly}    onChange={v => { setH("useBudgetsProMonthly")(v);    if(v){setH("useBudgetsProPayPerUse")(false);setH("useBudgetsProPacks")(false);}}} />
                  <Toggle label={"Pay-per-use ($" + settings.perBudgetsProUse + "/use)"}             checked={hybrid.useBudgetsProPayPerUse}  onChange={v => { setH("useBudgetsProPayPerUse")(v);  if(v){setH("useBudgetsProMonthly")(false);setH("useBudgetsProPacks")(false);}}} />
                  <Toggle label={"Packs (" + settings.budgetsProPackSize + " for $" + settings.budgetsProPackPrice + ")"} checked={hybrid.useBudgetsProPacks} onChange={v => { setH("useBudgetsProPacks")(v); if(v){setH("useBudgetsProMonthly")(false);setH("useBudgetsProPayPerUse")(false);}}} />
                </Card>
                <Card>
                  <h2 className="font-semibold text-gray-700 mb-1">🏪 Marketplace</h2>
                  <p className="text-xs text-gray-400 mb-2">Est. {fmt(mktReachRevMo)}/mo Reach revenue at current settings. <button onClick={() => setTab("settings")} className="text-indigo-500 underline text-xs">Edit in Settings →</button></p>
                  <Toggle label="Enable marketplace revenue" checked={hybrid.useMarketplace} onChange={setH("useMarketplace")} hint="Subscription revenue from customers selling reports & dashboards" />
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ── FORECAST ── */}
        {tab === "forecast" && (
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 min-w-0 space-y-6">
              <div className="flex flex-wrap gap-2">
                {Object.entries(FORECAST_LABELS).map(([k, label]) => (
                  <button key={k} onClick={() => setForecastScenarios(s => ({ ...s, [k]: !s[k] }))}
                    className={"px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition " + (forecastScenarios[k] ? "text-white border-transparent" : "bg-white border-gray-300 text-gray-500")}
                    style={forecastScenarios[k] ? { backgroundColor: FORECAST_COLORS[k], borderColor: FORECAST_COLORS[k] } : {}}>
                    {label}
                  </button>
                ))}
              </div>
              <Card>
                <h2 className="font-semibold text-gray-700 mb-4 text-sm">{forecastView === "arr" ? "ARR" : "MRR"} by Customer Count</h2>
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={chartData} margin={{ top:5, right:20, left:10, bottom:5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="count" tickFormatter={v => v>=1000?(v/1000).toFixed(1)+"k":v} tick={{ fontSize:10 }} interval="preserveStartEnd" />
                    <YAxis tickFormatter={fmtK} tick={{ fontSize:11 }} width={70} />
                    <Tooltip content={<ForecastTooltip />} />
                    <Legend formatter={v => FORECAST_LABELS[v]||v} wrapperStyle={{ fontSize:12 }} />
                    {Object.entries(forecastScenarios).filter(([,v])=>v).map(([k]) => (
                      <Line key={k} type="monotone" dataKey={k} name={k} stroke={FORECAST_COLORS[k]}
                        strokeWidth={k==="hybrid"?3:2} strokeDasharray={k==="current"?"5 3":undefined}
                        dot={false} activeDot={{ r:5 }} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Card>
              {forecastScenarios.current && forecastScenarios.hybrid && (
                <Card>
                  <h2 className="font-semibold text-gray-700 mb-1 text-sm">Hybrid {forecastView==="arr"?"ARR":"MRR"} Lift vs Current Model</h2>
                  <p className="text-xs text-gray-400 mb-4">Additional revenue at each customer milestone</p>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={chartData} margin={{ top:5, right:20, left:10, bottom:5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="count" tickFormatter={v => v>=1000?(v/1000).toFixed(1)+"k":v} tick={{ fontSize:10 }} interval="preserveStartEnd" />
                      <YAxis tickFormatter={fmtK} tick={{ fontSize:11 }} width={70} />
                      <Tooltip formatter={v=>[fmtK(v),"Hybrid lift"]} labelFormatter={l=>Number(l).toLocaleString()+" customers"} />
                      <Bar dataKey={r=>(r.hybrid||0)-(r.current||0)} name="Hybrid lift" fill="#f59e0b" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )}
              <Card>
                <h2 className="font-semibold text-gray-700 mb-3 text-sm">Forecast Detail Table</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b text-left">
                        <th className="pb-2 pr-3">Customers</th>
                        {Object.entries(forecastScenarios).filter(([,v])=>v).map(([k]) => (
                          <th key={k} className="pb-2 pr-3 whitespace-nowrap" style={{ color:FORECAST_COLORS[k] }}>{FORECAST_LABELS[k]}</th>
                        ))}
                        {forecastScenarios.current && forecastScenarios.hybrid && <>
                          <th className="pb-2 pr-3 text-amber-600">Hybrid Lift</th>
                          <th className="pb-2 text-amber-600">Lift %</th>
                        </>}
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.map((row, i) => {
                        const lift    = (row.hybrid||0)-(row.current||0);
                        const liftPct = row.current ? ((lift/row.current)*100).toFixed(1) : null;
                        return (
                          <tr key={row.count} className={"border-b last:border-0 " + (i===0?"bg-indigo-50":"")}>
                            <td className="py-1.5 pr-3 font-semibold text-gray-700 whitespace-nowrap text-xs">
                              {row.count.toLocaleString()}
                              {i===0 && <span className="ml-1 text-xs bg-indigo-200 text-indigo-700 px-1 py-0.5 rounded">now</span>}
                            </td>
                            {Object.entries(forecastScenarios).filter(([,v])=>v).map(([k]) => (
                              <td key={k} className="py-1.5 pr-3 font-mono text-xs" style={{ color:FORECAST_COLORS[k] }}>{fmtK(row[k]||0)}</td>
                            ))}
                            {forecastScenarios.current && forecastScenarios.hybrid && <>
                              <td className={"py-1.5 pr-3 font-bold text-xs " + (lift>=0?"text-green-600":"text-rose-600")}>{lift>=0?"+":""}{fmtK(lift)}</td>
                              <td className={"py-1.5 font-bold text-xs " + (Number(liftPct)>=0?"text-green-600":"text-rose-600")}>
                                {liftPct ? (Number(liftPct)>=0?"▲":"▼")+" "+Math.abs(liftPct)+"%" : "—"}
                              </td>
                            </>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-indigo-800 mb-1">📌 How forecasts are calculated</h3>
                <p className="text-xs text-indigo-700 leading-relaxed">Each scenario proportionally scales your actual {data.length.toLocaleString()} customers — preserving tier mix, billing split, connection distribution, and usage averages. Forecasts run to 5,000 customers in 250-customer increments.</p>
              </div>
            </div>
            <div className="w-full lg:w-60 sticky top-4 self-start space-y-3">
              <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-800 mb-1">🧩 Hybrid drives this forecast</p>
                <p className="text-xs text-amber-700 mb-3">Configure your model in the Hybrid Builder — changes reflect here instantly.</p>
                <button onClick={() => setTab("hybrid")} className="w-full py-2 bg-amber-400 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition">Go to Hybrid Builder →</button>
              </div>
              {activeHybridLabels.length > 0 ? (
                <div className="bg-white border border-gray-200 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-600 mb-2">Active hybrid options:</p>
                  {activeHybridLabels.map(l => <p key={l} className="text-xs text-gray-500 mb-0.5">✓ {l}</p>)}
                </div>
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <p className="text-xs text-gray-400">No hybrid options active.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── SEGMENTS ── */}
        {tab === "segments" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <h2 className="font-semibold text-gray-700 mb-3">Customers by Tenure</h2>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-gray-500 border-b text-left"><th className="pb-2">Tenure</th><th className="pb-2">Customers</th><th className="pb-2">Avg MRR</th></tr></thead>
                <tbody>
                  {[["0–6 mo",0,6],["7–12 mo",7,12],["13–24 mo",13,24],["25+ mo",25,9999]].map(([label,lo,hi]) => {
                    const g = data.filter(c => c.months>=lo && c.months<=hi);
                    return <tr key={label} className="border-b last:border-0"><td className="py-1.5">{label}</td><td className="py-1.5">{g.length}</td><td className="py-1.5">{fmt(g.reduce((a,c)=>a+c.mrr,0)/Math.max(g.length,1))}</td></tr>;
                  })}
                </tbody>
              </table>
            </Card>
            <Card>
              <h2 className="font-semibold text-gray-700 mb-3">Monthly vs Annual Billing</h2>
              {["monthly","annual"].map(bt => {
                const g = data.filter(c => c.billing===bt);
                return (
                  <div key={bt} className="mb-4">
                    <div className="flex justify-between text-sm mb-1"><span className="capitalize font-medium">{bt}</span><span className="text-gray-500">{g.length} · {fmt(g.reduce((a,c)=>a+c.mrr,0))} MRR</span></div>
                    <div className="w-full bg-gray-100 rounded-full h-3"><div className="h-3 rounded-full bg-indigo-500" style={{ width:(g.length/data.length*100).toFixed(1)+"%" }} /></div>
                    <p className="text-xs text-gray-400 mt-0.5">{(g.length/data.length*100).toFixed(1)}% of customers</p>
                  </div>
                );
              })}
            </Card>
            {[
              { label:"Report Usage / mo",      field:"reportsPerMonth"    },
              { label:"Dashboard Usage / mo",   field:"dashPerMonth"       },
              { label:"Template Usage / mo",    field:"templatesPerMonth"  },
              { label:"Budgets Pro Usage / mo", field:"budgetsProPerMonth" },
            ].map(({ label, field }) => (
              <Card key={field}>
                <h2 className="font-semibold text-gray-700 mb-3">{label}</h2>
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-500 border-b text-left"><th className="pb-2">Range</th><th className="pb-2">Customers</th><th className="pb-2">%</th></tr></thead>
                  <tbody>
                    {[[0,0.009,"0"],[0.01,0.999,"<1"],[1,4.999,"1–5"],[5,19.999,"5–20"],[20,99999,"20+"]].map(([lo,hi,lbl]) => {
                      const g = data.filter(c => c[field]>=lo && c[field]<=hi);
                      return <tr key={lbl} className="border-b last:border-0"><td className="py-1.5">{lbl}</td><td className="py-1.5">{g.length}</td><td className="py-1.5">{(g.length/data.length*100).toFixed(1)}%</td></tr>;
                    })}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        )}

        {/* ── RECOMMENDATION ── */}
        {tab === "recommendation" && rev && (() => {
          const totalConn=data.reduce((a,c)=>a+c.connections,0), totalRepMo=data.reduce((a,c)=>a+c.reportsPerMonth,0);
          const totalDashMo=data.reduce((a,c)=>a+c.dashPerMonth,0), totalTmplMo=data.reduce((a,c)=>a+c.templatesPerMonth,0);
          const totalBProMo=data.reduce((a,c)=>a+c.budgetsProPerMonth,0), totalDlMo=data.reduce((a,c)=>a+c.downloadsPerMonth,0);
          const totalPubMo=data.reduce((a,c)=>a+c.dashPublishedPerMonth,0), target=totalMrr;
          const shares={conn:0.45,rep:0.20,dash:0.12,tmpl:0.12,bpro:0.06,mkt:0.05};
          const connRevTarget=target*shares.conn,repRevTarget=target*shares.rep,dashRevTarget=target*shares.dash;
          const tmplRevTarget=target*shares.tmpl,bproRevTarget=target*shares.bpro;
          const impliedConnFlat=totalConn>0?connRevTarget/totalConn:0;
          const impliedRepMo=totalRepMo>0?repRevTarget/totalRepMo:0, impliedDashMo=totalDashMo>0?dashRevTarget/totalDashMo:0;
          const impliedTmplMo=totalTmplMo>0?tmplRevTarget/totalTmplMo:0, impliedBProMo=totalBProMo>0?bproRevTarget/totalBProMo:0;
          const impliedRepUse=totalDlMo>0?repRevTarget/totalDlMo:0, impliedDashUse=totalPubMo>0?dashRevTarget/totalPubMo:0;
          const avgRepPerCust=totalRepMo/data.length, avgDashPerCust=totalDashMo/data.length;
          const avgTmplPerCust=totalTmplMo/data.length, avgBProPerCust=totalBProMo/data.length;
          const sugRep=Math.max(5,Math.round(avgRepPerCust*1.5/5)*5), sugDash=Math.max(5,Math.round(avgDashPerCust*1.5/5)*5);
          const sugTmpl=Math.max(3,Math.round(avgTmplPerCust*1.5/3)*3), sugBPro=Math.max(3,Math.round(avgBProPerCust*1.5/3)*3);
          const impliedRepPackPrice=totalRepMo>0?repRevTarget/(totalRepMo/sugRep):0;
          const impliedDashPackPrice=totalDashMo>0?dashRevTarget/(totalDashMo/sugDash):0;
          const impliedTmplPackPrice=totalTmplMo>0?tmplRevTarget/(totalTmplMo/sugTmpl):0;
          const impliedBProPackPrice=totalBProMo>0?bproRevTarget/(totalBProMo/sugBPro):0;
          const tierMults={1:1.4,10:1.2,25:1.0,50:0.85,100:0.70,200:0.58,300:0.48};
          const wtAvgMult=data.reduce((a,c)=>{ const k=c.connections<=1?1:c.connections<=10?10:c.connections<=25?25:c.connections<=50?50:c.connections<=100?100:c.connections<=200?200:300; return a+tierMults[k]; },0)/data.length;
          const impliedBaseConn=wtAvgMult>0?impliedConnFlat/wtAvgMult:impliedConnFlat;
          const tieredPrices=Object.fromEntries(Object.entries(tierMults).map(([k,m])=>[k,impliedBaseConn*m]));
          const disc=1-settings.annualDiscount/100;
          const calcMrrFor=fn=>data.reduce((sum,c)=>{ const b=fn(c); return sum+(c.billing==="annual"?b*disc:b); },0);
          const mrrFlatConn=calcMrrFor(c=>calcConnPriceWithRates(c.connections,{1:149,10:impliedConnFlat,25:impliedConnFlat,50:impliedConnFlat,100:impliedConnFlat,200:impliedConnFlat,300:impliedConnFlat})+c.reportsPerMonth*impliedRepMo+c.dashPerMonth*impliedDashMo+c.templatesPerMonth*impliedTmplMo+c.budgetsProPerMonth*impliedBProMo);
          const mrrTieredConn=calcMrrFor(c=>calcConnPriceWithRates(c.connections,tieredPrices)+c.reportsPerMonth*impliedRepMo+c.dashPerMonth*impliedDashMo+c.templatesPerMonth*impliedTmplMo+c.budgetsProPerMonth*impliedBProMo);
          const mrrPayPerUse=calcMrrFor(c=>c.connections*impliedConnFlat+c.downloadsPerMonth*impliedRepUse+c.dashPublishedPerMonth*impliedDashUse+c.templatesPerMonth*impliedTmplMo+c.budgetsProPerMonth*impliedBProMo);
          const mrrPacks=calcMrrFor(c=>c.connections*impliedConnFlat+Math.ceil(c.reportsPerMonth/sugRep)*impliedRepPackPrice+Math.ceil(c.dashPerMonth/sugDash)*impliedDashPackPrice+Math.ceil(c.templatesPerMonth/sugTmpl)*impliedTmplPackPrice+Math.ceil(c.budgetsProPerMonth/sugBPro)*impliedBProPackPrice);
          const Row=({label,value,note})=>(<tr className="border-b last:border-0"><td className="py-2 text-sm font-medium text-gray-700">{label}</td><td className="py-2 text-sm font-bold text-indigo-700">{value}</td><td className="py-2 text-xs text-gray-400">{note}</td></tr>);
          const AccuracyBadge=({mrr})=>{ const diff=Math.abs(mrr-target)/target*100; return <span className={"text-xs font-bold px-2 py-0.5 rounded "+(diff<2?"bg-green-100 text-green-700":diff<5?"bg-amber-100 text-amber-700":"bg-rose-100 text-rose-700")}>{diff<0.1?"Exact match":diff.toFixed(1)+"% off target"}</span>; };
          return (
            <div className="space-y-6">
              <Card className="border-2 border-indigo-200">
                <h2 className="font-semibold text-gray-800 mb-1">💡 Revenue-Neutral A La Carte Recommendation</h2>
                <p className="text-xs text-gray-500 mb-3">Based on {data.length.toLocaleString()} customers and current MRR of <strong>{fmt(target)}</strong>. Split: <strong>45% connections · 20% reports · 12% dashboards · 12% templates · 6% Budgets Pro · 5% marketplace</strong>.</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <MetricBox label="Target MRR"         value={fmt(target)}               color="indigo"/>
                  <MetricBox label="Total Connections"  value={totalConn.toLocaleString()} color="indigo"/>
                  <MetricBox label="Avg Reports/mo"     value={fmtD(avgRepPerCust)}        color="indigo"/>
                  <MetricBox label="Avg Templates/mo"   value={fmtD(avgTmplPerCust)}       color="indigo"/>
                  <MetricBox label="Avg Budgets Pro/mo" value={fmtD(avgBProPerCust)}       color="indigo"/>
                </div>
              </Card>
              {[
                {title:"Option 1 — Flat Per-Connection + Monthly Fees",desc:"Simplest structure.",mrr:mrrFlatConn,rows:[{label:"Per connection / mo",value:"$"+impliedConnFlat.toFixed(2),note:"× "+totalConn.toLocaleString()+" connections"},{label:"Per report / mo",value:"$"+impliedRepMo.toFixed(2),note:"× "+fmtD(avgRepPerCust)+" avg/mo"},{label:"Per dashboard / mo",value:"$"+impliedDashMo.toFixed(2),note:"× "+fmtD(avgDashPerCust)+" avg/mo"},{label:"Per template / mo",value:"$"+impliedTmplMo.toFixed(2),note:"× "+fmtD(avgTmplPerCust)+" avg/mo"},{label:"Budgets Pro / mo",value:"$"+impliedBProMo.toFixed(2),note:"× "+fmtD(avgBProPerCust)+" avg/mo"}]},
                {title:"Option 2 — Tiered Per-Connection + Monthly Fees",desc:"Volume discount on connections.",mrr:mrrTieredConn,rows:[...CONN_TIER_DEFS.map(({label,key})=>({label:label+" / conn / mo",value:"$"+tieredPrices[key].toFixed(2),note:""})),{label:"Per report / mo",value:"$"+impliedRepMo.toFixed(2),note:"× "+fmtD(avgRepPerCust)+" avg/mo"},{label:"Per dashboard / mo",value:"$"+impliedDashMo.toFixed(2),note:"× "+fmtD(avgDashPerCust)+" avg/mo"},{label:"Per template / mo",value:"$"+impliedTmplMo.toFixed(2),note:"× "+fmtD(avgTmplPerCust)+" avg/mo"},{label:"Budgets Pro / mo",value:"$"+impliedBProMo.toFixed(2),note:"× "+fmtD(avgBProPerCust)+" avg/mo"}]},
                {title:"Option 3 — Flat Per-Connection + Pay-Per-Use",desc:"Usage-based model.",mrr:mrrPayPerUse,rows:[{label:"Per connection / mo",value:"$"+impliedConnFlat.toFixed(2),note:"× "+totalConn.toLocaleString()+" connections"},{label:"Per report download",value:"$"+impliedRepUse.toFixed(2),note:"× "+fmtD(totalDlMo/data.length)+" avg downloads/mo"},{label:"Per dashboard publish",value:"$"+impliedDashUse.toFixed(2),note:"× "+fmtD(totalPubMo/data.length)+" avg publishes/mo"},{label:"Per template use",value:"$"+impliedTmplMo.toFixed(2),note:"× "+fmtD(avgTmplPerCust)+" avg/mo"},{label:"Budgets Pro use",value:"$"+impliedBProMo.toFixed(2),note:"× "+fmtD(avgBProPerCust)+" avg/mo"}]},
                {title:"Option 4 — Flat Per-Connection + Packs",desc:"Bundle pricing.",mrr:mrrPacks,rows:[{label:"Per connection / mo",value:"$"+impliedConnFlat.toFixed(2),note:"× "+totalConn.toLocaleString()+" connections"},{label:"Report pack ("+sugRep+" reports)",value:"$"+impliedRepPackPrice.toFixed(2),note:"Avg "+fmtD(avgRepPerCust)+" reports/mo"},{label:"Dashboard pack ("+sugDash+" dashboards)",value:"$"+impliedDashPackPrice.toFixed(2),note:"Avg "+fmtD(avgDashPerCust)+" dashboards/mo"},{label:"Template pack ("+sugTmpl+" templates)",value:"$"+impliedTmplPackPrice.toFixed(2),note:"Avg "+fmtD(avgTmplPerCust)+" templates/mo"},{label:"Budgets Pro pack ("+sugBPro+" uses)",value:"$"+impliedBProPackPrice.toFixed(2),note:"Avg "+fmtD(avgBProPerCust)+" uses/mo"}]},
              ].map(({title,desc,mrr,rows})=>(
                <Card key={title}>
                  <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-gray-700">{title}</h3><AccuracyBadge mrr={mrr}/></div>
                  <p className="text-xs text-gray-400 mb-3">{desc}</p>
                  <table className="w-full"><thead><tr className="text-xs text-gray-400 border-b text-left"><th className="pb-1">Component</th><th className="pb-1">Suggested Price</th><th className="pb-1">Basis</th></tr></thead><tbody>{rows.map(r=><Row key={r.label} {...r}/>)}</tbody></table>
                  <div className="mt-3 pt-3 border-t flex justify-between text-sm"><span className="text-gray-500">Projected MRR</span><span className="font-bold text-gray-800">{fmt(mrr)} <span className="text-xs text-gray-400">({((mrr/target-1)*100).toFixed(1)}% vs target)</span></span></div>
                </Card>
              ))}
              <Card className="bg-indigo-50 border border-indigo-200">
                <h3 className="font-semibold text-indigo-800 mb-2">📌 Summary Recommendation</h3>
                <p className="text-sm text-indigo-700 leading-relaxed">For <strong>2+ connection customers</strong>, <strong>Option 2 (Tiered Per-Connection + Monthly Fees)</strong> is the strongest starting point. Price <strong>templates higher than reports</strong> and <strong>Budgets Pro as a premium add-on</strong>. Layer in the <strong>Marketplace</strong> as net-new revenue. Use the <strong>Hybrid Builder</strong> to fine-tune.</p>
              </Card>
            </div>
          );
        })()}

        {/* ── RECONCILIATION ── */}
        {tab === "reconciliation" && reconTotals && (
          <div className="space-y-5">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-1">🔍 Pricing logic</p>
              <p className="text-xs text-amber-700">1 connection = $149 flat. 2–10 connections = $290 flat. 11+ connections = all connections × the rate of the last completed tier (e.g. 18 conns = 18 × $29 = $522, 30 conns = 30 × $22 = $660). Annual customers receive a {settings.annualDiscount}% discount.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <MetricBox label="Actual MRR"    value={fmt(reconTotals.actMrr)}  color="indigo" />
              <MetricBox label="Calc MRR"      value={fmt(reconTotals.calcMrr)} color="amber" />
              <MetricBox label="Total Gap"     value={(reconTotals.diff>=0?"+":"")+fmt(reconTotals.diff)} color={reconTotals.diff>=0?"green":"rose"} />
              <MetricBox label="Calc > Actual" value={reconTotals.over+" customers"}  color="rose" />
              <MetricBox label="Calc < Actual" value={reconTotals.under+" customers"} color="amber" />
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex gap-1">
                {[
                  {key:"all",   label:"All ("+data.length+")"},
                  {key:"over",  label:"Calc > Actual ("+reconTotals.over+")"},
                  {key:"under", label:"Calc < Actual ("+reconTotals.under+")"},
                  {key:"exact", label:"Match ("+reconTotals.exact+")"},
                ].map(({key,label}) => (
                  <button key={key} onClick={() => { setReconFilter(key); setReconPage(0); }}
                    className={"px-3 py-1.5 rounded-lg text-xs font-semibold transition "+(reconFilter===key?"bg-indigo-600 text-white":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50")}>
                    {label}
                  </button>
                ))}
              </div>
              <input type="text" placeholder="Search by Customer ID…" value={reconSearch}
                onChange={e => { setReconSearch(e.target.value); setReconPage(0); }}
                className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-indigo-300 w-52" />
            </div>
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr className="text-xs text-gray-500">
                      {[
                        {col:null,         label:"Customer ID"},
                        {col:"connections",label:"Connections"},
                        {col:null,         label:"Billing"},
                        {col:null,         label:"Calc Base"},
                        {col:"mrr",        label:"Actual MRR"},
                        {col:"calcMrr",    label:"Calc MRR"},
                        {col:"diff",       label:"Difference"},
                        {col:"diffPct",    label:"Diff %"},
                      ].map(({col,label}) => (
                        <th key={label} onClick={() => col && toggleReconSort(col)}
                          className={"text-left px-4 py-3 font-semibold whitespace-nowrap "+(col?"cursor-pointer hover:text-indigo-600 select-none":"")}>
                          {label}{col && (reconSort.col===col?(reconSort.dir==="desc"?" ▼":" ▲"):" ↕")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reconPageRows.map((r, i) => {
                      const isOver  = r.diff >  0.01;
                      const isUnder = r.diff < -0.01;
                      const rowBg   = isOver ? "bg-rose-50" : isUnder ? "bg-amber-50" : "hover:bg-gray-50";
                      const diffColor = isOver ? "text-rose-600" : isUnder ? "text-amber-700" : "text-gray-400";
                      const base    = calcConnPrice(r.connections);
                      const calcBase = r.connections <= 1 ? "$149 flat"
                        : r.connections <= 10 ? "$290 flat"
                        : r.connections + " × $" + fmtD(base / r.connections) + " = " + fmt(base);
                      return (
                        <tr key={String(r.id)+"-"+i} className={"border-b last:border-0 text-xs "+rowBg}>
                          <td className="px-4 py-2.5 font-mono text-gray-700">{r.id}</td>
                          <td className="px-4 py-2.5 font-semibold">{r.connections}</td>
                          <td className="px-4 py-2.5">
                            <span className={"px-1.5 py-0.5 rounded text-xs font-medium "+(r.billing==="annual"?"bg-purple-100 text-purple-700":"bg-gray-100 text-gray-600")}>{r.billing}</span>
                          </td>
                          <td className="px-4 py-2.5 text-gray-500">{calcBase}</td>
                          <td className="px-4 py-2.5 font-mono text-indigo-700">{fmt(r.mrr)}</td>
                          <td className="px-4 py-2.5 font-mono text-amber-700">{fmt(r.calcMrr)}</td>
                          <td className={"px-4 py-2.5 font-bold font-mono "+diffColor}>{r.diff>=0?"+":""}{fmt(r.diff)}</td>
                          <td className="px-4 py-2.5">
                            {r.diffPct !== null
                              ? <span className={"px-2 py-0.5 rounded font-semibold text-xs "+(Math.abs(r.diffPct)<1?"bg-gray-100 text-gray-500":isOver?"bg-rose-100 text-rose-700":"bg-amber-100 text-amber-700")}>{r.diffPct>=0?"+":""}{r.diffPct.toFixed(1)}%</span>
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {reconPageRows.length === 0 && (
                      <tr><td colSpan="8" className="px-4 py-8 text-center text-gray-400 text-sm">No customers match this filter</td></tr>
                    )}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="text-xs font-bold text-gray-700">
                      <td className="px-4 py-2.5" colSpan="4">{reconFilter!=="all"?"Filtered total ("+reconSorted.length+" customers)":"All "+data.length+" customers"}</td>
                      <td className="px-4 py-2.5 font-mono text-indigo-700">{fmt(filteredActMrr)}</td>
                      <td className="px-4 py-2.5 font-mono text-amber-700">{fmt(filteredCalcMrr)}</td>
                      <td className={"px-4 py-2.5 font-mono "+(filteredDiff>=0?"text-rose-600":"text-amber-700")}>{filteredDiff>=0?"+":""}{fmt(filteredDiff)}</td>
                      <td className="px-4 py-2.5"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            {reconTotalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Showing {reconPage*RECON_PAGE_SIZE+1}–{Math.min((reconPage+1)*RECON_PAGE_SIZE,reconSorted.length)} of {reconSorted.length}</span>
                <div className="flex gap-1">
                  <button onClick={() => setReconPage(0)}               disabled={reconPage===0}                className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100">«</button>
                  <button onClick={() => setReconPage(p=>p-1)}          disabled={reconPage===0}                className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100">‹</button>
                  {Array.from({length:Math.min(5,reconTotalPages)}).map((_,i) => {
                    const p = Math.min(Math.max(reconPage-2+i,0),reconTotalPages-1);
                    return <button key={p} onClick={() => setReconPage(p)} className={"px-2.5 py-1 rounded border text-xs "+(p===reconPage?"bg-indigo-600 text-white border-indigo-600":"hover:bg-gray-100")}>{p+1}</button>;
                  })}
                  <button onClick={() => setReconPage(p=>p+1)}          disabled={reconPage>=reconTotalPages-1} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100">›</button>
                  <button onClick={() => setReconPage(reconTotalPages-1)} disabled={reconPage>=reconTotalPages-1} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100">»</button>
                </div>
                <span>Page {reconPage+1} of {reconTotalPages}</span>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}