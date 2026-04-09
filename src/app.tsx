import { useState, useCallback, useRef, useMemo } from "react";
import Papa from "papaparse";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const PASSWORD = "reach2026";
const INTEGRATIONS = ["QBO","QBD","Xero","CSV","Gusto","Excel","Google Sheets"];

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
  { label: "1",       key: 1,   sliderMax: 150 },
  { label: "2–10",    key: 10,  sliderMax: 100 },
  { label: "11–24",   key: 25,  sliderMax: 100 },
  { label: "25–49",   key: 50,  sliderMax: 100 },
  { label: "50–99",   key: 100, sliderMax: 100 },
  { label: "100–199", key: 200, sliderMax: 100 },
  { label: "200–299", key: 300, sliderMax: 100 },
];

const FORECAST_COUNTS = [1639, ...Array.from({ length: Math.ceil((5000 - 1750) / 250) + 1 }, (_, i) => 1750 + i * 250)];
const DEFAULT_INTG_TIER_PRICES = { 1: 15, 10: 12, 25: 10, 50: 8, 100: 7, 200: 6, 300: 5 };

const DEFAULT_SETTINGS = {
  annualDiscount: 30,
  perConnectionPrice: 10,
  connTierPrices: { 1: 149, 10: 29, 25: 22, 50: 19, 100: 17, 200: 15.30, 300: 14 },
  intgFlatPrices: Object.fromEntries(INTEGRATIONS.map(k => [k, 10])),
  intgTierPrices: Object.fromEntries(INTEGRATIONS.map(k => [k, {...DEFAULT_INTG_TIER_PRICES}])),
  perReportMonthly: 5, perReportUse: 0.50, reportPackSize: 10, reportPackPrice: 40,
  perDashboardMonthly: 8, perDashboardUse: 0.75, dashPackSize: 10, dashPackPrice: 60,
  perTemplateMonthly: 10, templatePackSize: 5, templatePackPrice: 40,
  perBudgetsProMonthly: 20, budgetsProPackSize: 5, budgetsProPackPrice: 75,
  marketplaceTake: 10,
  mktReportSellPct: 5, mktDashSellPct: 5,
  mktReportSubPrice: 15, mktDashSubPrice: 25,
  mktReportBuyerPct: 10, mktDashBuyerPct: 10,
};

const DEFAULT_HYBRID = {
  connMode: "tiered",
  intgModes: Object.fromEntries(INTEGRATIONS.map(k => [k, "none"])),
  useReportMonthly: false, useReportPayPerUse: false, useReportPacks: false,
  useDashMonthly: false, useDashPayPerUse: false, useDashPacks: false,
  useTemplateMonthly: false, useTemplatePacks: false,
  useBudgetsProMonthly: false, useBudgetsProPacks: false,
  useMarketplace: false,
};

const R = {
  primary: "#00B4D8", primaryDark: "#0096B7", primaryDeep: "#023E8A",
  primaryLight: "#E0F7FC", primaryLighter: "#F0FAFF", primaryText: "#005F73",
};
const INTG_COLOR = "#7c3aed";

function col(row, name) {
  if (row[name] !== undefined) return row[name];
  const lower = name.toLowerCase().replace(/\s+/g, ' ');
  for (const k of Object.keys(row)) {
    if (k.toLowerCase().replace(/\s+/g, ' ') === lower) return row[k];
  }
  return undefined;
}
function getNum(row, name) {
  const v = col(row, name);
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const n = parseFloat(String(v).replace(/[$,\s"']/g, ''));
  return isNaN(n) ? 0 : n;
}
function calcConnPrice(c) {
  if (c <= 0) return 0; if (c === 1) return 149; if (c <= 10) return 290;
  if (c <= 24) return c*29; if (c <= 49) return c*22; if (c <= 99) return c*19;
  if (c <= 199) return c*17; if (c <= 299) return c*15.3; return c*14;
}
function calcConnPriceWithRates(c, tp) {
  if (c <= 0) return 0; if (c === 1) return tp[1]; if (c <= 10) return 290;
  if (c <= 24) return c*tp[10]; if (c <= 49) return c*tp[25]; if (c <= 99) return c*tp[50];
  if (c <= 199) return c*tp[100]; if (c <= 299) return c*tp[200]; return c*tp[300];
}
function calcIntgPrice(n, mode, flatRate, tierPrices) {
  if (!n || n <= 0 || mode === "none") return 0;
  if (mode === "flat") return n * flatRate;
  // tiered: n × rate for the bracket (no flat fees — integrations are always per-unit)
  if (n === 1)    return n * tierPrices[1];
  if (n <= 10)    return n * tierPrices[10];
  if (n <= 24)    return n * tierPrices[25];
  if (n <= 49)    return n * tierPrices[50];
  if (n <= 99)    return n * tierPrices[100];
  if (n <= 199)   return n * tierPrices[200];
  return n * tierPrices[300];
}

const INTG_CSV_KEYS = {
  "QBO": "QBO", "QBD": "QBD", "Xero": "Xero", "CSV": "CSV",
  "Gusto": "Gusto", "Excel": "Excel Sheets", "Google Sheets": "Google Sheets"
};

const getTier = c => TIERS.find(t => c >= t.min && c <= t.max) || TIERS[TIERS.length - 1];
const fmt  = n => isNaN(n) ? "$0" : "$" + Math.round(n).toLocaleString();
const fmtD = n => Number(n).toFixed(2);
const fmtK = n => n >= 1e6 ? "$"+(n/1e6).toFixed(2)+"M" : n >= 1e3 ? "$"+(n/1e3).toFixed(1)+"K" : "$"+Math.round(n);
const pctDelta = (val, base) => {
  if (!base) return null;
  const p = ((val-base)/base*100).toFixed(1), up = val >= base;
  return <span className={"text-xs font-bold "+(up?"text-green-600":"text-rose-600")}>{up?"▲":"▼"} {Math.abs(p)}%</span>;
};

const mktMrrFor = (s, totalReportsPerMo, totalDashPerMo, n) => {
  const rB = (s.mktReportBuyerPct/100)*n;
  const dB = (s.mktDashBuyerPct/100)*n;
  return ((totalReportsPerMo*(s.mktReportSellPct/100)*rB*s.mktReportSubPrice)+(totalDashPerMo*(s.mktDashSellPct/100)*dB*s.mktDashSubPrice))*(s.marketplaceTake/100);
};

const calcHybridOne = (c, h, s, n) => {
  let b = 0;
  if (h.connMode==="current") b += c.mrr;
  else if (h.connMode==="flat") b += c.connections*s.perConnectionPrice;
  else if (h.connMode==="tiered") b += calcConnPriceWithRates(c.connections, s.connTierPrices);
  for (const intg of INTEGRATIONS) {
    b += calcIntgPrice(c.integrations?.[intg]||0, h.intgModes?.[intg]||"none", s.intgFlatPrices[intg], s.intgTierPrices[intg]);
  }
  if      (h.useReportMonthly)     b += c.reportsPerMonth*s.perReportMonthly;
  else if (h.useReportPayPerUse)   b += c.downloadsPerMonth*s.perReportUse;
  else if (h.useReportPacks)       b += c.reportsPerMonth>0 ? Math.ceil(c.reportsPerMonth/s.reportPackSize)*s.reportPackPrice : 0;
  if      (h.useDashMonthly)       b += c.dashPerMonth*s.perDashboardMonthly;
  else if (h.useDashPayPerUse)     b += c.dashPublishedPerMonth*s.perDashboardUse;
  else if (h.useDashPacks)         b += c.dashPerMonth>0 ? Math.ceil(c.dashPerMonth/s.dashPackSize)*s.dashPackPrice : 0;
  if      (h.useTemplateMonthly)   b += c.templatesPerMonth*s.perTemplateMonthly;
  else if (h.useTemplatePacks)     b += c.templatesPerMonth>0 ? Math.ceil(c.templatesPerMonth/s.templatePackSize)*s.templatePackPrice : 0;
  if      (h.useBudgetsProMonthly)   b += c.budgetsProPerMonth*s.perBudgetsProMonthly;
  else if (h.useBudgetsProPacks)     b += c.budgetsProPerMonth>0 ? Math.ceil(c.budgetsProPerMonth/s.budgetsProPackSize)*s.budgetsProPackPrice : 0;
  return b;
};

// Calculates the final MRR for one customer under hybrid settings, correctly handling
// the "current MRR" connection mode (c.mrr is already post-discount, so don't discount again).
function calcHybridMrr(c, h, s) {
  const disc = 1 - s.annualDiscount / 100;
  const toMrr = b => c.billing === "annual" ? b * disc : b;
  let addOnBase = 0;
  if (h.connMode !== "current") {
    if      (h.connMode === "flat")   addOnBase += c.connections * s.perConnectionPrice;
    else if (h.connMode === "tiered") addOnBase += calcConnPriceWithRates(c.connections, s.connTierPrices);
  }
  for (const intg of INTEGRATIONS) addOnBase += calcIntgPrice(c.integrations?.[intg]||0, h.intgModes?.[intg]||"none", s.intgFlatPrices[intg], s.intgTierPrices[intg]);
  if      (h.useReportMonthly)       addOnBase += c.reportsPerMonth * s.perReportMonthly;
  else if (h.useReportPayPerUse)     addOnBase += c.downloadsPerMonth * s.perReportUse;
  else if (h.useReportPacks)         addOnBase += c.reportsPerMonth > 0 ? Math.ceil(c.reportsPerMonth / s.reportPackSize) * s.reportPackPrice : 0;
  if      (h.useDashMonthly)         addOnBase += c.dashPerMonth * s.perDashboardMonthly;
  else if (h.useDashPayPerUse)       addOnBase += c.dashPublishedPerMonth * s.perDashboardUse;
  else if (h.useDashPacks)           addOnBase += c.dashPerMonth > 0 ? Math.ceil(c.dashPerMonth / s.dashPackSize) * s.dashPackPrice : 0;
  if      (h.useTemplateMonthly)     addOnBase += c.templatesPerMonth * s.perTemplateMonthly;
  else if (h.useTemplatePacks)       addOnBase += c.templatesPerMonth > 0 ? Math.ceil(c.templatesPerMonth / s.templatePackSize) * s.templatePackPrice : 0;
  if      (h.useBudgetsProMonthly)   addOnBase += c.budgetsProPerMonth * s.perBudgetsProMonthly;
  else if (h.useBudgetsProPacks)     addOnBase += c.budgetsProPerMonth > 0 ? Math.ceil(c.budgetsProPerMonth / s.budgetsProPackSize) * s.budgetsProPackPrice : 0;
  // c.mrr is already the actual billed amount — add it directly without re-discounting
  return (h.connMode === "current" ? c.mrr : 0) + toMrr(addOnBase);
}

function scaleCustomers(base, targetCount) {
  if (!base||!base.length) return [];
  const ratio = targetCount/base.length, result = [];
  base.forEach(c => { const w=Math.floor(ratio); for(let i=0;i<w;i++) result.push(c); if(Math.random()<(ratio-w)) result.push(c); });
  while(result.length>targetCount) result.pop();
  while(result.length<targetCount) result.push(base[Math.floor(Math.random()*base.length)]);
  return result;
}

const Card = ({ children, className="", style }) => (
  <div className={"bg-white rounded-2xl p-5 "+className} style={{boxShadow:"0 2px 12px rgba(0,0,0,0.07)",border:"1px solid #f1f5f9",...style}}>{children}</div>
);
const SectionCard = ({ children, color, className="" }) => (
  <div className={"rounded-2xl p-5 "+className} style={{background:"#fff",borderLeft:`5px solid ${color}`,boxShadow:"0 2px 12px rgba(0,0,0,0.07)",border:`1px solid ${color}22`,borderLeftWidth:"5px",borderLeftColor:color}}>{children}</div>
);
const Slider = ({ label, value, min, max, step, onChange, prefix="", suffix="", hint, color }) => {
  const pct = ((value - min) / (max - min) * 100).toFixed(1);
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:(color||R.primary)+"18",color:color||R.primary}}>{prefix}{value}{suffix}</span>
      </div>
      <div className="relative h-5 flex items-center">
        <div className="absolute w-full h-1.5 rounded-full" style={{background:"#e2e8f0"}}/>
        <div className="absolute h-1.5 rounded-full" style={{width:pct+"%",background:color||R.primary}}/>
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e=>onChange(Number(e.target.value))}
          className="absolute w-full opacity-0 cursor-pointer h-5"
          style={{zIndex:2}}
        />
        <div className="absolute w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none"
          style={{left:`calc(${pct}% - 8px)`,background:color||R.primary,boxShadow:"0 1px 4px rgba(0,0,0,0.2)"}}/>
      </div>
      {hint && <p className="text-xs text-gray-400 mt-1.5">{hint}</p>}
    </div>
  );
};
const RadioOpt = ({ name, value, checked, onChange, label, hint, color }) => (
  <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer border transition mb-1"
    style={checked?{background:color+"18",borderColor:color}:{background:"#f9fafb",borderColor:"#e5e7eb"}}>
    <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="mt-0.5 w-4 h-4 flex-shrink-0" style={{accentColor:color}} />
    <div>
      <p className="text-xs font-medium" style={checked?{color}:{color:"#4b5563"}}>{label}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  </label>
);
const ToggleOpt = ({ label, checked, onChange, hint, color }) => (
  <label className="flex items-start gap-2 p-2 rounded-lg cursor-pointer border transition mb-1"
    style={checked?{background:color+"18",borderColor:color}:{background:"#f9fafb",borderColor:"#e5e7eb"}}>
    <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} className="mt-0.5 w-4 h-4 flex-shrink-0" style={{accentColor:color}} />
    <div>
      <p className="text-xs font-medium" style={checked?{color}:{color:"#4b5563"}}>{label}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  </label>
);
const Tab = ({ active, onClick, children }) => (
  <button onClick={onClick} className="px-4 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap"
    style={active?{borderBottomColor:R.primary,color:R.primaryText,background:"#fff"}:{borderBottomColor:"transparent",color:"#64748b",background:"transparent"}}>
    {children}
  </button>
);
const MetricBox = ({ label, value, sub, color, icon }) => {
  const styles = {
    reach: {background:"linear-gradient(135deg,#E0F7FC 0%,#B2EBF2 100%)",border:"1px solid #80DEEA",color:R.primaryText,boxShadow:"0 2px 8px rgba(0,180,216,0.15)"},
    green: {background:"linear-gradient(135deg,#f0fdf4 0%,#dcfce7 100%)",border:"1px solid #86efac",color:"#166534",boxShadow:"0 2px 8px rgba(22,163,74,0.12)"},
    amber: {background:"linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)",border:"1px solid #fcd34d",color:"#92400e",boxShadow:"0 2px 8px rgba(245,158,11,0.12)"},
    rose:  {background:"linear-gradient(135deg,#fff1f2 0%,#ffe4e6 100%)",border:"1px solid #fda4af",color:"#9f1239",boxShadow:"0 2px 8px rgba(244,63,94,0.12)"},
  };
  const s = styles[color] || styles.reach;
  return (
    <div className="rounded-xl p-4 flex flex-col justify-between transition-transform hover:scale-[1.02]"
      style={{...s, minHeight:"90px"}}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-60">{label}</p>
        {icon && <span className="text-base opacity-40">{icon}</span>}
      </div>
      <div>
        <p className="text-2xl font-extrabold leading-none">{value}</p>
        {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
      </div>
    </div>
  );
};
const GroupDivider = ({ label, color }) => (
  <div className="flex items-center gap-3 mt-6 mb-2">
    <div className="w-1.5 h-7 rounded-full flex-shrink-0" style={{background:color}}/>
    <span className="text-base font-extrabold tracking-wide" style={{color}}>{label}</span>
    <div className="flex-1 h-px" style={{background:`linear-gradient(90deg,${color}44,transparent)`}}/>
  </div>
);

// ── Math Summary bar shown at bottom of each active section ──────────
const MathSummary = ({ lines, total, color }) => (
  <div className="mt-4 pt-3 border-t" style={{borderColor:color+"33"}}>
    <div className="space-y-1 mb-2">
      {lines.map((line,i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <p className="text-xs text-gray-500 font-mono">{line.formula}</p>
          <span className="text-xs font-semibold flex-shrink-0" style={{color}}>{fmt(line.subtotal)}</span>
        </div>
      ))}
    </div>
    <div className="flex justify-end">
      <span className="text-sm font-bold px-3 py-1 rounded-lg" style={{background:color+"18",color}}>
        Total = {fmt(total)}/mo
      </span>
    </div>
  </div>
);

const FORECAST_COLORS = { current: R.primary, hybrid: "#f59e0b" };
const FORECAST_LABELS = { current: "Current Model", hybrid: "🧩 Hybrid" };
const ForecastTooltip = ({ active, payload }) => {
  if (!active||!payload||!payload.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-bold text-gray-700 mb-2">{payload[0].payload.count.toLocaleString()} customers</p>
      {payload.map(p=>(
        <div key={p.dataKey} className="flex justify-between gap-4 mb-0.5">
          <span style={{color:p.color}}>{FORECAST_LABELS[p.dataKey]||p.name}</span>
          <span className="font-semibold">{fmtK(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

const RECON_PAGE_SIZE = 50;

// ── Split slider groups (integrations broken out individually) ────────
const CORE_SPLIT_COMPONENTS = [
  { key: "conn", label: "🔗 Connections", color: "#6366f1" },
  { key: "rep",  label: "📄 Reports",     color: "#00B4D8" },
  { key: "dash", label: "📊 Dashboards",  color: "#10b981" },
  { key: "tmpl", label: "📋 Templates",   color: "#f59e0b" },
  { key: "bpro", label: "💰 Budgets Pro", color: "#f43f5e" },
  { key: "mkt",  label: "🏪 Marketplace", color: "#0096B7" },
];
const INTG_COLORS = ["#7c3aed","#8b5cf6","#a78bfa","#6d28d9","#4c1d95","#5b21b6","#7e22ce"];
const DEFAULT_SPLITS = { conn: 45, rep: 20, dash: 12, tmpl: 12, bpro: 6, mkt: 5,
  ...Object.fromEntries(INTEGRATIONS.map(k => [k, 0])) };

function RecommendationTab({ data, totalMrr, settings, setSettings, setHybrid, setTab }) {
  const [splits, setSplits] = useState(DEFAULT_SPLITS);
  const [appliedMsg, setAppliedMsg] = useState(false);

  // All split keys in display order
  const allKeys = [...CORE_SPLIT_COMPONENTS.map(c => c.key), ...INTEGRATIONS];
  const totalSplit = allKeys.reduce((s, k) => s + (splits[k] || 0), 0);
  const splitDelta = parseFloat((totalSplit - 100).toFixed(1));
  const atTarget = Math.abs(splitDelta) < 0.1;
  const over = splitDelta > 0.1;

  const setSplit = (key, val) => setSplits(s => ({ ...s, [key]: Math.max(0, Math.min(100, parseFloat(val))) }));

  const target = totalMrr;
  const disc = 1 - settings.annualDiscount / 100;
  const calcMrrFor = fn => data.reduce((sum, c) => {
    const b = fn(c); return sum + (c.billing === "annual" ? b * disc : b);
  }, 0);

  // Totals from data
  const totalConn   = data.reduce((a, c) => a + c.connections, 0);
  const totalRepMo  = data.reduce((a, c) => a + c.reportsPerMonth, 0);
  const totalDashMo = data.reduce((a, c) => a + c.dashPerMonth, 0);
  const totalTmplMo = data.reduce((a, c) => a + c.templatesPerMonth, 0);
  const totalBProMo = data.reduce((a, c) => a + c.budgetsProPerMonth, 0);
  const intgTotals  = Object.fromEntries(INTEGRATIONS.map(k => [k, data.reduce((a, c) => a + (c.integrations?.[k] || 0), 0)]));
  const avgRepPerCust  = totalRepMo / data.length;
  const avgDashPerCust = totalDashMo / data.length;
  const avgTmplPerCust = totalTmplMo / data.length;
  const avgBProPerCust = totalBProMo / data.length;

  // Marketplace GMV
  const mktReportListings = totalRepMo * (settings.mktReportSellPct / 100);
  const mktDashListings   = totalDashMo * (settings.mktDashSellPct / 100);
  const mktReportBuyers   = (settings.mktReportBuyerPct / 100) * data.length;
  const mktDashBuyers     = (settings.mktDashBuyerPct / 100) * data.length;
  const mktGMVPerTakePct  = (mktReportListings * mktReportBuyers * settings.mktReportSubPrice + mktDashListings * mktDashBuyers * settings.mktDashSubPrice) * (settings.marketplaceTake / 100);

  // ── Effective usage totals weighted by billing (annual gets discount) ──
  // We need to derive prices such that running through actual customer math = target * split%
  // So: implied_price = (target * split%) / sum_of(usage * billing_weight)
  const effConn   = data.reduce((a, c) => a + c.connections        * (c.billing==="annual"?disc:1), 0);
  const effRep    = data.reduce((a, c) => a + c.reportsPerMonth    * (c.billing==="annual"?disc:1), 0);
  const effDash   = data.reduce((a, c) => a + c.dashPerMonth       * (c.billing==="annual"?disc:1), 0);
  const effTmpl   = data.reduce((a, c) => a + c.templatesPerMonth  * (c.billing==="annual"?disc:1), 0);
  const effBPro   = data.reduce((a, c) => a + c.budgetsProPerMonth * (c.billing==="annual"?disc:1), 0);
  const effIntg   = Object.fromEntries(INTEGRATIONS.map(k => [
    k, data.reduce((a, c) => a + (c.integrations?.[k]||0) * (c.billing==="annual"?disc:1), 0)
  ]));

  // Implied prices: price × effective_usage = target × split%
  const impliedConnFlat = effConn > 0   ? target * (splits.conn / 100) / effConn : 0;
  const impliedRepMo    = effRep  > 0   ? target * (splits.rep  / 100) / effRep  : 0;
  const impliedDashMo   = effDash > 0   ? target * (splits.dash / 100) / effDash : 0;
  const impliedTmplMo   = effTmpl > 0   ? target * (splits.tmpl / 100) / effTmpl : 0;
  const impliedBProMo   = effBPro > 0   ? target * (splits.bpro / 100) / effBPro : 0;
  const impliedIntgFlats = Object.fromEntries(INTEGRATIONS.map(k => [
    k, effIntg[k] > 0 ? target * ((splits[k] || 0) / 100) / effIntg[k] : 0
  ]));

  // Tiered connection pricing — maintain same tier ratios, scale base so total conn revenue = target * split%
  const tierMults = { 1: 1.4, 10: 1.2, 25: 1.0, 50: 0.85, 100: 0.70, 200: 0.58, 300: 0.48 };
  // effective tiered conn revenue at tierMult=1 base
  const effTieredBase = data.reduce((a, c) => {
    const k = c.connections<=1?1:c.connections<=10?10:c.connections<=24?25:c.connections<=49?50:c.connections<=99?100:c.connections<=199?200:300;
    return a + calcConnPriceWithRates(c.connections, {1:tierMults[1],10:tierMults[10],25:tierMults[25],50:tierMults[50],100:tierMults[100],200:tierMults[200],300:tierMults[300]}) * (c.billing==="annual"?disc:1);
  }, 0);
  const tieredScale = effTieredBase > 0 ? (target * (splits.conn / 100)) / effTieredBase : 1;
  const tieredPrices = Object.fromEntries(Object.entries(tierMults).map(([k, m]) => [k, m * tieredScale]));

  // MRR projections — these should now equal target when splits sum to 100%
  const flatConnPrices = { 1: impliedConnFlat, 10: impliedConnFlat, 25: impliedConnFlat, 50: impliedConnFlat, 100: impliedConnFlat, 200: impliedConnFlat, 300: impliedConnFlat };
  const anyIntgSplit = INTEGRATIONS.some(k => (splits[k] || 0) > 0);

  const calcRowBase = (c, connPrices) =>
    calcConnPriceWithRates(c.connections, connPrices) +
    c.reportsPerMonth * impliedRepMo +
    c.dashPerMonth * impliedDashMo +
    c.templatesPerMonth * impliedTmplMo +
    c.budgetsProPerMonth * impliedBProMo +
    INTEGRATIONS.reduce((s, k) => s + (c.integrations?.[k] || 0) * impliedIntgFlats[k], 0);

  const mrrFlatConn   = calcMrrFor(c => calcRowBase(c, flatConnPrices))   + (splits.mkt > 0 ? mktGMVPerTakePct : 0);
  const mrrTieredConn = calcMrrFor(c => calcRowBase(c, tieredPrices))     + (splits.mkt > 0 ? mktGMVPerTakePct : 0);

  const AccuracyBadge = ({ mrr }) => {
    const diff = target > 0 ? Math.abs(mrr - target) / target * 100 : 0;
    return (
      <span className={"text-xs font-bold px-2 py-0.5 rounded " + (diff < 2 ? "bg-green-100 text-green-700" : diff < 5 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>
        {diff < 0.1 ? "Exact match" : diff.toFixed(1) + "% off target"}
      </span>
    );
  };

  const Row = ({ label, value, note, color }) => (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3 text-sm font-medium text-gray-700">{label}</td>
      <td className="py-2 pr-3 text-sm font-bold" style={{ color: color || R.primaryText }}>{value}</td>
      <td className="py-2 text-xs text-gray-400">{note}</td>
    </tr>
  );

  const applyToConfig = (mode) => {
    setSettings(s => ({
      ...s,
      perConnectionPrice: parseFloat(impliedConnFlat.toFixed(2)),
      connTierPrices: mode === "tiered"
        ? Object.fromEntries(Object.entries(tieredPrices).map(([k, v]) => [k, parseFloat(v.toFixed(2))]))
        : s.connTierPrices,
      perReportMonthly:     parseFloat(impliedRepMo.toFixed(2)),
      perDashboardMonthly:  parseFloat(impliedDashMo.toFixed(2)),
      perTemplateMonthly:   parseFloat(impliedTmplMo.toFixed(2)),
      perBudgetsProMonthly: parseFloat(impliedBProMo.toFixed(2)),
      intgFlatPrices: Object.fromEntries(INTEGRATIONS.map(k => [k, parseFloat(impliedIntgFlats[k].toFixed(2))])),
    }));
    setHybrid(h => ({
      ...h,
      connMode: mode,
      useReportMonthly: true, useReportPayPerUse: false, useReportPacks: false,
      useDashMonthly: true,   useDashPayPerUse: false,   useDashPacks: false,
      useTemplateMonthly: true, useTemplatePacks: false,
      useBudgetsProMonthly: true, useBudgetsProPacks: false,
      intgModes: anyIntgSplit
        ? Object.fromEntries(INTEGRATIONS.map(k => [k, (splits[k] || 0) > 0 ? "flat" : "none"]))
        : h.intgModes,
      useMarketplace: splits.mkt > 0,
    }));
    setAppliedMsg(true);
    setTimeout(() => setAppliedMsg(false), 2500);
    setTab("configure");
  };

  // Build the stacked bar — all components including per-integration
  const allBarSegments = [
    ...CORE_SPLIT_COMPONENTS,
    ...INTEGRATIONS.map((k, i) => ({ key: k, label: k, color: INTG_COLORS[i % INTG_COLORS.length] })),
  ];

  // Live projected MRR = sum of all split contributions applied through actual customer math
  const projectedMrr = mrrFlatConn; // flat is the primary reference; tiered shown separately below
  const mrrGap = projectedMrr - target;
  const mrrGapPct = target > 0 ? (mrrGap / target * 100) : 0;
  const mrrMatch = Math.abs(mrrGapPct) < 0.5;

  return (
    <div className="space-y-5">
      {/* Live MRR tracker — the core feedback loop */}
      <div className="rounded-xl p-4" style={{background: mrrMatch ? "#f0fdf4" : atTarget ? "#FFFBEB" : "#fff1f2", border: `2px solid ${mrrMatch ? "#86efac" : atTarget ? "#FCD34D" : "#fda4af"}`}}>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-xs font-semibold" style={{color: mrrMatch ? "#166534" : atTarget ? "#92400e" : "#9f1239"}}>
              {mrrMatch ? "✓ Projected MRR matches target" : atTarget ? "Splits at 100% — projected MRR:" : "Adjust splits to reach 100%"}
            </p>
            <p className="text-2xl font-bold text-gray-800 mt-0.5">{fmt(projectedMrr)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Target (current MRR)</p>
            <p className="text-xl font-bold text-gray-700">{fmt(target)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Gap</p>
            <p className={"text-xl font-bold " + (mrrGap >= 0 ? "text-green-600" : "text-rose-600")}>
              {mrrGap >= 0 ? "+" : ""}{fmt(mrrGap)}
              <span className="text-sm ml-1">({mrrGapPct >= 0 ? "+" : ""}{mrrGapPct.toFixed(1)}%)</span>
            </p>
          </div>
          <div className="ml-auto">
            <div className={"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-sm " +
              (atTarget ? "bg-green-100 text-green-700" : over ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-700")}>
              <span>Splits: {totalSplit.toFixed(1)}%</span>
              <span className="font-normal text-xs">{atTarget ? "✓" : over ? `▲ ${splitDelta.toFixed(1)}% over` : `▼ ${Math.abs(splitDelta).toFixed(1)}% under`}</span>
            </div>
          </div>
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>$0</span><span>Target: {fmt(target)}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5">
            <div className="h-2.5 rounded-full transition-all" style={{
              width: Math.min(projectedMrr / target * 100, 130) + "%",
              background: mrrMatch ? "#22c55e" : projectedMrr > target ? "#f59e0b" : R.primary,
              maxWidth: "100%"
            }}/>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricBox label="Total Customers"    value={data.length.toLocaleString()} color="reach"/>
        <MetricBox label="Total Connections"  value={totalConn.toLocaleString()}   color="reach"/>
        <MetricBox label="Avg Reports/mo"     value={fmtD(avgRepPerCust)}          color="reach"/>
        <MetricBox label="Avg Templates/mo"   value={fmtD(avgTmplPerCust)}         color="reach"/>
      </div>

      {/* Split designer card */}
      <Card style={{ border: `2px solid ${R.primary}` }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <h2 className="font-semibold text-gray-800">Revenue Split Designer</h2>
            <p className="text-xs text-gray-500 mt-0.5">Decide what % of MRR each component contributes. Prices auto-calculate below so the total hits your current MRR.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSplits(DEFAULT_SPLITS)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200">Reset</button>
          </div>
        </div>

        {/* Stacked bar */}
        <div className="flex rounded-full overflow-hidden h-3 mb-5 bg-gray-100">
          {allBarSegments.map(({ key, color }) =>
            (splits[key] || 0) > 0 ? (
              <div key={key} className="h-3 transition-all duration-150"
                style={{ width: Math.min((splits[key] || 0), 100) + "%", background: color }}
                title={key + ": " + (splits[key] || 0).toFixed(1) + "%"} />
            ) : null
          )}
        </div>

        {/* Core components */}
        <div className="mb-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Core Components</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8">
            {CORE_SPLIT_COMPONENTS.map(({ key, label, color }) => {
              const pct = splits[key] || 0;
              const revAmt = target * (pct / 100);
              return (
                <div key={key} className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold" style={{ color }}>{label}</span>
                    <span className="font-bold text-gray-700">
                      {pct.toFixed(1)}%
                      <span className="text-gray-400 font-normal"> · {fmt(revAmt)}/mo</span>
                    </span>
                  </div>
                  <input type="range" min={0} max={100} step={0.5} value={pct}
                    onChange={e => setSplit(key, e.target.value)}
                    className="w-full" style={{ accentColor: color }} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Integration components */}
        <div className="pt-3 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">🔌 Integrations (per type)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8">
            {INTEGRATIONS.map((intg, i) => {
              const pct = splits[intg] || 0;
              const revAmt = target * (pct / 100);
              const color = INTG_COLORS[i % INTG_COLORS.length];
              const totalUnits = intgTotals[intg];
              const impliedPrice = impliedIntgFlats[intg];
              return (
                <div key={intg} className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-semibold" style={{ color }}>{intg}</span>
                    <span className="font-bold text-gray-700">
                      {pct.toFixed(1)}%
                      <span className="text-gray-400 font-normal"> · {fmt(revAmt)}/mo</span>
                      {pct > 0 && totalUnits > 0 && <span className="text-gray-400 font-normal"> → ${impliedPrice.toFixed(2)}/unit</span>}
                    </span>
                  </div>
                  <input type="range" min={0} max={30} step={0.5} value={pct}
                    onChange={e => setSplit(intg, e.target.value)}
                    className="w-full" style={{ accentColor: color }} />
                  {totalUnits === 0 && <p className="text-xs text-gray-300 mt-0.5">No usage in data</p>}
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Implied prices summary row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Per Conn (flat)", val: impliedConnFlat, color: "#6366f1", show: splits.conn > 0 },
          { label: "Per Report/mo",   val: impliedRepMo,    color: "#00B4D8", show: splits.rep > 0 },
          { label: "Per Dash/mo",     val: impliedDashMo,   color: "#10b981", show: splits.dash > 0 },
          { label: "Per Template/mo", val: impliedTmplMo,   color: "#f59e0b", show: splits.tmpl > 0 },
          { label: "Per BPro/mo",     val: impliedBProMo,   color: "#f43f5e", show: splits.bpro > 0 },
          { label: "Mkt/mo (est)",    val: mktGMVPerTakePct, color: "#0096B7", show: splits.mkt > 0, isMrr: true },
        ].filter(x => x.show).map(({ label, val, color, isMrr }) => (
          <div key={label} className="rounded-lg p-3 text-center" style={{ background: color + "12", border: `1px solid ${color}44` }}>
            <p className="text-xs font-medium mb-1" style={{ color }}>{label}</p>
            <p className="text-lg font-bold text-gray-800">{isMrr ? fmt(val) : "$" + val.toFixed(2)}</p>
          </div>
        ))}
      </div>

      {/* Per-integration implied prices (only show active ones) */}
      {anyIntgSplit && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {INTEGRATIONS.filter(k => (splits[k] || 0) > 0).map((k, i) => {
            const color = INTG_COLORS[i % INTG_COLORS.length];
            return (
              <div key={k} className="rounded-lg p-2.5 text-center" style={{ background: color + "12", border: `1px solid ${color}44` }}>
                <p className="text-xs font-medium mb-0.5" style={{ color }}>{k}</p>
                <p className="text-base font-bold text-gray-800">${impliedIntgFlats[k].toFixed(2)}</p>
                <p className="text-xs text-gray-400">/unit/mo</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Option cards */}
      {[
        {
          title: "Option 1 — Flat Per-Connection",
          desc: "Simplest pricing: one flat rate per connection, monthly fees for all add-ons.",
          mrr: mrrFlatConn,
          mode: "flat",
          rows: [
            ...(splits.conn > 0 ? [{ label: "Per connection / mo", value: "$" + impliedConnFlat.toFixed(2), note: "× " + totalConn.toLocaleString() + " connections", color: "#6366f1" }] : []),
            ...(splits.rep > 0  ? [{ label: "Per report / mo",     value: "$" + impliedRepMo.toFixed(2),    note: "× " + fmtD(avgRepPerCust)  + " avg/cust/mo", color: "#00B4D8" }] : []),
            ...(splits.dash > 0 ? [{ label: "Per dashboard / mo",  value: "$" + impliedDashMo.toFixed(2),   note: "× " + fmtD(avgDashPerCust) + " avg/cust/mo", color: "#10b981" }] : []),
            ...(splits.tmpl > 0 ? [{ label: "Per template / mo",   value: "$" + impliedTmplMo.toFixed(2),   note: "× " + fmtD(avgTmplPerCust) + " avg/cust/mo", color: "#f59e0b" }] : []),
            ...(splits.bpro > 0 ? [{ label: "Per Budgets Pro / mo",value: "$" + impliedBProMo.toFixed(2),   note: "× " + fmtD(avgBProPerCust) + " avg/cust/mo", color: "#f43f5e" }] : []),
            ...INTEGRATIONS.filter(k => (splits[k] || 0) > 0).map((k, i) => ({
              label: k + " / unit / mo", value: "$" + impliedIntgFlats[k].toFixed(2),
              note: "× " + fmtD(intgTotals[k] / data.length) + " avg/cust", color: INTG_COLORS[i % INTG_COLORS.length]
            })),
            ...(splits.mkt > 0 ? [{ label: "Marketplace (take rate)", value: fmt(mktGMVPerTakePct) + "/mo", note: settings.marketplaceTake + "% of GMV", color: "#0096B7" }] : []),
          ],
        },
        {
          title: "Option 2 — Tiered Per-Connection",
          desc: "Volume discounts on connections; same monthly add-on fees as Option 1.",
          mrr: mrrTieredConn,
          mode: "tiered",
          rows: [
            ...(splits.conn > 0 ? CONN_TIER_DEFS.map(({ label, key }) => ({ label: label + " conns / mo", value: "$" + tieredPrices[key].toFixed(2) + "/conn", note: "", color: "#6366f1" })) : []),
            ...(splits.rep > 0  ? [{ label: "Per report / mo",     value: "$" + impliedRepMo.toFixed(2),   note: "× " + fmtD(avgRepPerCust)  + " avg/cust/mo", color: "#00B4D8" }] : []),
            ...(splits.dash > 0 ? [{ label: "Per dashboard / mo",  value: "$" + impliedDashMo.toFixed(2),  note: "× " + fmtD(avgDashPerCust) + " avg/cust/mo", color: "#10b981" }] : []),
            ...(splits.tmpl > 0 ? [{ label: "Per template / mo",   value: "$" + impliedTmplMo.toFixed(2),  note: "× " + fmtD(avgTmplPerCust) + " avg/cust/mo", color: "#f59e0b" }] : []),
            ...(splits.bpro > 0 ? [{ label: "Per Budgets Pro / mo",value: "$" + impliedBProMo.toFixed(2),  note: "× " + fmtD(avgBProPerCust) + " avg/cust/mo", color: "#f43f5e" }] : []),
            ...INTEGRATIONS.filter(k => (splits[k] || 0) > 0).map((k, i) => ({
              label: k + " / unit / mo", value: "$" + impliedIntgFlats[k].toFixed(2),
              note: "× " + fmtD(intgTotals[k] / data.length) + " avg/cust", color: INTG_COLORS[i % INTG_COLORS.length]
            })),
            ...(splits.mkt > 0 ? [{ label: "Marketplace (take rate)", value: fmt(mktGMVPerTakePct) + "/mo", note: settings.marketplaceTake + "% of GMV", color: "#0096B7" }] : []),
          ],
        },
      ].map(({ title, desc, mrr, mode, rows }) => (
        <Card key={title}>
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <h3 className="font-semibold text-gray-700">{title}</h3>
            <div className="flex items-center gap-2">
              <AccuracyBadge mrr={mrr} />
              <button onClick={() => applyToConfig(mode)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition hover:opacity-90"
                style={{ background: R.primary }}>
                Apply to Configure →
              </button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-3">{desc}</p>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-400 border-b text-left">
                  <th className="pb-1 pr-4">Component</th>
                  <th className="pb-1 pr-4">Suggested Price</th>
                  <th className="pb-1">Basis</th>
                </tr>
              </thead>
              <tbody>{rows.map(r => <Row key={r.label} {...r} />)}</tbody>
            </table>
          </div>
          <div className="mt-3 pt-3 border-t flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm text-gray-500">Projected MRR</span>
            <span className="font-bold text-gray-800 text-sm">
              {fmt(mrr)}{" "}
              <span className={"text-xs font-semibold " + (mrr >= target ? "text-green-600" : "text-rose-500")}>
                ({mrr >= target ? "+" : ""}{((mrr / target - 1) * 100).toFixed(1)}% vs target)
              </span>
            </span>
          </div>
        </Card>
      ))}

      {appliedMsg && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl shadow-xl px-5 py-3 text-white text-sm font-semibold" style={{ background: R.primaryDark }}>
          ✓ Prices applied — switched to Configure tab
        </div>
      )}
    </div>
  );
}

// ── Industry Benchmarks Tab ──────────────────────────────────────────
const INDUSTRY_COMPANIES = [
  { name:"Fathom (fathomhq)", url:"fathomhq.com", rev:"11-25", revLabel:"$5–25M ARR (est.)", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Starts ~$53/mo (1 org); scales by # connected company files. ~$280/mo for larger plans. All plans: unlimited users + all features.", notes:"Priced per entity/connection, not per user. Annual discount available.", isCompetitor:true },
  { name:"Syft Analytics (Xero-owned)", url:"syftanalytics.com", rev:"11-25", revLabel:"$10–25M ARR (est.)", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Per-entity plans: Starter, Plus, Advanced. Syft Assist AI add-on per entity. Annual commit + monthly pay option.", notes:"Acquired by Xero 2024. Feature-gated tiers per entity.", isCompetitor:true },
  { name:"Jirav", url:"jirav.com", rev:"11-25", revLabel:"~$11M ARR (2024)", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Starter/Advanced tiers: historical financials, KPIs, budget vs. actuals, AI forecasts. Full FP&A (custom budgets, scenario modeling) at higher tier. Firm/wholesale pricing available.", notes:"FP&A-focused. Contact for pricing. Dual channel: direct + accounting firms.", isCompetitor:true },
  { name:"Datarails", url:"datarails.com", rev:"25-100", revLabel:"~$51M ARR (est.) — targeting $100M in 2025", pricingType:"custom", pricingLabel:"Custom / Quote", prices:"No public pricing. Enterprise contracts: ~$3,000–$5,000+/mo ($36K–$60K+ ARR). Modules: FP&A, Cash Management, Month-End Close.", notes:"$70M Series C (Jan 2026) at $550M valuation. Excel-native FP&A for mid-market.", isCompetitor:true },
  { name:"LiveFlow", url:"liveflow.io", rev:"1-10", revLabel:"$1–10M ARR (est.)", pricingType:"custom", pricingLabel:"Custom / Quote", prices:"No public pricing. Third-party estimates: $500+/mo. Multi-entity consolidation specialist (QBO + Xero only). White-glove onboarding.", notes:"Series A 2024. Narrow integration set; premium positioning.", isCompetitor:true },
  { name:"Spotlight Reporting", url:"spotlightreporting.com", rev:"11-25", revLabel:"$5–20M ARR (est.)", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Basic: $329/mo (raised Oct 2025 from $295). SUPER VCFO+: unlimited dashboards. Plans scale by firm size. Annual + monthly options.", notes:"Advisor/firm-focused suite: Reporting, Forecasting, Dashboards, Consolidations.", isCompetitor:true },
  { name:"Iris Finance", url:"iris.finance", rev:"1-10", revLabel:"$1–10M ARR (est.)", pricingType:"custom", pricingLabel:"Custom / Quote", prices:"AI-native FP&A for CFOs. No public pricing; demo-gated. Covers budgeting, forecasting, board packs.", notes:"Newer entrant, AI-first positioning.", isCompetitor:true },
  { name:"Clockwork AI", url:"clockwork.ai", rev:"1-10", revLabel:"$1–5M ARR (est.)", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Accounting firm-focused FP&A platform. Tiered by # of clients. Positioned as Fathom/Jirav alternative with stronger advisory tooling.", notes:"Targets accountants building advisory practices.", isCompetitor:true },
  { name:"Cube Software", url:"cubesoftware.com", rev:"11-25", revLabel:"$10–25M ARR (est.)", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Starter → Professional → Enterprise. Priced by users + data sources. Excel + Google Sheets native FP&A. Contact for pricing.", notes:"Direct Jirav/Datarails competitor. Strong accountant channel.", isCompetitor:true },
  { name:"Mosaic Tech", url:"mosaic.tech", rev:"11-25", revLabel:"$5–20M ARR (est.)", pricingType:"custom", pricingLabel:"Custom / Quote", prices:"No public pricing. Strategic finance platform for high-growth companies. Annual contracts. Estimated $1K–$3K+/mo.", notes:"Acquired by Rippling (2024). SaaS-native FP&A with strong headcount planning.", isCompetitor:true },
  { name:"Futrli (by Sage)", url:"futrli.com", rev:"1-10", revLabel:"Acquired by Sage", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Advisor plans from ~$59/mo (1 org) to ~$299/mo (up to 20 orgs). Business plans from ~$39/mo. 3-way forecasting + KPIs. Per-org tiers.", notes:"Sage acquisition. Cash flow forecasting and advisory reporting for accountants.", isCompetitor:true },
  { name:"Xero", url:"xero.com", rev:"100plus", revLabel:"~$1.7B AUD ARR", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Starter $20/mo → Standard $47/mo → Premium $70/mo (US). Unlimited users. Feature-gated tiers. Add-ons: payroll, expenses, projects.", notes:"General ledger, not reporting-focused. Parent company of Syft Analytics. Core Reach integration.", isCompetitor:false },
  { name:"QuickBooks Online (Intuit)", url:"quickbooks.intuit.com", rev:"100plus", revLabel:"$6B+ total Intuit revenue", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Simple Start $30/mo → Essentials $60 → Plus $90 → Advanced $200. Payroll add-on. Annual discount ~50%.", notes:"Dominant SMB accounting platform. Primary data source for Reach.", isCompetitor:false },
  { name:"HubSpot", url:"hubspot.com", rev:"100plus", revLabel:"~$2.6B ARR (2024)", pricingType:"hybrid", pricingLabel:"Hybrid", prices:"Free tier + Starter/Pro/Enterprise per Hub. Per-seat at Pro/Enterprise. Add-ons à la carte. Bundle discount for multiple Hubs.", notes:"Textbook hybrid: tiered feature bundles × per-seat × optional add-ons. Strong freemium funnel.", isCompetitor:false },
  { name:"Salesforce", url:"salesforce.com", rev:"100plus", revLabel:"~$35B ARR", pricingType:"alacarte", pricingLabel:"À la carte + tiers", prices:"Starter $25/user/mo → Professional $80 → Enterprise $165 → Unlimited $330. Each Cloud priced separately. Extensive add-on marketplace.", notes:"Per-user base + extensive add-on layer. Enterprise almost always custom.", isCompetitor:false },
  { name:"Intercom", url:"intercom.com", rev:"100plus", revLabel:"~$300M ARR (est.)", pricingType:"hybrid", pricingLabel:"Hybrid", prices:"Essential $39/seat/mo → Advanced $99 → Expert $139. AI agent (Fin): $0.99/resolved conversation. Add-ons: Proactive Support, Surveys.", notes:"Per-seat base + usage-based AI layer. Industry example of hybrid pricing done well.", isCompetitor:false },
  { name:"Zapier", url:"zapier.com", rev:"100plus", revLabel:"~$250M ARR (est.)", pricingType:"hybrid", pricingLabel:"Hybrid (tiered + usage)", prices:"Free (100 tasks/mo) → Professional $19.99/mo → Team $69 → Enterprise custom. Tiers = feature access; task volume is the usage meter within each tier.", notes:"Tiers define features; tasks/month scales price within tiers. Strong freemium-to-paid model.", isCompetitor:false },
  { name:"Twilio", url:"twilio.com", rev:"100plus", revLabel:"~$4.2B ARR", pricingType:"usage", pricingLabel:"Usage-based", prices:"Pure pay-as-you-go. SMS: ~$0.0079/msg. Voice: ~$0.014/min. No monthly minimum; volume discounts at scale.", notes:"Canonical example of pure consumption pricing in infrastructure SaaS.", isCompetitor:false },
  { name:"Stripe", url:"stripe.com", rev:"100plus", revLabel:"~$20B ARR (est.)", pricingType:"usage", pricingLabel:"Usage-based (transaction %)", prices:"2.9% + 30¢ per successful card charge. No monthly fee. Each product (Radar, Billing, Connect) adds separate usage fees.", notes:"Textbook transaction-based pricing. Each product priced independently.", isCompetitor:false },
  { name:"Notion", url:"notion.so", rev:"100plus", revLabel:"~$250M ARR (est.)", pricingType:"peruser", pricingLabel:"Per user / seat", prices:"Free → Plus $10/user/mo → Business $15 → Enterprise custom. AI add-on: $8/member/mo. Guest seats free.", notes:"Simple per-seat with optional AI add-on. Good example of modular add-on on top of seat base.", isCompetitor:false },
  { name:"Monday.com", url:"monday.com", rev:"100plus", revLabel:"~$1B ARR (2024)", pricingType:"tiered", pricingLabel:"Tiered bundles", prices:"Basic $9/seat/mo → Standard $12 → Pro $19 → Enterprise custom. Min 3 seats. Separate products for Work OS, CRM, Dev, Service.", notes:"Per-seat tiered. Clear Good-Better-Best-Custom model.", isCompetitor:false },
  { name:"Airtable", url:"airtable.com", rev:"100plus", revLabel:"~$450M ARR (est.)", pricingType:"peruser", pricingLabel:"Per user / seat", prices:"Free → Team $20/user/mo → Business $45 → Enterprise custom. Row/record limits + automation runs differ by tier.", notes:"Per-seat with usage caps acting as natural upgrade triggers.", isCompetitor:false },
  { name:"Baremetrics", url:"baremetrics.com", rev:"1-10", revLabel:"$1–5M ARR (est.)", pricingType:"tiered", pricingLabel:"Tiered (by MRR band)", prices:"~$129/mo at $10K MRR → $249+/mo at $100K+ MRR. Recover (dunning) and Cancellation Insights as paid add-ons.", notes:"Revenue-based pricing — your spend scales with your own success. Popular with SaaS founders.", isCompetitor:false },
  { name:"ChartMogul", url:"chartmogul.com", rev:"11-25", revLabel:"$5–20M ARR (est.)", pricingType:"tiered", pricingLabel:"Tiered (by MRR band)", prices:"Free (up to $10K MRR) → Scale $100+/mo → Volume custom. CRM add-on available. Flat features per tier.", notes:"Revenue-based pricing similar to Baremetrics. Freemium entry is strong acquisition tool.", isCompetitor:false },
  { name:"Calendly", url:"calendly.com", rev:"100plus", revLabel:"~$100M+ ARR", pricingType:"peruser", pricingLabel:"Per user / seat", prices:"Free (1 event type) → Standard $10/seat/mo → Teams $16 → Enterprise custom. Feature unlock model.", notes:"Classic per-seat SaaS. Free tier does heavy acquisition lifting.", isCompetitor:false },
  { name:"Loom (Atlassian)", url:"loom.com", rev:"25-100", revLabel:"Acquired ~$975M (2023)", pricingType:"hybrid", pricingLabel:"Hybrid (seat + usage cap)", prices:"Starter free (25 vids/person) → Business $12.50/creator/mo (unlimited) → Enterprise custom. Storage and video count cap drives upgrades.", notes:"Freemium with hard usage caps that naturally drive conversion. Now bundled into Atlassian.", isCompetitor:false },
  { name:"ProfitWell (Paddle)", url:"paddle.com", rev:"25-100", revLabel:"Acquired by Paddle", pricingType:"flat", pricingLabel:"Flat rate (free core)", prices:"Metrics product: free forever. Retain (churn reduction): % of recovered revenue. Price Intelligently: custom.", notes:"Used freemium to gain market share, monetizes via high-value add-on services.", isCompetitor:false },
];

const PRICING_TYPES = [
  { key:"tiered",   label:"Tiered bundles",        bg:"#B5D4F4", color:"#0C447C" },
  { key:"hybrid",   label:"Hybrid",                bg:"#CECBF6", color:"#3C3489" },
  { key:"peruser",  label:"Per user / seat",        bg:"#F5C4B3", color:"#712B13" },
  { key:"usage",    label:"Usage-based",            bg:"#FAC775", color:"#633806" },
  { key:"flat",     label:"Flat rate",              bg:"#C0DD97", color:"#27500A" },
  { key:"custom",   label:"Custom / Quote",         bg:"#D3D1C7", color:"#444441" },
  { key:"alacarte", label:"À la carte + tiers",     bg:"#9FE1CB", color:"#085041" },
];
const REV_BANDS = [
  { key:"1-10",    label:"$1–10M",   bg:"#EAF3DE", color:"#3B6D11" },
  { key:"11-25",   label:"$11–25M",  bg:"#E6F1FB", color:"#185FA5" },
  { key:"25-100",  label:"$25–100M", bg:"#FAEEDA", color:"#854F0B" },
  { key:"100plus", label:"$100M+",   bg:"#FAECE7", color:"#993C1D" },
];

function IndustryTab() {
  const [revFilter, setRevFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const filtered = INDUSTRY_COMPANIES.filter(c => {
    const rOk = revFilter==="all" || (revFilter==="competitor" && c.isCompetitor) || c.rev===revFilter;
    const tOk = typeFilter==="all" || c.pricingType===typeFilter;
    return rOk && tOk;
  }).sort((a,b) => {
    if (a.isCompetitor !== b.isCompetitor) return a.isCompetitor ? -1 : 1;
    const order:Record<string,number> = {"1-10":0,"11-25":1,"25-100":2,"100plus":3};
    return (order[a.rev]??0) - (order[b.rev]??0);
  });

  const getPricingStyle = (type:string) => PRICING_TYPES.find(p=>p.key===type) || {bg:"#e5e7eb",color:"#374151"};
  const getRevStyle = (rev:string) => REV_BANDS.find(r=>r.key===rev) || {bg:"#e5e7eb",color:"#374151"};

  const FilterBtn = ({active, onClick, children}:{active:boolean,onClick:()=>void,children:React.ReactNode}) => (
    <button onClick={onClick} className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
      style={active ? {background:"#023E8A",color:"#fff",border:"1px solid #023E8A"} : {background:"#fff",color:"#64748b",border:"1px solid #e2e8f0"}}>
      {children}
    </button>
  );

  return (
    <div className="space-y-5">
      {/* Header context */}
      <div className="rounded-xl p-4" style={{background:"#E0F7FC",border:"1px solid #80DEEA"}}>
        <p className="text-sm font-semibold" style={{color:"#005F73"}}>🏭 Industry Pricing Benchmarks</p>
        <p className="text-xs mt-1" style={{color:"#0096B7"}}>
          {INDUSTRY_COMPANIES.filter(c=>c.isCompetitor).length} direct competitors · {INDUSTRY_COMPANIES.filter(c=>!c.isCompetitor).length} broader SaaS benchmarks · pricing data as of early 2026
        </p>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide w-24 flex-shrink-0">Show:</span>
          <FilterBtn active={revFilter==="all"} onClick={()=>setRevFilter("all")}>All ({INDUSTRY_COMPANIES.length})</FilterBtn>
          <FilterBtn active={revFilter==="competitor"} onClick={()=>setRevFilter("competitor")}>
            🎯 Competitors ({INDUSTRY_COMPANIES.filter(c=>c.isCompetitor).length})
          </FilterBtn>
          {REV_BANDS.map(b=>(
            <FilterBtn key={b.key} active={revFilter===b.key} onClick={()=>setRevFilter(b.key)}>
              {b.label} ({INDUSTRY_COMPANIES.filter(c=>c.rev===b.key).length})
            </FilterBtn>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide w-24 flex-shrink-0">Pricing:</span>
          <FilterBtn active={typeFilter==="all"} onClick={()=>setTypeFilter("all")}>All types</FilterBtn>
          {PRICING_TYPES.map(p=>(
            <FilterBtn key={p.key} active={typeFilter===p.key} onClick={()=>setTypeFilter(p.key)}>{p.label}</FilterBtn>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 items-center text-xs text-gray-500">
        <span className="font-semibold text-gray-600">Pricing type:</span>
        {PRICING_TYPES.map(p=>(
          <span key={p.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{background:p.bg,border:`1px solid ${p.color}44`}}/>
            {p.label}
          </span>
        ))}
      </div>

      {/* Count */}
      <p className="text-xs text-gray-400">Showing {filtered.length} of {INDUSTRY_COMPANIES.length} companies</p>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((c,i) => {
          const ps = getPricingStyle(c.pricingType);
          const rs = getRevStyle(c.rev);
          return (
            <div key={i} className="bg-white rounded-2xl p-4 transition-shadow hover:shadow-md"
              style={{
                boxShadow:"0 1px 6px rgba(0,0,0,0.06)",
                border: c.isCompetitor ? "2px solid #F97316" : "1px solid #f1f5f9",
              }}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-semibold text-gray-800 leading-tight">{c.name}</p>
                    {c.isCompetitor && (
                      <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{background:"#FFF7ED",color:"#C2410C",border:"1px solid #FED7AA"}}>
                        competitor
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{c.url}</p>
                </div>
                <span className="text-xs font-semibold px-2 py-1 rounded-lg flex-shrink-0 text-right" style={{background:ps.bg,color:ps.color}}>
                  {c.pricingLabel}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                <span className="text-xs font-medium px-2 py-0.5 rounded" style={{background:rs.bg,color:rs.color}}>
                  {c.revLabel}
                </span>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed mb-2">{c.prices}</p>
              {c.notes && <p className="text-xs text-gray-400 italic leading-relaxed">{c.notes}</p>}
            </div>
          );
        })}
        {filtered.length===0 && (
          <div className="col-span-3 text-center py-12 text-gray-400 text-sm">No companies match these filters.</div>
        )}
      </div>

      {/* Pricing type summary table */}
      <Card className="mt-6">
        <h2 className="font-extrabold text-gray-800 text-sm mb-4">Pricing Model Distribution</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b text-left">
                <th className="pb-2 pr-4">Pricing Model</th>
                <th className="pb-2 pr-4">Companies</th>
                <th className="pb-2 pr-4">Examples</th>
                <th className="pb-2">Best for</th>
              </tr>
            </thead>
            <tbody>
              {[
                { type:"tiered",   desc:"3–4 fixed plans, feature-gated. Most common B2B SaaS model (~57% of companies). Avg 3.5 tiers.",    bestFor:"Clear buyer personas, upsell path" },
                { type:"hybrid",   desc:"Base subscription + usage meter or add-ons. Growing fast — 61% of SaaS now use some hybrid element.", bestFor:"Wide usage variance, expansion revenue" },
                { type:"peruser",  desc:"Price × number of seats. Simple, predictable. Still used by ~57% as primary model.",                  bestFor:"Collaboration tools, team products" },
                { type:"usage",    desc:"Pure pay-as-you-go by consumption. Infrastructure-heavy; hard to forecast.",                           bestFor:"APIs, infrastructure, transaction tools" },
                { type:"custom",   desc:"No public pricing. Demo-gated. Common at enterprise/mid-market where deal size justifies sales motion.", bestFor:"Enterprise, complex implementations" },
                { type:"alacarte", desc:"Core product + independently priced add-ons. Can grow complex; Salesforce is the extreme example.",    bestFor:"Platform ecosystems, diverse use cases" },
                { type:"flat",     desc:"Single price, all features. Rare in mainstream SaaS due to inflexibility.",                            bestFor:"Simple products, niche markets" },
              ].map(row => {
                const ps = getPricingStyle(row.type);
                const cos = INDUSTRY_COMPANIES.filter(c=>c.pricingType===row.type);
                return (
                  <tr key={row.type} className="border-b last:border-0">
                    <td className="py-2.5 pr-4">
                      <span className="text-xs font-semibold px-2 py-1 rounded" style={{background:ps.bg,color:ps.color}}>{ps.label}</span>
                    </td>
                    <td className="py-2.5 pr-4 font-semibold text-gray-700">{cos.length}</td>
                    <td className="py-2.5 pr-4 text-xs text-gray-500">{cos.slice(0,3).map(c=>c.name.split(" ")[0]).join(", ")}{cos.length>3?` +${cos.length-3}`:""}</td>
                    <td className="py-2.5 text-xs text-gray-500">{row.bestFor}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-3 italic">Source: company websites, G2, Crunchbase, Latka, public filings — compiled early 2026</p>
      </Card>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState(""); const [pwErr, setPwErr] = useState(false);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [forecastView, setForecastView] = useState("mrr");
  const [snapMode, setSnapMode] = useState(false);
  const [forecastScenarios, setForecastScenarios] = useState({ current: true, hybrid: true });
  const fileRef = useRef();
  const [reconSort, setReconSort] = useState({ col: "hybridDiff", dir: "desc" });
  const [reconFilter, setReconFilter] = useState("all");
  const [reconTierFilter, setReconTierFilter] = useState("all");
  const [reconSearch, setReconSearch] = useState("");
  const [reconPage, setReconPage] = useState(0);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hybrid, setHybrid] = useState(DEFAULT_HYBRID);
  const [savedScenarios, setSavedScenarios] = useState(() => {
    try {
      const stored = localStorage.getItem("reach_pricing_scenarios");
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [saveNameDraft, setSaveNameDraft] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);

  const persistScenarios = (scenarios) => {
    setSavedScenarios(scenarios);
    try { localStorage.setItem("reach_pricing_scenarios", JSON.stringify(scenarios)); } catch {}
  };

  const saveScenario = (name) => {
    if (!name.trim()) return;
    const next = [...savedScenarios, {
      id: Date.now(),
      name: name.trim(),
      savedAt: new Date().toLocaleDateString() + " " + new Date().toLocaleTimeString(),
      settings: JSON.parse(JSON.stringify(settings)),
      hybrid: JSON.parse(JSON.stringify(hybrid)),
    }];
    persistScenarios(next);
    setSaveNameDraft("");
    setShowSaveModal(false);
  };

  const loadScenario = (sc) => {
    setSettings(sc.settings);
    setHybrid(sc.hybrid);
    setTab("configure");
  };

  const deleteScenario = (id) => persistScenarios(savedScenarios.filter(s => s.id !== id));

  const set = k => v => setSettings(s => ({...s,[k]:v}));
  const setH = k => v => setHybrid(h => ({...h,[k]:v}));
  const setConnTierPrice = (k,v) => setSettings(s => ({...s,connTierPrices:{...s.connTierPrices,[k]:v}}));
  const setIntgFlat = (intg,v) => setSettings(s => ({...s,intgFlatPrices:{...s.intgFlatPrices,[intg]:v}}));
  const setIntgTier = (intg,k,v) => setSettings(s => ({...s,intgTierPrices:{...s.intgTierPrices,[intg]:{...s.intgTierPrices[intg],[k]:v}}}));
  const setIntgMode = (intg,mode) => setHybrid(h => ({...h,intgModes:{...h.intgModes,[intg]:mode}}));

  const handleFile = file => {
    Papa.parse(file, {
      header:true, skipEmptyLines:true, dynamicTyping:true,
      transformHeader: h => h.trim().replace(/\s+/g,' '),
      complete: ({data:rows}) => {
        const cleaned = rows.map(r => {
          const months = Math.max(getNum(r,"Months Active")||1,1);
          const conns  = getNum(r,"Connections");
          const billing = (col(r,"Billing Type")||"month").toString().toLowerCase().trim().startsWith("y")?"annual":"monthly";
          return {
            id: col(r,"Customer ID"), months, connections: conns, tier: getTier(conns), billing,
            mrr: getNum(r,"MRR"),
            integrations: {
              "QBO":          getNum(r,"QBO"),
              "QBD":          getNum(r,"QBD"),
              "Xero":         getNum(r,"Xero"),
              "CSV":          getNum(r,"CSV"),
              "Gusto":        getNum(r,"Gusto"),
              "Excel":        getNum(r,"Excel Sheets"),
              "Google Sheets":getNum(r,"Google Sheets"),
            },
            reportsPerMonth:       getNum(r,"Reports")/months,
            dashPerMonth:          getNum(r,"Dashboards")/months,
            downloadsPerMonth:     getNum(r,"Report Downloads")/months,
            dashPublishedPerMonth: getNum(r,"Dashboards Published")/months,
            templatesPerMonth:     getNum(r,"Templates")/months,
            budgetsProPerMonth:    getNum(r,"Budgets Pro")/months,
            reportsPerMonthSnap:       getNum(r,"Reports (Feb)"),
            dashPerMonthSnap:          getNum(r,"Dashboards (Feb)"),
            downloadsPerMonthSnap:     getNum(r,"Report Downloads (Feb)"),
            dashPublishedPerMonthSnap: getNum(r,"Dashboards Published (Feb)"),
            templatesPerMonthSnap:     getNum(r,"Templates (Feb)"),
            budgetsProPerMonthSnap:    getNum(r,"Budgets Pro (Feb)"),
            connectionsSnap:           getNum(r,"Connections (Feb)"),
          };
        }).filter(r=>r.connections>=0);
        setData(cleaned); setTab("overview");
      }
    });
  };

  const u = c => snapMode ? {
    reportsPerMonth: c.reportsPerMonthSnap??c.reportsPerMonth,
    dashPerMonth: c.dashPerMonthSnap??c.dashPerMonth,
    downloadsPerMonth: c.downloadsPerMonthSnap??c.downloadsPerMonth,
    dashPublishedPerMonth: c.dashPublishedPerMonthSnap??c.dashPublishedPerMonth,
    templatesPerMonth: c.templatesPerMonthSnap??c.templatesPerMonth,
    budgetsProPerMonth: c.budgetsProPerMonthSnap??c.budgetsProPerMonth,
    connections: c.connectionsSnap||c.connections,
  } : {
    reportsPerMonth: c.reportsPerMonth, dashPerMonth: c.dashPerMonth,
    downloadsPerMonth: c.downloadsPerMonth, dashPublishedPerMonth: c.dashPublishedPerMonth,
    templatesPerMonth: c.templatesPerMonth, budgetsProPerMonth: c.budgetsProPerMonth,
    connections: c.connections,
  };

  const calcAll = useCallback((customers,s,h,uFn) => {
    if (!customers) return null;
    const disc = 1-s.annualDiscount/100;
    const toMrr = (b,billing) => billing==="annual"?b*disc:b;
    const sum = (arr,k) => arr.reduce((a,x)=>a+(x[k]||0),0);
    const n = customers.length;
    const totalRepMo  = customers.reduce((a,c)=>a+c.reportsPerMonth,0);
    const totalDashMo = customers.reduce((a,c)=>a+c.dashPerMonth,0);
    const baseline   = customers.map(c=>({mrr:c.mrr,cash:c.mrr*12}));
    const hybridRows = customers.map(c=>{
      const uc={...c,...uFn(c)};
      const mrr = calcHybridMrr(uc, h, s);
      return {mrr, cash:mrr*12};
    });
    const mktAdd = h.useMarketplace ? mktMrrFor(s, totalRepMo, totalDashMo, n) : 0;
    return {
      baseline:{mrr:sum(baseline,"mrr"),cash:sum(baseline,"cash")},
      hybrid:{mrr:sum(hybridRows,"mrr")+mktAdd, cash:sum(hybridRows,"cash")+mktAdd*12},
    };
  },[]);

  const calcForecast = useCallback(() => {
    if (!data) return [];
    const disc=1-settings.annualDiscount/100, toMrr=(b,billing)=>billing==="annual"?b*disc:b, mult=forecastView==="arr"?12:1;
    return FORECAST_COUNTS.map(count => {
      const scaled = scaleCustomers(data,count), row={count};
      const scaledRepMo  = scaled.reduce((a,c)=>a+c.reportsPerMonth,0);
      const scaledDashMo = scaled.reduce((a,c)=>a+c.dashPerMonth,0);
      const mktAdd = hybrid.useMarketplace ? mktMrrFor(settings, scaledRepMo, scaledDashMo, scaled.length) : 0;
      if (forecastScenarios.current) row.current=scaled.reduce((s,c)=>s+c.mrr,0)*mult;
      if (forecastScenarios.hybrid)  row.hybrid=(scaled.reduce((s,c)=>s+calcHybridMrr(c,hybrid,settings),0)+mktAdd)*mult;
      return row;
    });
  },[data,settings,hybrid,forecastView,forecastScenarios]);

  const rev       = data ? calcAll(data,settings,hybrid,u) : null;
  const chartData = data && tab==="forecast" ? calcForecast() : [];

  const totalMrr     = data?data.reduce((a,c)=>a+c.mrr,0):0;
  const annualCount  = data?data.filter(c=>c.billing==="annual").length:0;
  const avgConn      = data?data.reduce((a,c)=>a+u(c).connections,0)/data.length:0;
  const avgRep       = data?data.reduce((a,c)=>a+u(c).reportsPerMonth,0)/data.length:0;
  const avgDownloads = data?data.reduce((a,c)=>a+u(c).downloadsPerMonth,0)/data.length:0;
  const avgDash      = data?data.reduce((a,c)=>a+u(c).dashPerMonth,0)/data.length:0;
  const avgTemplate  = data?data.reduce((a,c)=>a+u(c).templatesPerMonth,0)/data.length:0;
  const avgBudgets   = data?data.reduce((a,c)=>a+u(c).budgetsProPerMonth,0)/data.length:0;

  const tierBreakdown = data?TIERS.map(t=>{
    const g=data.filter(c=>c.tier.label===t.label);
    return {
      label:t.label, count:g.length, mrr:g.reduce((a,c)=>a+c.mrr,0),
      avgRep:      g.length?g.reduce((a,c)=>a+u(c).reportsPerMonth,0)/g.length:0,
      avgDownloads:g.length?g.reduce((a,c)=>a+u(c).downloadsPerMonth,0)/g.length:0,
      avgDash:     g.length?g.reduce((a,c)=>a+u(c).dashPerMonth,0)/g.length:0,
      avgTemplate: g.length?g.reduce((a,c)=>a+u(c).templatesPerMonth,0)/g.length:0,
      avgBudgets:  g.length?g.reduce((a,c)=>a+u(c).budgetsProPerMonth,0)/g.length:0,
      avgIntg:     Object.fromEntries(INTEGRATIONS.map(intg=>[intg, g.length?g.reduce((a,c)=>a+(c.integrations?.[intg]||0),0)/g.length:0])),
    };
  }).filter(t=>t.count>0):[];

  const totalCust=data?data.length:0;
  const totalReportsPerMo=data?data.reduce((a,c)=>a+u(c).reportsPerMonth,0):0;
  const totalDashPerMo=data?data.reduce((a,c)=>a+u(c).dashPerMonth,0):0;
  const totalDownloadsPerMo=data?data.reduce((a,c)=>a+u(c).downloadsPerMonth,0):0;
  const totalDashPubPerMo=data?data.reduce((a,c)=>a+u(c).dashPublishedPerMonth,0):0;
  const totalTemplatesPerMo=data?data.reduce((a,c)=>a+u(c).templatesPerMonth,0):0;
  const totalBudgetsProPerMo=data?data.reduce((a,c)=>a+u(c).budgetsProPerMonth,0):0;
  const mktReportListings=totalReportsPerMo*(settings.mktReportSellPct/100);
  const mktDashListings=totalDashPerMo*(settings.mktDashSellPct/100);
  const mktReportBuyers=(settings.mktReportBuyerPct/100)*totalCust;
  const mktDashBuyers=(settings.mktDashBuyerPct/100)*totalCust;
  const mktReportGMV=mktReportListings*mktReportBuyers*settings.mktReportSubPrice;
  const mktDashGMV=mktDashListings*mktDashBuyers*settings.mktDashSubPrice;
  const mktGMV=mktReportGMV+mktDashGMV;
  const mktReachRevMo=mktGMV*(settings.marketplaceTake/100);

  // ── Math summaries (post-discount, only when mode is active) ─────
  const disc = data ? 1-settings.annualDiscount/100 : 1;
  const applyDisc = (customers, fn) => customers ? customers.reduce((a,c)=>{
    const b=fn(c); return a+(c.billing==="annual"?b*disc:b);
  },0) : 0;

  const connMath = useMemo(()=>{
    if (!data || hybrid.connMode==="none") return null;
    if (hybrid.connMode==="current") {
      const total=data.reduce((a,c)=>a+c.mrr,0);
      return {lines:[{formula:`${data.length.toLocaleString()} customers · actual MRR`,subtotal:total}],total};
    }
    if (hybrid.connMode==="flat") {
  const total=applyDisc(data,c=>u(c).connections*settings.perConnectionPrice);
  const withConn=data.filter(c=>u(c).connections>0);
  const avgC=withConn.reduce((a,c)=>a+u(c).connections,0)/withConn.length;
  const lines=[{formula:`${withConn.length} customers × avg ${fmtD(avgC)} conns × $${settings.perConnectionPrice}/conn (flat)`,subtotal:total}];
  return {lines,total};
}
    if (hybrid.connMode==="tiered") {
      const tierGroups=[
        {label:"1 conn",       filter:c=>u(c).connections===1,                                   rate:`$${fmtD(settings.connTierPrices[1])} flat`},
        {label:"2–10 conns",   filter:c=>u(c).connections>=2&&u(c).connections<=10,              rate:"$290 flat (fixed bracket)"},
        {label:"11–24 conns",  filter:c=>u(c).connections>=11&&u(c).connections<=24,             rate:`$${fmtD(settings.connTierPrices[25])}/conn`},
        {label:"25–49 conns",  filter:c=>u(c).connections>=25&&u(c).connections<=49,             rate:`$${fmtD(settings.connTierPrices[50])}/conn`},
        {label:"50–99 conns",  filter:c=>u(c).connections>=50&&u(c).connections<=99,             rate:`$${fmtD(settings.connTierPrices[100])}/conn`},
        {label:"100–199 conns",filter:c=>u(c).connections>=100&&u(c).connections<=199,           rate:`$${fmtD(settings.connTierPrices[200])}/conn`},
        {label:"200–299 conns",filter:c=>u(c).connections>=200&&u(c).connections<=299,           rate:`$${fmtD(settings.connTierPrices[300])}/conn`},
        {label:"300+ conns",   filter:c=>u(c).connections>=300,                                  rate:`$${fmtD(settings.connTierPrices[300])}/conn`},
      ];
      const lines=tierGroups.map(({label,filter,rate})=>{
        const g=data.filter(filter); if (!g.length) return null;
        const avgC=g.reduce((a,c)=>a+u(c).connections,0)/g.length;
        const subtotal=applyDisc(g,c=>calcConnPriceWithRates(u(c).connections,settings.connTierPrices));
        return {formula:`${g.length} customers (${label}) × avg ${fmtD(avgC)} × ${rate}`,subtotal};
      }).filter(Boolean);
      const total=applyDisc(data,c=>calcConnPriceWithRates(u(c).connections,settings.connTierPrices));
      return {lines,total};
    }
    return null;
  },[data,hybrid.connMode,settings,snapMode]);

  const intgMath = useMemo(()=>{
    if (!data) return {};
    return Object.fromEntries(INTEGRATIONS.map(intg=>{
      const mode=hybrid.intgModes?.[intg]||"none";
      if (mode==="none") return [intg,null];
      const tp=settings.intgTierPrices[intg], fp=settings.intgFlatPrices[intg];
      const total=applyDisc(data,c=>calcIntgPrice(c.integrations?.[intg]||0,mode,fp,tp));
      if (mode==="flat") {
        const withIntg=data.filter(c=>(c.integrations?.[intg]||0)>0);
        const totalUnits=withIntg.reduce((a,c)=>a+(c.integrations?.[intg]||0),0);
        const avgN=withIntg.length?totalUnits/withIntg.length:0;
        return [intg,{lines:[{formula:`${withIntg.length} customers × avg ${fmtD(avgN)} ${intg} units × ${fp}/unit (flat)`,subtotal:total}],total}];
      }
      // tiered — one line per bracket
      // Key mapping: CONN_TIER_DEFS keys are {1,10,25,50,100,200,300}
      // label "2–10" → key 10, "11–24" → key 25, "25–49" → key 50, "50–99" → key 100, "100–199" → key 200, "200–299" → key 300
      const tierGroups=[
        {label:"1 unit",       filter:c=>(c.integrations?.[intg]||0)===1,                                     rate:`$${fmtD(tp[1])}/unit`},
        {label:"2–10 units",   filter:c=>{const n=c.integrations?.[intg]||0;return n>=2&&n<=10;},             rate:`$${fmtD(tp[10])}/unit`},
        {label:"11–24 units",  filter:c=>{const n=c.integrations?.[intg]||0;return n>=11&&n<=24;},            rate:`$${fmtD(tp[25])}/unit`},
        {label:"25–49 units",  filter:c=>{const n=c.integrations?.[intg]||0;return n>=25&&n<=49;},            rate:`$${fmtD(tp[50])}/unit`},
        {label:"50–99 units",  filter:c=>{const n=c.integrations?.[intg]||0;return n>=50&&n<=99;},            rate:`$${fmtD(tp[100])}/unit`},
        {label:"100–199 units",filter:c=>{const n=c.integrations?.[intg]||0;return n>=100&&n<=199;},          rate:`$${fmtD(tp[200])}/unit`},
        {label:"200+ units",   filter:c=>(c.integrations?.[intg]||0)>=200,                                    rate:`$${fmtD(tp[300])}/unit`},
      ];
      const lines=tierGroups.map(({label,filter,rate})=>{
        const g=data.filter(filter); if (!g.length) return null;
        const avgN=g.reduce((a,c)=>a+(c.integrations?.[intg]||0),0)/g.length;
        const subtotal=applyDisc(g,c=>calcIntgPrice(c.integrations?.[intg]||0,mode,fp,tp));
        return {formula:`${g.length} customers (${label}) × avg ${fmtD(avgN)} × ${rate}`,subtotal};
      }).filter(Boolean);
      return [intg,{lines,total}];
    }));
  },[data,hybrid.intgModes,settings,snapMode]);

  const reportMath = useMemo(()=>{
    if (!data) return null;
    if (hybrid.useReportMonthly) {
      const total=applyDisc(data,c=>u(c).reportsPerMonth*settings.perReportMonthly);
      return {formula:`${data.length.toLocaleString()} customers × avg ${fmtD(totalReportsPerMo/data.length)} reports/mo × $${settings.perReportMonthly}/report`, total};
    }
    if (hybrid.useReportPayPerUse) {
      const total=applyDisc(data,c=>u(c).downloadsPerMonth*settings.perReportUse);
      return {formula:`${data.length.toLocaleString()} customers × avg ${fmtD(totalDownloadsPerMo/data.length)} downloads/mo × $${settings.perReportUse}/download`, total};
    }
    if (hybrid.useReportPacks) {
      const total=applyDisc(data,c=>u(c).reportsPerMonth>0?Math.ceil(u(c).reportsPerMonth/settings.reportPackSize)*settings.reportPackPrice:0);
      return {formula:`avg ${fmtD(totalReportsPerMo/data.length)} reports/mo → ceil(÷${settings.reportPackSize}) packs × $${settings.reportPackPrice}`, total};
    }
    return null;
  },[data,hybrid,settings,snapMode]);

  const dashMath = useMemo(()=>{
    if (!data) return null;
    if (hybrid.useDashMonthly) {
      const total=applyDisc(data,c=>u(c).dashPerMonth*settings.perDashboardMonthly);
      return {formula:`${data.length.toLocaleString()} customers × avg ${fmtD(totalDashPerMo/data.length)} dashboards/mo × $${settings.perDashboardMonthly}/dashboard`, total};
    }
    if (hybrid.useDashPayPerUse) {
      const total=applyDisc(data,c=>u(c).dashPublishedPerMonth*settings.perDashboardUse);
      return {formula:`${data.length.toLocaleString()} customers × avg ${fmtD(totalDashPubPerMo/data.length)} publishes/mo × $${settings.perDashboardUse}/publish`, total};
    }
    if (hybrid.useDashPacks) {
      const total=applyDisc(data,c=>u(c).dashPerMonth>0?Math.ceil(u(c).dashPerMonth/settings.dashPackSize)*settings.dashPackPrice:0);
      return {formula:`avg ${fmtD(totalDashPerMo/data.length)} dashboards/mo → ceil(÷${settings.dashPackSize}) packs × $${settings.dashPackPrice}`, total};
    }
    return null;
  },[data,hybrid,settings,snapMode]);

  const templateMath = useMemo(()=>{
    if (!data) return null;
    if (hybrid.useTemplateMonthly) {
      const total=applyDisc(data,c=>u(c).templatesPerMonth*settings.perTemplateMonthly);
      return {formula:`${data.length.toLocaleString()} customers × avg ${fmtD(totalTemplatesPerMo/data.length)} templates/mo × $${settings.perTemplateMonthly}/template`, total};
    }
    if (hybrid.useTemplatePacks) {
      const total=applyDisc(data,c=>u(c).templatesPerMonth>0?Math.ceil(u(c).templatesPerMonth/settings.templatePackSize)*settings.templatePackPrice:0);
      return {formula:`avg ${fmtD(totalTemplatesPerMo/data.length)} templates/mo → ceil(÷${settings.templatePackSize}) packs × $${settings.templatePackPrice}`, total};
    }
    return null;
  },[data,hybrid,settings,snapMode]);

  const budgetsMath = useMemo(()=>{
    if (!data) return null;
    if (hybrid.useBudgetsProMonthly) {
      const total=applyDisc(data,c=>u(c).budgetsProPerMonth*settings.perBudgetsProMonthly);
      return {formula:`${data.length.toLocaleString()} customers × avg ${fmtD(totalBudgetsProPerMo/data.length)} uses/mo × $${settings.perBudgetsProMonthly}/use`, total};
    }
    if (hybrid.useBudgetsProPacks) {
      const total=applyDisc(data,c=>u(c).budgetsProPerMonth>0?Math.ceil(u(c).budgetsProPerMonth/settings.budgetsProPackSize)*settings.budgetsProPackPrice:0);
      return {formula:`avg ${fmtD(totalBudgetsProPerMo/data.length)} uses/mo → ceil(÷${settings.budgetsProPackSize}) packs × $${settings.budgetsProPackPrice}`, total};
    }
    return null;
  },[data,hybrid,settings,snapMode]);

  const mktMath = useMemo(()=>{
    if (!data||!hybrid.useMarketplace) return null;
    const total=mktMrrFor(settings,totalReportsPerMo,totalDashPerMo,totalCust);
    return {
      formula:`${Math.round(mktReportListings).toLocaleString()} report listings × ${Math.round(mktReportBuyers).toLocaleString()} buyers × $${settings.mktReportSubPrice}/mo + ${Math.round(mktDashListings).toLocaleString()} dash listings × ${Math.round(mktDashBuyers).toLocaleString()} buyers × $${settings.mktDashSubPrice}/mo · ${settings.marketplaceTake}% take`,
      total
    };
  },[data,hybrid.useMarketplace,settings,totalReportsPerMo,totalDashPerMo,totalCust]);

  const reconRows = useMemo(()=>{
    if (!data) return [];
    const n=data.length;
    const disc=1-settings.annualDiscount/100;
    const toMrr=(b,billing)=>billing==="annual"?b*disc:b;
    const totalRepMo  = data.reduce((a,c)=>a+c.reportsPerMonth,0);
    const totalDashMo = data.reduce((a,c)=>a+c.dashPerMonth,0);
    const mktTotal = hybrid.useMarketplace ? mktMrrFor(settings, totalRepMo, totalDashMo, n) : 0;
    const mktPerCust = n > 0 ? mktTotal / n : 0;
    return data.map(r=>{
      const uc={...r,...u(r)};
      const h=hybrid, s=settings;
      // Total hybrid MRR via single source of truth
      const hybridMrr = calcHybridMrr(uc, h, s) + mktPerCust;
      // Per-component breakdown for display columns
      const connMrr = h.connMode==="current" ? r.mrr
        : h.connMode==="flat"   ? toMrr(uc.connections*s.perConnectionPrice, r.billing)
        : h.connMode==="tiered" ? toMrr(calcConnPriceWithRates(uc.connections,s.connTierPrices), r.billing)
        : 0;
      const intgMrr = Object.fromEntries(INTEGRATIONS.map(intg=>[
        intg, toMrr(calcIntgPrice(uc.integrations?.[intg]||0, h.intgModes?.[intg]||"none", s.intgFlatPrices[intg], s.intgTierPrices[intg]), r.billing)
      ]));
      const repBase = h.useReportMonthly   ? uc.reportsPerMonth*s.perReportMonthly
        : h.useReportPayPerUse ? uc.downloadsPerMonth*s.perReportUse
        : h.useReportPacks     ? (uc.reportsPerMonth>0?Math.ceil(uc.reportsPerMonth/s.reportPackSize)*s.reportPackPrice:0) : 0;
      const dashBase = h.useDashMonthly    ? uc.dashPerMonth*s.perDashboardMonthly
        : h.useDashPayPerUse   ? uc.dashPublishedPerMonth*s.perDashboardUse
        : h.useDashPacks       ? (uc.dashPerMonth>0?Math.ceil(uc.dashPerMonth/s.dashPackSize)*s.dashPackPrice:0) : 0;
      const tmplBase = h.useTemplateMonthly    ? uc.templatesPerMonth*s.perTemplateMonthly
        : h.useTemplatePacks     ? (uc.templatesPerMonth>0?Math.ceil(uc.templatesPerMonth/s.templatePackSize)*s.templatePackPrice:0) : 0;
      const bproBase = h.useBudgetsProMonthly    ? uc.budgetsProPerMonth*s.perBudgetsProMonthly
        : h.useBudgetsProPacks     ? (uc.budgetsProPerMonth>0?Math.ceil(uc.budgetsProPerMonth/s.budgetsProPackSize)*s.budgetsProPackPrice:0) : 0;
      const breakdown = {
        conn: connMrr,
        intg: intgMrr,
        rep:  toMrr(repBase,  r.billing),
        dash: toMrr(dashBase, r.billing),
        tmpl: toMrr(tmplBase, r.billing),
        bpro: toMrr(bproBase, r.billing),
        mkt:  mktPerCust,
      };
      const hybridDiff = hybridMrr - r.mrr;
      const hybridDiffPct = r.mrr !== 0 ? (hybridDiff / r.mrr * 100) : null;
      return {...r, hybridMrr, hybridDiff, hybridDiffPct, breakdown};
    });
  },[data,settings,hybrid,snapMode]);

  const reconTotals = useMemo(()=>{
    if (!reconRows.length) return null;
    return {
      actMrr:    reconRows.reduce((s,r)=>s+r.mrr,0),
      hybridMrr: reconRows.reduce((s,r)=>s+r.hybridMrr,0),
      hybridOver:  reconRows.filter(r=>r.hybridDiff>0.01).length,
      hybridUnder: reconRows.filter(r=>r.hybridDiff<-0.01).length,
      hybridExact: reconRows.filter(r=>Math.abs(r.hybridDiff)<=0.01).length,
    };
  },[reconRows]);

  const reconSorted = useMemo(()=>{
    if (!reconRows.length) return [];
    let rows=[...reconRows];
    if (reconSearch.trim()){const q=reconSearch.trim().toLowerCase();rows=rows.filter(r=>String(r.id).toLowerCase().includes(q));}
    if (reconFilter==="over")  rows=rows.filter(r=>r.hybridDiff>0.01);
    if (reconFilter==="under") rows=rows.filter(r=>r.hybridDiff<-0.01);
    if (reconFilter==="exact") rows=rows.filter(r=>Math.abs(r.hybridDiff)<=0.01);
    if (reconTierFilter!=="all") rows=rows.filter(r=>r.tier.label===reconTierFilter);
    rows.sort((a,b)=>{
      const av=a[reconSort.col]!=null?a[reconSort.col]:-Infinity, bv=b[reconSort.col]!=null?b[reconSort.col]:-Infinity;
      return reconSort.dir==="asc"?av-bv:bv-av;
    });
    return rows;
  },[reconRows,reconSort,reconFilter,reconTierFilter,reconSearch]);

  const reconPageRows=reconSorted.slice(reconPage*RECON_PAGE_SIZE,(reconPage+1)*RECON_PAGE_SIZE);
  const reconTotalPages=Math.ceil(reconSorted.length/RECON_PAGE_SIZE);
  const toggleReconSort=c=>setReconSort(s=>({col:c,dir:s.col===c&&s.dir==="desc"?"asc":"desc"}));
  const filteredActMrr=reconSorted.reduce((s,r)=>s+r.mrr,0);
  const filteredHybridMrr=reconSorted.reduce((s,r)=>s+r.hybridMrr,0);

  if (!authed) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{background:"linear-gradient(135deg,#023E8A 0%,#00B4D8 100%)"}}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm" style={{boxShadow:"0 25px 60px rgba(2,62,138,0.35)"}}>
        <div className="text-center mb-8">
          <img src="/reach-pricing-tool/logo.png" alt="Reach Reporting" className="h-10 w-auto mx-auto mb-4"/>
          <h1 className="text-2xl font-extrabold text-gray-800">Pricing Model</h1>
          <p className="text-sm text-gray-400 mt-1 font-medium">Internal use only</p>
        </div>
        <input type="password" placeholder="Enter password" value={pw} onChange={e=>{setPw(e.target.value);setPwErr(false);}} onKeyDown={e=>{if(e.key==="Enter"){if(pw===PASSWORD)setAuthed(true);else setPwErr(true);}}} className={"w-full border-2 rounded-xl px-4 py-3 text-sm mb-3 outline-none transition "+(pwErr?"border-rose-400 bg-rose-50":"border-gray-200 focus:border-blue-400")} />
        {pwErr&&<p className="text-xs text-rose-500 mb-3 font-medium">Incorrect password. Try again.</p>}
        <button onClick={()=>{if(pw===PASSWORD)setAuthed(true);else setPwErr(true);}} className="w-full text-white rounded-xl py-3 text-sm font-bold tracking-wide transition hover:opacity-90" style={{background:"linear-gradient(90deg,#023E8A,#00B4D8)"}}>Access Tool →</button>
      </div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{background:"linear-gradient(135deg,#023E8A 0%,#00B4D8 100%)"}}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/reach-pricing-tool/logo.png" alt="Reach Reporting" className="h-10 w-auto mx-auto mb-4"/>
          <h1 className="text-xl font-extrabold text-gray-800">Pricing Model</h1>
          <p className="text-sm text-gray-500 mt-1">Upload your anonymized customer CSV to begin</p>
        </div>
        <div onClick={()=>fileRef.current.click()} className="rounded-xl p-8 text-center cursor-pointer transition mb-4" style={{border:`2px dashed ${R.primary}`,background:R.primaryLighter}}>
          <p className="text-3xl mb-2">📁</p>
          <p className="text-sm font-medium" style={{color:R.primaryText}}>Click to upload CSV</p>
          <p className="text-xs text-gray-400 mt-1">customer_usage_Feb2026.csv</p>
        </div>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e=>e.target.files[0]&&handleFile(e.target.files[0])} />
        <p className="text-xs text-gray-400 text-center">⚠️ Data processed locally only.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{background:"#f1f5f9"}}>
      {/* Header */}
      <div className="text-white px-6 py-0 flex items-stretch justify-between" style={{background:"linear-gradient(100deg,#023E8A 0%,#0096B7 60%,#00B4D8 100%)",boxShadow:"0 4px 24px rgba(2,62,138,0.25)"}}>
        <div className="flex items-center gap-4 py-3">
          <img src="/reach-pricing-tool/reach_white.png" alt="Reach Reporting" className="h-6 w-auto" />
          <div className="w-px h-8 bg-white opacity-20"/>
          <div>
            <h1 className="text-sm font-extrabold tracking-tight leading-none opacity-90">Pricing Model</h1>
            <p className="text-xs mt-1 font-medium" style={{color:"#90E0EF"}}>{data.length.toLocaleString()} customers · Feb 2026</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tab==="forecast"&&<>
            <button onClick={()=>setForecastView("mrr")} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition" style={forecastView==="mrr"?{background:"#fff",color:R.primaryText}:{background:"rgba(255,255,255,0.15)",color:"#fff"}}>MRR</button>
            <button onClick={()=>setForecastView("arr")} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition" style={forecastView==="arr"?{background:"#fff",color:R.primaryText}:{background:"rgba(255,255,255,0.15)",color:"#fff"}}>ARR</button>
          </>}
          <button onClick={()=>setSnapMode(m=>!m)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition" style={snapMode?{background:"#fff",color:R.primaryText}:{background:"rgba(255,255,255,0.15)",color:"#fff"}}>{snapMode?"📸 Feb Snapshot":"📊 Lifetime Avg"}</button>
          <button onClick={()=>setData(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition" style={{background:"rgba(255,255,255,0.15)",color:"#fff"}}>↑ New File</button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="px-6 flex gap-0 overflow-x-auto" style={{background:"#fff",borderBottom:"1px solid #e2e8f0",boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}>
        {[["overview","📈 Overview"],["configure","⚙️ Configure"],["scenarios","💾 Scenarios"+(savedScenarios.length>0?` (${savedScenarios.length})`:"")],["forecast","🔮 Forecast"],["recommendation","💡 Recommendation"],["reconciliation","🔍 Reconciliation"],["industry","🏭 Industry"]].map(([k,l])=>(
          <Tab key={k} active={tab===k} onClick={()=>setTab(k)}>{l}</Tab>
        ))}
      </div>

      <div className="p-6 max-w-7xl mx-auto">

        {/* OVERVIEW */}
        {tab==="overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <MetricBox label="Current MRR" value={fmt(totalMrr)} color="reach" icon="💰"/>
              <MetricBox label="Current ARR" value={fmt(totalMrr*12)} color="reach" icon="📅"/>
              <MetricBox label="Total Customers" value={data.length.toLocaleString()} color="reach" icon="👥"/>
              <MetricBox label="Annual Customers" value={annualCount+" ("+(annualCount/data.length*100).toFixed(1)+"%)"} sub={(data.length-annualCount)+" monthly"} color="amber" icon="📆"/>
              <MetricBox label="Monthly Customers" value={(data.length-annualCount)+" ("+(((data.length-annualCount)/data.length)*100).toFixed(1)+"%)"} color="amber" icon="🗓️"/>
              <MetricBox label="Avg MRR / Customer" value={fmt(totalMrr/data.length)} color="reach" icon="📊"/>
              <MetricBox label="Avg Connections" value={fmtD(avgConn)} color="reach" icon="🔗"/>
              <MetricBox label="Avg Reports/mo" value={fmtD(avgRep)} color="reach" icon="📄"/>
              <MetricBox label="Avg Downloads/mo" value={fmtD(avgDownloads)} color="reach" icon="⬇️"/>
              <MetricBox label="Avg Dashboards/mo" value={fmtD(avgDash)} color="reach" icon="📊"/>
              <MetricBox label="Avg Templates/mo" value={fmtD(avgTemplate)} color="reach" icon="📋"/>
              <MetricBox label="Avg Budgets Pro/mo" value={fmtD(avgBudgets)} color="reach" icon="💰"/>
            </div>

            {/* MRR by Tier bar chart */}
            <Card>
              <h2 className="font-extrabold text-gray-800 text-base mb-5 flex items-center gap-2">💰 MRR by Connection Tier</h2>
              <div className="space-y-3">
                {tierBreakdown.filter(t=>t.count>0).map((t,i)=>{
                  const pct = totalMrr > 0 ? (t.mrr/totalMrr*100) : 0;
                  const tierColors = ["#023E8A","#0077B6","#0096B7","#00B4D8","#48CAE4","#90E0EF","#ADE8F4","#CAF0F8"];
                  const color = tierColors[i % tierColors.length];
                  return (
                    <div key={t.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold text-gray-600">{t.label}</span>
                        <span className="font-bold" style={{color}}>{fmt(t.mrr)} <span className="text-gray-400 font-normal">· {t.count} customers · {pct.toFixed(1)}%</span></span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                        <div className="h-3 rounded-full transition-all duration-500" style={{width:pct.toFixed(1)+"%",background:`linear-gradient(90deg,${color},${color}bb)`}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card>
              <h2 className="font-extrabold text-gray-800 text-base mb-4 flex items-center gap-2"><span>📊</span> Customers by Connection Tier</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 pr-3">Tier</th>
                    <th className="pb-2 pr-3">Customers</th>
                    <th className="pb-2 pr-3">%</th>
                    <th className="pb-2 pr-3">MRR</th>
                    <th className="pb-2 pr-3">Rep Created/mo</th>
                    <th className="pb-2 pr-3">Rep Downloads/mo</th>
                    <th className="pb-2 pr-3">Avg Dash/mo</th>
                    <th className="pb-2 pr-3">Avg Tmpl/mo</th>
                    <th className="pb-2 pr-3">Avg BPro/mo</th>
                    {INTEGRATIONS.map(intg=><th key={intg} className="pb-2 pr-3 whitespace-nowrap">{"Avg "+intg}</th>)}
                  </tr></thead>
                  <tbody>
                    {tierBreakdown.map(t=>(
                      <tr key={t.label} className="border-b last:border-0">
                        <td className="py-2 pr-3 font-medium">{t.label}</td>
                        <td className="py-2 pr-3">{t.count}</td>
                        <td className="py-2 pr-3">{(t.count/data.length*100).toFixed(1)}%</td>
                        <td className="py-2 pr-3">{fmt(t.mrr)}</td>
                        <td className="py-2 pr-3">{fmtD(t.avgRep)}</td>
                        <td className="py-2 pr-3">{fmtD(t.avgDownloads)}</td>
                        <td className="py-2 pr-3">{fmtD(t.avgDash)}</td>
                        <td className="py-2 pr-3">{fmtD(t.avgTemplate)}</td>
                        <td className="py-2 pr-3">{fmtD(t.avgBudgets)}</td>
                        {INTEGRATIONS.map(intg=><td key={intg} className="py-2 pr-3">{fmtD(t.avgIntg[intg]||0)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <h2 className="font-extrabold text-gray-800 text-base mb-4">Customers by Tenure</h2>
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-500 border-b text-left"><th className="pb-2">Tenure</th><th className="pb-2">Customers</th><th className="pb-2">Avg MRR</th></tr></thead>
                  <tbody>{[["0–6 mo",0,6],["7–12 mo",7,12],["13–24 mo",13,24],["25+ mo",25,9999]].map(([label,lo,hi])=>{
                    const g=data.filter(c=>c.months>=lo&&c.months<=hi);
                    return <tr key={label} className="border-b last:border-0"><td className="py-1.5">{label}</td><td className="py-1.5">{g.length}</td><td className="py-1.5">{fmt(g.reduce((a,c)=>a+c.mrr,0)/Math.max(g.length,1))}</td></tr>;
                  })}</tbody>
                </table>
              </Card>
              <Card>
                <h2 className="font-extrabold text-gray-800 text-base mb-4">Monthly vs Annual Billing</h2>
                {["monthly","annual"].map(bt=>{
                  const g=data.filter(c=>c.billing===bt);
                  return (<div key={bt} className="mb-4">
                    <div className="flex justify-between text-sm mb-1"><span className="capitalize font-medium">{bt}</span><span className="text-gray-500">{g.length} · {fmt(g.reduce((a,c)=>a+c.mrr,0))} MRR</span></div>
                    <div className="w-full bg-gray-100 rounded-full h-3"><div className="h-3 rounded-full" style={{width:(g.length/data.length*100).toFixed(1)+"%",background:R.primary}}/></div>
                    <p className="text-xs text-gray-400 mt-0.5">{(g.length/data.length*100).toFixed(1)}% of customers</p>
                  </div>);
                })}
              </Card>
              {[{label:"Report Usage / mo",field:"reportsPerMonth"},{label:"Dashboard Usage / mo",field:"dashPerMonth"},{label:"Template Usage / mo",field:"templatesPerMonth"},{label:"Budgets Pro Usage / mo",field:"budgetsProPerMonth"}].map(({label,field})=>(
                <Card key={field}>
                  <h2 className="font-extrabold text-gray-800 text-base mb-4">{label}</h2>
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-gray-500 border-b text-left"><th className="pb-2">Range</th><th className="pb-2">Customers</th><th className="pb-2">%</th></tr></thead>
                    <tbody>{[[0,0.009,"0"],[0.01,0.999,"<1"],[1,4.999,"1–5"],[5,19.999,"5–20"],[20,99999,"20+"]].map(([lo,hi,lbl])=>{
                      const g=data.filter(c=>(c[field]||0)>=lo&&(c[field]||0)<=hi);
                      return <tr key={lbl} className="border-b last:border-0"><td className="py-1.5">{lbl}</td><td className="py-1.5">{g.length}</td><td className="py-1.5">{(g.length/data.length*100).toFixed(1)}%</td></tr>;
                    })}</tbody>
                  </table>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* CONFIGURE */}
        {tab==="configure" && rev && (
          <div className="space-y-4">
            <div className="sticky top-0 z-20 rounded-2xl p-5" style={{background:"linear-gradient(135deg,#FFFBEB,#FEF3C7)",border:"2px solid #FCD34D",boxShadow:"0 4px 20px rgba(245,158,11,0.2)"}}>
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-0.5">🧩 Hybrid MRR</p>
                  <p className="text-3xl font-extrabold text-gray-800 leading-none">{fmt(rev.hybrid.mrr)}</p>
                </div>
                <div className="h-10 w-px bg-amber-200 hidden sm:block"/>
                <div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">ARR</p><p className="text-xl font-bold text-gray-700">{fmt(rev.hybrid.mrr*12)}</p></div>
                <div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">12-mo Cash Flow</p><p className="text-xl font-bold text-gray-700">{fmt(rev.hybrid.cash)}</p></div>
                <div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">vs Current MRR</p><p className={"text-xl font-bold "+(rev.hybrid.mrr>=rev.baseline.mrr?"text-green-600":"text-rose-600")}>{fmt(rev.hybrid.mrr-rev.baseline.mrr)}</p></div>
                <div><p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">vs Current ARR</p><p className={"text-xl font-bold "+(rev.hybrid.mrr>=rev.baseline.mrr?"text-green-600":"text-rose-600")}>{fmt((rev.hybrid.mrr-rev.baseline.mrr)*12)}</p></div>
                <div className="ml-auto flex items-center gap-3">
                  {pctDelta(rev.hybrid.mrr,rev.baseline.mrr)}
                  <button onClick={()=>setShowSaveModal(true)} className="px-3 py-1.5 rounded-lg text-xs font-bold transition" style={{background:"#f0fdf4",color:"#166534",border:"1px solid #86efac"}}>💾 Save Scenario</button>
                  <button onClick={()=>{setSettings(DEFAULT_SETTINGS);setHybrid(DEFAULT_HYBRID);}} className="px-3 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-xs font-bold hover:bg-rose-100">Reset All</button>
                </div>
              </div>
              <div className="mt-3 space-y-1">
                {[{label:"Current",val:rev.baseline.mrr,color:R.primary},{label:"🧩 Hybrid",val:rev.hybrid.mrr,color:"#f59e0b"}].map(({label,val,color})=>{
                  const maxVal=Math.max(rev.baseline.mrr,rev.hybrid.mrr);
                  return (
                    <div key={label} className="flex items-center gap-2">
                      <span className="text-xs w-16 flex-shrink-0 text-gray-500">{label}</span>
                      <div className="flex-1 bg-white bg-opacity-60 rounded-full h-3 overflow-hidden">
                        <div className="h-3 rounded-full transition-all" style={{width:(maxVal>0?(val/maxVal*100):0).toFixed(1)+"%",background:color}}/>
                      </div>
                      <span className="text-xs font-semibold w-20 text-right flex-shrink-0">{fmt(val)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <Card>
              <div className="flex items-center gap-6">
                <p className="text-sm font-semibold text-gray-700 w-40 flex-shrink-0">📅 Annual Discount</p>
                <div className="flex-1">
                  <Slider label="Annual billing discount" value={settings.annualDiscount} min={0} max={50} step={1} onChange={set("annualDiscount")} suffix="%" hint="Applied to all annual customers" color="#6b7280"/>
                </div>
              </div>
            </Card>

            {/* CONNECTIONS */}
            <GroupDivider label="🔗 Connections" color="#6366f1"/>
            <SectionCard color="#6366f1">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pricing Mode</p>
                  {[
                    {mode:"none",   label:"No connection base",   hint:"$0 — add-ons only"},
                    {mode:"current",label:"Current MRR",          hint:"Use actual billed amount"},
                    {mode:"flat",   label:"Flat per-connection",   hint:"All connections × flat rate"},
                    {mode:"tiered", label:"Tiered per-connection", hint:"Connections × tier rate"},
                  ].map(({mode,label,hint})=>(
                    <RadioOpt key={mode} name="connMode" value={mode} checked={hybrid.connMode===mode} onChange={()=>setH("connMode")(mode)} label={label} hint={hint} color="#6366f1"/>
                  ))}
                </div>
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-8">
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Flat Rate</p>
                    <Slider label="Per connection / mo" value={settings.perConnectionPrice} min={1} max={100} step={1} onChange={set("perConnectionPrice")} prefix="$" color="#6366f1"/>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Tiered Rates</p>
                    {CONN_TIER_DEFS.map(({label,key,sliderMax})=>(
                      <Slider key={key} label={label} value={settings.connTierPrices[key]} min={1} max={sliderMax} step={0.5} onChange={v=>setConnTierPrice(key,v)} prefix="$" suffix="/conn/mo" color="#6366f1"/>
                    ))}
                  </div>
                </div>
              </div>
              {connMath && <MathSummary lines={connMath.lines} total={connMath.total} color="#6366f1"/>}
            </SectionCard>

            {/* INTEGRATIONS */}
            <GroupDivider label="🔌 Integrations" color={INTG_COLOR}/>
            {INTEGRATIONS.map(intg=>(
              <SectionCard key={intg} color={INTG_COLOR}>
                <p className="text-sm font-extrabold mb-3" style={{color:INTG_COLOR}}>{intg}</p>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pricing Mode</p>
                    {[
                      {mode:"none",   label:"No "+intg+" base", hint:"Exclude from pricing"},
                      {mode:"flat",   label:"Flat rate",         hint:"Units × flat rate"},
                      {mode:"tiered", label:"Tiered rate",       hint:"Units × tier rate"},
                    ].map(({mode,label,hint})=>(
                      <RadioOpt key={mode} name={"intg_"+intg} value={mode} checked={(hybrid.intgModes?.[intg]||"none")===mode} onChange={()=>setIntgMode(intg,mode)} label={label} hint={hint} color={INTG_COLOR}/>
                    ))}
                  </div>
                  <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-8">
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Flat Rate</p>
                      <Slider label={`Per ${intg} / mo`} value={settings.intgFlatPrices[intg]} min={1} max={100} step={1} onChange={v=>setIntgFlat(intg,v)} prefix="$" color={INTG_COLOR}/>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Tiered Rates</p>
                      {CONN_TIER_DEFS.map(({label,key})=>(
                        <Slider key={key} label={label} value={settings.intgTierPrices[intg][key]} min={0.5} max={key===1?150:50} step={0.5} onChange={v=>setIntgTier(intg,key,v)} prefix="$" suffix="/unit/mo" color={INTG_COLOR}/>
                      ))}
                    </div>
                  </div>
                </div>
                {intgMath[intg] && <MathSummary lines={intgMath[intg].lines} total={intgMath[intg].total} color={INTG_COLOR}/>}
              </SectionCard>
            ))}

            {/* REPORTS */}
            <GroupDivider label="📄 Reports" color={R.primary}/>
            <SectionCard color={R.primary}>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pricing Mode</p>
                  {[
                    {k:"useReportMonthly",   label:"Monthly fee", off:["useReportPayPerUse","useReportPacks"]},
                    {k:"useReportPayPerUse", label:"Pay-per-use", off:["useReportMonthly","useReportPacks"]},
                    {k:"useReportPacks",     label:"Packs",       off:["useReportMonthly","useReportPayPerUse"]},
                  ].map(({k,label,off})=>(
                    <ToggleOpt key={k} label={label} checked={hybrid[k]} onChange={v=>{setH(k)(v);if(v)off.forEach(o=>setH(o)(false));}} color={R.primary}/>
                  ))}
                </div>
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-x-6">
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Monthly Fee</p><Slider label="Per report / mo" value={settings.perReportMonthly} min={1} max={50} step={0.5} onChange={set("perReportMonthly")} prefix="$" color={R.primary}/></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pay-Per-Use</p><Slider label="Per download" value={settings.perReportUse} min={0.10} max={5} step={0.05} onChange={set("perReportUse")} prefix="$" color={R.primary}/></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Packs</p><Slider label="Reports per pack" value={settings.reportPackSize} min={5} max={50} step={5} onChange={set("reportPackSize")} suffix=" reports" color={R.primary}/><Slider label="Pack price" value={settings.reportPackPrice} min={10} max={200} step={5} onChange={set("reportPackPrice")} prefix="$" color={R.primary}/></div>
                </div>
              </div>
              {reportMath && <MathSummary lines={[{formula:reportMath.formula,subtotal:reportMath.total}]} total={reportMath.total} color={R.primary}/>}
            </SectionCard>

            {/* DASHBOARDS */}
            <GroupDivider label="📊 Dashboards" color="#10b981"/>
            <SectionCard color="#10b981">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pricing Mode</p>
                  {[
                    {k:"useDashMonthly",   label:"Monthly fee", off:["useDashPayPerUse","useDashPacks"]},
                    {k:"useDashPayPerUse", label:"Pay-per-use", off:["useDashMonthly","useDashPacks"]},
                    {k:"useDashPacks",     label:"Packs",       off:["useDashMonthly","useDashPayPerUse"]},
                  ].map(({k,label,off})=>(
                    <ToggleOpt key={k} label={label} checked={hybrid[k]} onChange={v=>{setH(k)(v);if(v)off.forEach(o=>setH(o)(false));}} color="#10b981"/>
                  ))}
                </div>
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-x-6">
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Monthly Fee</p><Slider label="Per dashboard / mo" value={settings.perDashboardMonthly} min={1} max={50} step={0.5} onChange={set("perDashboardMonthly")} prefix="$" color="#10b981"/></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pay-Per-Use</p><Slider label="Per publish" value={settings.perDashboardUse} min={0.10} max={5} step={0.05} onChange={set("perDashboardUse")} prefix="$" color="#10b981"/></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Packs</p><Slider label="Dashboards per pack" value={settings.dashPackSize} min={5} max={50} step={5} onChange={set("dashPackSize")} suffix=" dashboards" color="#10b981"/><Slider label="Pack price" value={settings.dashPackPrice} min={10} max={200} step={5} onChange={set("dashPackPrice")} prefix="$" color="#10b981"/></div>
                </div>
              </div>
              {dashMath && <MathSummary lines={[{formula:dashMath.formula,subtotal:dashMath.total}]} total={dashMath.total} color="#10b981"/>}
            </SectionCard>

            {/* TEMPLATES */}
            <GroupDivider label="📋 Templates" color="#f59e0b"/>
            <SectionCard color="#f59e0b">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pricing Mode</p>
                  {[
                    {k:"useTemplateMonthly",   label:"Monthly fee", off:["useTemplatePacks"]},
                    {k:"useTemplatePacks",     label:"Packs",       off:["useTemplateMonthly"]},
                  ].map(({k,label,off})=>(
                    <ToggleOpt key={k} label={label} checked={hybrid[k]} onChange={v=>{setH(k)(v);if(v)off.forEach(o=>setH(o)(false));}} color="#f59e0b"/>
                  ))}
                </div>
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-x-6">
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Monthly Fee</p><Slider label="Per template / mo" value={settings.perTemplateMonthly} min={1} max={100} step={0.5} onChange={set("perTemplateMonthly")} prefix="$" color="#f59e0b"/></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Packs</p><Slider label="Templates per pack" value={settings.templatePackSize} min={1} max={20} step={1} onChange={set("templatePackSize")} suffix=" templates" color="#f59e0b"/><Slider label="Pack price" value={settings.templatePackPrice} min={10} max={300} step={5} onChange={set("templatePackPrice")} prefix="$" color="#f59e0b"/></div>
                </div>
              </div>
              {templateMath && <MathSummary lines={[{formula:templateMath.formula,subtotal:templateMath.total}]} total={templateMath.total} color="#f59e0b"/>}
            </SectionCard>

            {/* BUDGETS PRO */}
            <GroupDivider label="💰 Budgets Pro" color="#f43f5e"/>
            <SectionCard color="#f43f5e">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pricing Mode</p>
                  {[
                    {k:"useBudgetsProMonthly",   label:"Monthly fee", off:["useBudgetsProPacks"]},
                    {k:"useBudgetsProPacks",     label:"Packs",       off:["useBudgetsProMonthly"]},
                  ].map(({k,label,off})=>(
                    <ToggleOpt key={k} label={label} checked={hybrid[k]} onChange={v=>{setH(k)(v);if(v)off.forEach(o=>setH(o)(false));}} color="#f43f5e"/>
                  ))}
                </div>
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-x-6">
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Monthly Fee</p><Slider label="Per Budgets Pro / mo" value={settings.perBudgetsProMonthly} min={5} max={200} step={1} onChange={set("perBudgetsProMonthly")} prefix="$" color="#f43f5e"/></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Packs</p><Slider label="Uses per pack" value={settings.budgetsProPackSize} min={1} max={20} step={1} onChange={set("budgetsProPackSize")} suffix=" uses" color="#f43f5e"/><Slider label="Pack price" value={settings.budgetsProPackPrice} min={10} max={500} step={5} onChange={set("budgetsProPackPrice")} prefix="$" color="#f43f5e"/></div>
                </div>
              </div>
              {budgetsMath && <MathSummary lines={[{formula:budgetsMath.formula,subtotal:budgetsMath.total}]} total={budgetsMath.total} color="#f43f5e"/>}
            </SectionCard>

            {/* MARKETPLACE */}
            <GroupDivider label="🏪 Marketplace" color="#0096B7"/>
            <SectionCard color="#0096B7">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Enable</p>
                  <ToggleOpt label="Include marketplace revenue" checked={hybrid.useMarketplace} onChange={setH("useMarketplace")} hint={"Est. "+fmt(mktReachRevMo)+"/mo"} color="#0096B7"/>
                </div>
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-x-6">
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">📄 Reports</p>
                    <Slider label="% of reports listed" value={settings.mktReportSellPct} min={0} max={100} step={0.5} onChange={set("mktReportSellPct")} suffix="%" hint={"~"+Math.round(mktReportListings).toLocaleString()+" listings/mo"} color={R.primary}/>
                    <Slider label="% of customers buying" value={settings.mktReportBuyerPct} min={1} max={100} step={1} onChange={set("mktReportBuyerPct")} suffix="%" hint={Math.round(mktReportBuyers).toLocaleString()+" customers"} color={R.primary}/>
                    <Slider label="Sub price / buyer" value={settings.mktReportSubPrice} min={1} max={200} step={1} onChange={set("mktReportSubPrice")} prefix="$" suffix="/mo" color={R.primary}/>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">📊 Dashboards</p>
                    <Slider label="% of dashboards listed" value={settings.mktDashSellPct} min={0} max={100} step={0.5} onChange={set("mktDashSellPct")} suffix="%" hint={"~"+Math.round(mktDashListings).toLocaleString()+" listings/mo"} color={R.primary}/>
                    <Slider label="% of customers buying" value={settings.mktDashBuyerPct} min={1} max={100} step={1} onChange={set("mktDashBuyerPct")} suffix="%" hint={Math.round(mktDashBuyers).toLocaleString()+" customers"} color={R.primary}/>
                    <Slider label="Sub price / buyer" value={settings.mktDashSubPrice} min={1} max={500} step={1} onChange={set("mktDashSubPrice")} prefix="$" suffix="/mo" color={R.primary}/>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">💸 Commission</p>
                    <Slider label="Reach take rate" value={settings.marketplaceTake} min={5} max={40} step={1} onChange={set("marketplaceTake")} suffix="%" hint={"Reach earns "+settings.marketplaceTake+"%"} color="#0096B7"/>
                    <div className="rounded-lg p-3 mt-2" style={{background:R.primaryLight}}>
                      <p className="text-xs text-gray-500">Reach revenue / mo</p>
                      <p className="text-lg font-bold" style={{color:R.primaryText}}>{fmt(mktReachRevMo)}</p>
                      <p className="text-xs text-gray-400">{fmt(mktReachRevMo*12)} / yr</p>
                    </div>
                  </div>
                </div>
              </div>
              {mktMath && <MathSummary lines={[{formula:mktMath.formula,subtotal:mktMath.total}]} total={mktMath.total} color="#0096B7"/>}
            </SectionCard>
          </div>
        )}

        {/* FORECAST */}
        {tab==="forecast" && (
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 min-w-0 space-y-6">
              <Card>
                <h2 className="font-semibold text-gray-700 mb-4 text-sm">{forecastView==="arr"?"ARR":"MRR"} by Customer Count</h2>
                <ResponsiveContainer width="100%" height={340}>
                  <LineChart data={chartData} margin={{top:5,right:20,left:10,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="count" tickFormatter={v=>v>=1000?(v/1000).toFixed(1)+"k":v} tick={{fontSize:10}} interval="preserveStartEnd"/>
                    <YAxis tickFormatter={fmtK} tick={{fontSize:11}} width={70}/>
                    <Tooltip content={<ForecastTooltip/>}/>
                    <Legend formatter={v=>FORECAST_LABELS[v]||v} wrapperStyle={{fontSize:12}}/>
                    {Object.entries(forecastScenarios).filter(([,v])=>v).map(([k])=>(
                      <Line key={k} type="monotone" dataKey={k} name={k} stroke={FORECAST_COLORS[k]} strokeWidth={k==="hybrid"?3:2} strokeDasharray={k==="current"?"5 3":undefined} dot={false} activeDot={{r:5}}/>
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Card>
              <Card>
                <h2 className="font-extrabold text-gray-800 text-sm mb-4">Forecast Detail Table</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-gray-500 border-b text-left">
                      <th className="pb-2 pr-3">Customers</th>
                      {Object.entries(forecastScenarios).filter(([,v])=>v).map(([k])=>(
                        <th key={k} className="pb-2 pr-3 whitespace-nowrap" style={{color:FORECAST_COLORS[k]}}>{FORECAST_LABELS[k]}</th>
                      ))}
                      <th className="pb-2 pr-3 text-amber-600">Hybrid Lift</th>
                      <th className="pb-2 text-amber-600">Lift %</th>
                    </tr></thead>
                    <tbody>
                      {chartData.map((row,i)=>{
                        const lift=(row.hybrid||0)-(row.current||0), liftPct=row.current?((lift/row.current)*100).toFixed(1):null;
                        return (
                          <tr key={row.count} className="border-b last:border-0" style={i===0?{background:R.primaryLighter}:{}}>
                            <td className="py-1.5 pr-3 font-semibold text-gray-700 whitespace-nowrap text-xs">
                              {row.count.toLocaleString()}{i===0&&<span className="ml-1 text-xs px-1 py-0.5 rounded font-bold" style={{background:R.primaryLight,color:R.primaryText}}>now</span>}
                            </td>
                            {Object.entries(forecastScenarios).filter(([,v])=>v).map(([k])=>(
                              <td key={k} className="py-1.5 pr-3 font-mono text-xs" style={{color:FORECAST_COLORS[k]}}>{fmtK(row[k]||0)}</td>
                            ))}
                            <td className={"py-1.5 pr-3 font-bold text-xs "+(lift>=0?"text-green-600":"text-rose-600")}>{lift>=0?"+":""}{fmtK(lift)}</td>
                            <td className={"py-1.5 font-bold text-xs "+(Number(liftPct)>=0?"text-green-600":"text-rose-600")}>{liftPct?(Number(liftPct)>=0?"▲":"▼")+" "+Math.abs(liftPct)+"%":"—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            <div className="w-full lg:w-60 sticky top-4 self-start">
              <div className="rounded-xl p-4" style={{background:"#FFFBEB",border:"2px solid #FCD34D"}}>
                <p className="text-sm font-semibold text-amber-800 mb-1">🧩 Hybrid drives this forecast</p>
                <p className="text-xs text-amber-700 mb-3">Configure your model in the Configure tab — changes reflect here instantly.</p>
                <button onClick={()=>setTab("configure")} className="w-full py-2 text-white rounded-lg text-xs font-semibold" style={{background:"#f59e0b"}}>Go to Configure →</button>
              </div>
            </div>
          </div>
        )}

        {/* RECOMMENDATION */}
        {tab==="recommendation" && rev && <RecommendationTab data={data} totalMrr={totalMrr} settings={settings} setSettings={setSettings} setHybrid={setHybrid} setTab={setTab} />}

        {/* RECONCILIATION */}
        {tab==="reconciliation" && reconTotals && (
          <div className="space-y-5">
            <div className="rounded-xl p-4" style={{background:"#FFFBEB",border:"1px solid #FCD34D"}}>
              <p className="text-sm font-semibold text-amber-800 mb-1">🔍 Hybrid MRR reconciliation</p>
              <p className="text-xs text-amber-700">Hybrid MRR applies your full Configure tab configuration to each customer individually.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <MetricBox label="Actual MRR"      value={fmt(reconTotals.actMrr)}    color="reach"/>
              <MetricBox label="Hybrid MRR"      value={fmt(reconTotals.hybridMrr)} color="green"/>
              <MetricBox label="Hybrid > Actual" value={reconTotals.hybridOver+" customers"}  color="green"/>
              <MetricBox label="Hybrid < Actual" value={reconTotals.hybridUnder+" customers"} color="rose"/>
              <MetricBox label="Hybrid = Actual" value={reconTotals.hybridExact+" customers"} color="amber"/>
            </div>
            {/* Tier summary */}
            <Card>
              <h2 className="font-extrabold text-gray-800 text-sm mb-4">Hybrid vs Actual MRR by Connection Tier</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b text-left">
                      <th className="pb-2 pr-4">Tier</th>
                      <th className="pb-2 pr-4">Customers</th>
                      <th className="pb-2 pr-4">Actual MRR</th>
                      <th className="pb-2 pr-4">Hybrid MRR</th>
                      <th className="pb-2 pr-4">Diff</th>
                      <th className="pb-2 pr-4">Diff %</th>
                      <th className="pb-2 pr-4">Paying Less</th>
                      <th className="pb-2">Paying More</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TIERS.map(t => {
                      const g = reconRows.filter(r => r.tier.label === t.label);
                      if (!g.length) return null;
                      const actMrr  = g.reduce((a,r) => a + r.mrr, 0);
                      const hybMrr  = g.reduce((a,r) => a + r.hybridMrr, 0);
                      const diff    = hybMrr - actMrr;
                      const diffPct = actMrr > 0 ? (diff / actMrr * 100) : 0;
                      const under   = g.filter(r => r.hybridDiff < -0.01).length;
                      const over    = g.filter(r => r.hybridDiff >  0.01).length;
                      const isNeg   = diff < -0.01;
                      const isPos   = diff >  0.01;
                      return (
                        <tr key={t.label} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="py-2 pr-4 font-medium text-gray-700 whitespace-nowrap">{t.label}</td>
                          <td className="py-2 pr-4 text-gray-600">{g.length}</td>
                          <td className="py-2 pr-4 font-mono" style={{color:R.primaryText}}>{fmt(actMrr)}</td>
                          <td className="py-2 pr-4 font-mono font-semibold" style={{color:"#059669"}}>{fmt(hybMrr)}</td>
                          <td className="py-2 pr-4 font-mono font-bold" style={{color:isNeg?"#dc2626":isPos?"#16a34a":"#6b7280"}}>
                            {diff>=0?"+":""}{fmt(diff)}
                          </td>
                          <td className="py-2 pr-4">
                            <span className={"px-2 py-0.5 rounded text-xs font-bold " + (isNeg?"bg-rose-100 text-rose-700":isPos?"bg-green-100 text-green-700":"bg-gray-100 text-gray-500")}>
                              {diffPct>=0?"+":""}{diffPct.toFixed(1)}%
                            </span>
                          </td>
                          <td className="py-2 pr-4">
                            {under > 0
                              ? <span className="text-xs font-semibold text-rose-600">{under} customer{under!==1?"s":""}</span>
                              : <span className="text-xs text-gray-300">—</span>}
                          </td>
                          <td className="py-2">
                            {over > 0
                              ? <span className="text-xs font-semibold text-green-600">{over} customer{over!==1?"s":""}</span>
                              : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        </tr>
                      );
                    }).filter(Boolean)}
                    {/* Totals row */}
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td className="py-2 pr-4 font-bold text-gray-800">All Tiers</td>
                      <td className="py-2 pr-4 font-bold">{reconRows.length}</td>
                      <td className="py-2 pr-4 font-mono font-bold" style={{color:R.primaryText}}>{fmt(reconTotals.actMrr)}</td>
                      <td className="py-2 pr-4 font-mono font-bold" style={{color:"#059669"}}>{fmt(reconTotals.hybridMrr)}</td>
                      <td className="py-2 pr-4 font-mono font-bold" style={{color:(reconTotals.hybridMrr-reconTotals.actMrr)<0?"#dc2626":"#16a34a"}}>
                        {(reconTotals.hybridMrr-reconTotals.actMrr)>=0?"+":""}{fmt(reconTotals.hybridMrr-reconTotals.actMrr)}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={"px-2 py-0.5 rounded text-xs font-bold " + ((reconTotals.hybridMrr-reconTotals.actMrr)<0?"bg-rose-100 text-rose-700":"bg-green-100 text-green-700")}>
                          {((reconTotals.hybridMrr/reconTotals.actMrr-1)*100)>=0?"+":""}{((reconTotals.hybridMrr/reconTotals.actMrr-1)*100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs font-semibold text-rose-600">{reconTotals.hybridUnder} customers</td>
                      <td className="py-2 text-xs font-semibold text-green-600">{reconTotals.hybridOver} customers</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="flex flex-wrap gap-3 items-center">
              <div className="flex gap-1">
                {[
                  {key:"all",   label:"All ("+data.length+")"},
                  {key:"over",  label:"Hybrid > Actual ("+reconTotals.hybridOver+")"},
                  {key:"under", label:"Hybrid < Actual ("+reconTotals.hybridUnder+")"},
                  {key:"exact", label:"Match ("+reconTotals.hybridExact+")"},
                ].map(({key,label})=>(
                  <button key={key} onClick={()=>{setReconFilter(key);setReconPage(0);}} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition"
                    style={reconFilter===key?{background:R.primary,color:"#fff"}:{background:"#fff",border:"1px solid #e5e7eb",color:"#4b5563"}}>{label}</button>
                ))}
              </div>
              <input type="text" placeholder="Search by Customer ID…" value={reconSearch} onChange={e=>{setReconSearch(e.target.value);setReconPage(0);}} className="ml-auto border border-gray-200 rounded-lg px-3 py-1.5 text-xs outline-none w-52"/>
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-semibold text-gray-500 mr-1">Tier:</span>
              <button onClick={()=>{setReconTierFilter("all");setReconPage(0);}} className="px-2.5 py-1 rounded-lg text-xs font-semibold transition"
                style={reconTierFilter==="all"?{background:"#334155",color:"#fff"}:{background:"#fff",border:"1px solid #e5e7eb",color:"#4b5563"}}>All tiers</button>
              {TIERS.map(t=>{
                const count=reconRows.filter(r=>r.tier.label===t.label).length;
                if (!count) return null;
                const active=reconTierFilter===t.label;
                return (
                  <button key={t.label} onClick={()=>{setReconTierFilter(t.label);setReconPage(0);}} className="px-2.5 py-1 rounded-lg text-xs font-semibold transition whitespace-nowrap"
                    style={active?{background:"#334155",color:"#fff"}:{background:"#fff",border:"1px solid #e5e7eb",color:"#4b5563"}}>
                    {t.label} <span className="opacity-60">({count})</span>
                  </button>
                );
              })}
            </div>
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                {(() => {
                  // Build list of active breakdown columns based on current Configure settings
                  const bkCols = [];
                  if (hybrid.connMode !== "none") bkCols.push({key:"conn", label:"Conn"});
                  INTEGRATIONS.forEach(intg => { if ((hybrid.intgModes?.[intg]||"none") !== "none") bkCols.push({key:"intg_"+intg, label:intg}); });
                  if (hybrid.useReportMonthly||hybrid.useReportPayPerUse||hybrid.useReportPacks) bkCols.push({key:"rep", label:"Reports"});
                  if (hybrid.useDashMonthly||hybrid.useDashPayPerUse||hybrid.useDashPacks) bkCols.push({key:"dash", label:"Dashboards"});
                  if (hybrid.useTemplateMonthly||hybrid.useTemplatePacks) bkCols.push({key:"tmpl", label:"Templates"});
                  if (hybrid.useBudgetsProMonthly||hybrid.useBudgetsProPacks) bkCols.push({key:"bpro", label:"Budgets Pro"});
                  if (hybrid.useMarketplace) bkCols.push({key:"mkt", label:"Marketplace"});

                  const getBkVal = (r, key) => {
                    if (!r.breakdown) return 0;
                    if (key === "conn") return r.breakdown.conn;
                    if (key.startsWith("intg_")) return r.breakdown.intg[key.slice(5)] || 0;
                    return r.breakdown[key] || 0;
                  };

                  const fixedCols = [
                    {col:null,            label:"Customer ID"},
                    {col:"connections",   label:"Connections"},
                    {col:null,            label:"Billing"},
                    {col:"mrr",           label:"Actual MRR"},
                  ];

                  return (
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b">
                        <tr className="text-xs text-gray-500">
                          {fixedCols.map(({col,label})=>(
                            <th key={label} onClick={()=>col&&toggleReconSort(col)} className={"text-left px-4 py-3 font-semibold whitespace-nowrap "+(col?"cursor-pointer select-none":"")}>
                              {label}{col&&(reconSort.col===col?(reconSort.dir==="desc"?" ▼":" ▲"):" ↕")}
                            </th>
                          ))}
                          {bkCols.map(({key,label})=>(
                            <th key={key} className="text-left px-3 py-3 font-semibold whitespace-nowrap text-xs" style={{color:"#6366f1"}}>{label}</th>
                          ))}
                          <th onClick={()=>toggleReconSort("hybridMrr")} className="text-left px-4 py-3 font-semibold whitespace-nowrap cursor-pointer select-none" style={{color:"#059669"}}>
                            Hybrid MRR{reconSort.col==="hybridMrr"?(reconSort.dir==="desc"?" ▼":" ▲"):" ↕"}
                          </th>
                          <th onClick={()=>toggleReconSort("hybridDiff")} className="text-left px-4 py-3 font-semibold whitespace-nowrap cursor-pointer select-none">
                            Diff{reconSort.col==="hybridDiff"?(reconSort.dir==="desc"?" ▼":" ▲"):" ↕"}
                          </th>
                          <th onClick={()=>toggleReconSort("hybridDiffPct")} className="text-left px-4 py-3 font-semibold whitespace-nowrap cursor-pointer select-none">
                            Diff %{reconSort.col==="hybridDiffPct"?(reconSort.dir==="desc"?" ▼":" ▲"):" ↕"}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {reconPageRows.map((r,i)=>{
                          const hybridUp=r.hybridDiff>=0;
                          return (
                            <tr key={String(r.id)+"-"+i} className="border-b last:border-0 text-xs" style={{background:r.hybridDiff>0.01?"#f0fdf4":r.hybridDiff<-0.01?"#fff1f2":""}}>
                              <td className="px-4 py-2.5 font-mono text-gray-700">{r.id}</td>
                              <td className="px-4 py-2.5 font-semibold">{r.connections}</td>
                              <td className="px-4 py-2.5"><span className={"px-1.5 py-0.5 rounded text-xs font-medium "+(r.billing==="annual"?"bg-purple-100 text-purple-700":"bg-gray-100 text-gray-600")}>{r.billing}</span></td>
                              <td className="px-4 py-2.5 font-mono" style={{color:R.primaryText}}>{fmt(r.mrr)}</td>
                              {bkCols.map(({key})=>(
                                <td key={key} className="px-3 py-2.5 font-mono text-xs text-gray-600">{fmt(getBkVal(r,key))}</td>
                              ))}
                              <td className="px-4 py-2.5 font-mono font-bold" style={{color:"#059669"}}>{fmt(r.hybridMrr)}</td>
                              <td className="px-4 py-2.5 font-bold font-mono" style={{color:hybridUp?"#16a34a":"#dc2626"}}>{r.hybridDiff>=0?"+":""}{fmt(r.hybridDiff)}</td>
                              <td className="px-4 py-2.5">{r.hybridDiffPct!==null?<span className={"px-2 py-0.5 rounded font-semibold text-xs "+(Math.abs(r.hybridDiffPct)<1?"bg-gray-100 text-gray-500":hybridUp?"bg-green-100 text-green-700":"bg-rose-100 text-rose-700")}>{r.hybridDiffPct>=0?"+":""}{r.hybridDiffPct.toFixed(1)}%</span>:"—"}</td>
                            </tr>
                          );
                        })}
                        {reconPageRows.length===0&&<tr><td colSpan={4+bkCols.length+3} className="px-4 py-8 text-center text-gray-400 text-sm">No customers match this filter</td></tr>}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                        <tr className="text-xs font-bold text-gray-700">
                          <td className="px-4 py-2.5" colSpan={3}>{reconFilter!=="all"?"Filtered total ("+reconSorted.length+" customers)":"All "+data.length+" customers"}</td>
                          <td className="px-4 py-2.5 font-mono" style={{color:R.primaryText}}>{fmt(filteredActMrr)}</td>
                          {bkCols.map(({key})=>(
                            <td key={key} className="px-3 py-2.5 font-mono text-gray-500">{fmt(reconSorted.reduce((a,r)=>a+getBkVal(r,key),0))}</td>
                          ))}
                          <td className="px-4 py-2.5 font-mono font-bold text-green-700">{fmt(filteredHybridMrr)}</td>
                          <td className="px-4 py-2.5" colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  );
                })()}
              </div>
            </div>
            {reconTotalPages>1&&(
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Showing {reconPage*RECON_PAGE_SIZE+1}–{Math.min((reconPage+1)*RECON_PAGE_SIZE,reconSorted.length)} of {reconSorted.length}</span>
                <div className="flex gap-1">
                  <button onClick={()=>setReconPage(0)} disabled={reconPage===0} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100">«</button>
                  <button onClick={()=>setReconPage(p=>p-1)} disabled={reconPage===0} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100">‹</button>
                  {Array.from({length:Math.min(5,reconTotalPages)}).map((_,i)=>{const p=Math.min(Math.max(reconPage-2+i,0),reconTotalPages-1);return <button key={p} onClick={()=>setReconPage(p)} className="px-2.5 py-1 rounded border text-xs" style={p===reconPage?{background:R.primary,color:"#fff",borderColor:R.primary}:{}}>{p+1}</button>;})}
                  <button onClick={()=>setReconPage(p=>p+1)} disabled={reconPage>=reconTotalPages-1} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100">›</button>
                  <button onClick={()=>setReconPage(reconTotalPages-1)} disabled={reconPage>=reconTotalPages-1} className="px-2 py-1 rounded border disabled:opacity-30 hover:bg-gray-100">»</button>
                </div>
                <span>Page {reconPage+1} of {reconTotalPages}</span>
              </div>
            )}
          </div>
        )}

        {/* SCENARIOS */}
        {tab==="scenarios" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-gray-800 text-lg">💾 Saved Scenarios</h2>
                <p className="text-xs text-gray-500 mt-0.5">Configure a pricing model in the Configure tab, then save it here to compare options.</p>
              </div>
              <button onClick={()=>setShowSaveModal(true)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{background:R.primary}}>+ Save Current Config</button>
            </div>

            {savedScenarios.length===0 && (
              <Card className="text-center py-12">
                <p className="text-4xl mb-3">📋</p>
                <p className="font-semibold text-gray-600 mb-1">No scenarios saved yet</p>
                <p className="text-sm text-gray-400 mb-4">Go to the Configure tab, set up a pricing model, then click "💾 Save Scenario".</p>
                <button onClick={()=>setTab("configure")} className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{background:R.primary}}>Go to Configure →</button>
              </Card>
            )}

            {savedScenarios.map(sc => {
              // Compute hybrid MRR for this scenario
              const disc=1-sc.settings.annualDiscount/100;
              const totalRepMo=data.reduce((a,c)=>a+c.reportsPerMonth,0);
              const totalDashMo=data.reduce((a,c)=>a+c.dashPerMonth,0);
              const mktAdd=sc.hybrid.useMarketplace?mktMrrFor(sc.settings,totalRepMo,totalDashMo,data.length):0;
              const hybridMrr=data.reduce((a,c)=>a+calcHybridMrr(c,sc.hybrid,sc.settings),0)+mktAdd;
              const baseline=data.reduce((a,c)=>a+c.mrr,0);
              const diff=hybridMrr-baseline;
              const diffPct=(diff/baseline*100).toFixed(1);

              // Build a human-readable summary of what's active
              const h=sc.hybrid, s=sc.settings;
              const summary=[];
              if(h.connMode==="current")  summary.push("Connections: current MRR");
              if(h.connMode==="flat")     summary.push(`Connections: $${s.perConnectionPrice}/conn flat`);
              if(h.connMode==="tiered")   summary.push("Connections: tiered rates");
              INTEGRATIONS.forEach(intg=>{
                const mode=h.intgModes?.[intg]||"none";
                if(mode==="flat")   summary.push(`${intg}: $${s.intgFlatPrices[intg]}/unit flat`);
                if(mode==="tiered") summary.push(`${intg}: tiered`);
              });
              if(h.useReportMonthly)     summary.push(`Reports: $${s.perReportMonthly}/report/mo`);
              if(h.useReportPayPerUse)   summary.push(`Reports: $${s.perReportUse}/download`);
              if(h.useReportPacks)       summary.push(`Reports: packs of ${s.reportPackSize} @ $${s.reportPackPrice}`);
              if(h.useDashMonthly)       summary.push(`Dashboards: $${s.perDashboardMonthly}/dash/mo`);
              if(h.useDashPayPerUse)     summary.push(`Dashboards: $${s.perDashboardUse}/publish`);
              if(h.useDashPacks)         summary.push(`Dashboards: packs of ${s.dashPackSize} @ $${s.dashPackPrice}`);
              if(h.useTemplateMonthly)   summary.push(`Templates: $${s.perTemplateMonthly}/template/mo`);
              if(h.useTemplatePacks)     summary.push(`Templates: packs of ${s.templatePackSize} @ $${s.templatePackPrice}`);
              if(h.useBudgetsProMonthly)   summary.push(`Budgets Pro: $${s.perBudgetsProMonthly}/use/mo`);
              if(h.useBudgetsProPacks)     summary.push(`Budgets Pro: packs of ${s.budgetsProPackSize} @ $${s.budgetsProPackPrice}`);
              if(h.useMarketplace)         summary.push(`Marketplace: ${s.marketplaceTake}% take`);
              if(summary.length===0)       summary.push("No pricing active");

              return (
                <Card key={sc.id} style={{border:"1px solid #e5e7eb"}}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-bold text-gray-800 text-base">{sc.name}</h3>
                        <span className="text-xs text-gray-400">saved {sc.savedAt}</span>
                      </div>
                      {/* MRR summary */}
                      <div className="flex flex-wrap gap-4 mb-3">
                        <div className="rounded-lg px-3 py-2" style={{background:R.primaryLight}}>
                          <p className="text-xs font-medium opacity-70" style={{color:R.primaryText}}>Hybrid MRR</p>
                          <p className="text-xl font-bold" style={{color:R.primaryText}}>{fmt(hybridMrr)}</p>
                        </div>
                        <div className="rounded-lg px-3 py-2" style={{background:R.primaryLight}}>
                          <p className="text-xs font-medium opacity-70" style={{color:R.primaryText}}>Hybrid ARR</p>
                          <p className="text-xl font-bold" style={{color:R.primaryText}}>{fmt(hybridMrr*12)}</p>
                        </div>
                        <div className="rounded-lg px-3 py-2" style={{background:diff>=0?"#f0fdf4":"#fff1f2"}}>
                          <p className="text-xs font-medium opacity-70" style={{color:diff>=0?"#166534":"#9f1239"}}>vs Current MRR</p>
                          <p className="text-xl font-bold" style={{color:diff>=0?"#16a34a":"#dc2626"}}>{diff>=0?"+":""}{fmt(diff)}</p>
                        </div>
                        <div className="rounded-lg px-3 py-2" style={{background:diff>=0?"#f0fdf4":"#fff1f2"}}>
                          <p className="text-xs font-medium opacity-70" style={{color:diff>=0?"#166534":"#9f1239"}}>Change %</p>
                          <p className="text-xl font-bold" style={{color:diff>=0?"#16a34a":"#dc2626"}}>{diff>=0?"+":""}{diffPct}%</p>
                        </div>
                      </div>
                      {/* Config summary pills */}
                      <div className="flex flex-wrap gap-1.5">
                        {summary.map((s,i)=>(
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{background:"#f1f5f9",color:"#475569"}}>{s}</span>
                        ))}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button onClick={()=>loadScenario(sc)} className="px-4 py-2 rounded-lg text-xs font-semibold text-white whitespace-nowrap" style={{background:R.primary}}>
                        Load into Configure →
                      </button>
                      <button onClick={()=>deleteScenario(sc.id)} className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-50 text-rose-600 hover:bg-rose-100 whitespace-nowrap">
                        Delete
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* INDUSTRY */}
        {tab==="industry" && <IndustryTab />}

        {/* SAVE MODAL */}
        {showSaveModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{background:"rgba(0,0,0,0.4)"}}>
            <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4">
              <h3 className="font-bold text-gray-800 text-base mb-1">Save Scenario</h3>
              <p className="text-xs text-gray-500 mb-4">Give this pricing configuration a name so you can compare it later.</p>
              <input
                type="text"
                placeholder="e.g. Integrations Only, Flat Connections..."
                value={saveNameDraft}
                onChange={e=>setSaveNameDraft(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter")saveScenario(saveNameDraft);if(e.key==="Escape")setShowSaveModal(false);}}
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm outline-none mb-4 focus:border-blue-400"
              />
              <div className="flex gap-2">
                <button onClick={()=>saveScenario(saveNameDraft)} disabled={!saveNameDraft.trim()} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-40" style={{background:R.primary}}>Save</button>
                <button onClick={()=>{setShowSaveModal(false);setSaveNameDraft("");}} className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
