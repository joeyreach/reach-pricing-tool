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
const DEFAULT_INTG_TIER_PRICES = { 1: 149, 10: 29, 25: 22, 50: 19, 100: 17, 200: 15.30, 300: 14 };

const DEFAULT_SETTINGS = {
  annualDiscount: 30,
  perConnectionPrice: 10,
  connTierPrices: { 1: 149, 10: 29, 25: 22, 50: 19, 100: 17, 200: 15.30, 300: 14 },
  intgFlatPrices: Object.fromEntries(INTEGRATIONS.map(k => [k, 10])),
  intgTierPrices: Object.fromEntries(INTEGRATIONS.map(k => [k, {...DEFAULT_INTG_TIER_PRICES}])),
  perReportMonthly: 5, perReportUse: 0.50, reportPackSize: 10, reportPackPrice: 40,
  perDashboardMonthly: 8, perDashboardUse: 0.75, dashPackSize: 10, dashPackPrice: 60,
  perTemplateMonthly: 10, perTemplateUse: 1.00, templatePackSize: 5, templatePackPrice: 40,
  perBudgetsProMonthly: 20, perBudgetsProUse: 2.00, budgetsProPackSize: 5, budgetsProPackPrice: 75,
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
  useTemplateMonthly: false, useTemplatePayPerUse: false, useTemplatePacks: false,
  useBudgetsProMonthly: false, useBudgetsProPayPerUse: false, useBudgetsProPacks: false,
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
  // tiered: same bracket logic as connections
  if (n === 1) return tierPrices[1]; if (n <= 10) return 290;
  if (n <= 24) return n*tierPrices[10]; if (n <= 49) return n*tierPrices[25];
  if (n <= 99) return n*tierPrices[50]; if (n <= 199) return n*tierPrices[100];
  if (n <= 299) return n*tierPrices[200]; return n*tierPrices[300];
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
  else if (h.useTemplatePayPerUse) b += c.templatesPerMonth*s.perTemplateUse;
  else if (h.useTemplatePacks)     b += c.templatesPerMonth>0 ? Math.ceil(c.templatesPerMonth/s.templatePackSize)*s.templatePackPrice : 0;
  if      (h.useBudgetsProMonthly)   b += c.budgetsProPerMonth*s.perBudgetsProMonthly;
  else if (h.useBudgetsProPayPerUse) b += c.budgetsProPerMonth*s.perBudgetsProUse;
  else if (h.useBudgetsProPacks)     b += c.budgetsProPerMonth>0 ? Math.ceil(c.budgetsProPerMonth/s.budgetsProPackSize)*s.budgetsProPackPrice : 0;
  return b;
};

function scaleCustomers(base, targetCount) {
  if (!base||!base.length) return [];
  const ratio = targetCount/base.length, result = [];
  base.forEach(c => { const w=Math.floor(ratio); for(let i=0;i<w;i++) result.push(c); if(Math.random()<(ratio-w)) result.push(c); });
  while(result.length>targetCount) result.pop();
  while(result.length<targetCount) result.push(base[Math.floor(Math.random()*base.length)]);
  return result;
}

const Card = ({ children, className="", style }) => (
  <div className={"bg-white rounded-xl shadow p-4 "+className} style={style}>{children}</div>
);
const SectionCard = ({ children, color, className="" }) => (
  <div className={"rounded-xl shadow p-4 "+className} style={{background:"#fff",borderLeft:`4px solid ${color}`}}>{children}</div>
);
const Slider = ({ label, value, min, max, step, onChange, prefix="", suffix="", hint, color }) => (
  <div className="mb-3">
    <div className="flex justify-between text-xs mb-1">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold" style={{color:color||R.primary}}>{prefix}{value}{suffix}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))} className="w-full" style={{accentColor:color||R.primary}} />
    {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
  </div>
);
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
  <button onClick={onClick} className="px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors"
    style={active?{borderBottomColor:R.primary,color:R.primaryText,background:"#fff"}:{borderBottomColor:"transparent",color:"#6b7280"}}>
    {children}
  </button>
);
const MetricBox = ({ label, value, sub, color }) => {
  const styles = {
    reach: {background:R.primaryLight,border:"1px solid #99e2f0",color:R.primaryText},
    green: {background:"#f0fdf4",border:"1px solid #86efac",color:"#166534"},
    amber: {background:"#fffbeb",border:"1px solid #fcd34d",color:"#92400e"},
    rose:  {background:"#fff1f2",border:"1px solid #fda4af",color:"#9f1239"},
  };
  return (
    <div className="rounded-lg p-3" style={styles[color]||styles.reach}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
      {sub && <p className="text-xs opacity-60 mt-0.5">{sub}</p>}
    </div>
  );
};
const GroupDivider = ({ label, color }) => (
  <div className="flex items-center gap-3 my-4">
    <span className="text-xs font-bold px-3 py-1 rounded-full text-white" style={{background:color}}>{label}</span>
    <div className="flex-1 border-t" style={{borderColor:color+"55"}} />
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
  const [reconSearch, setReconSearch] = useState("");
  const [reconPage, setReconPage] = useState(0);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [hybrid, setHybrid] = useState(DEFAULT_HYBRID);

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
    const hybridRows = customers.map(c=>{const b=calcHybridOne({...c,...uFn(c)},h,s,n);return{mrr:toMrr(b,c.billing),cash:toMrr(b,c.billing)*12};});
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
      if (forecastScenarios.hybrid)  row.hybrid=(scaled.reduce((s,c)=>s+toMrr(calcHybridOne(c,hybrid,settings,scaled.length),c.billing),0)+mktAdd)*mult;
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
        {label:"1 conn",      filter:c=>u(c).connections===1,                                    rate:`${settings.connTierPrices[1]} flat`},
        {label:"2–10 conns",  filter:c=>u(c).connections>=2&&u(c).connections<=10,               rate:"$290 flat"},
        {label:"11–24 conns", filter:c=>u(c).connections>=11&&u(c).connections<=24,              rate:`${settings.connTierPrices[25]}/conn`},
        {label:"25–49 conns", filter:c=>u(c).connections>=25&&u(c).connections<=49,              rate:`${settings.connTierPrices[50]}/conn`},
        {label:"50–99 conns", filter:c=>u(c).connections>=50&&u(c).connections<=99,              rate:`${settings.connTierPrices[100]}/conn`},
        {label:"100–199 conns",filter:c=>u(c).connections>=100&&u(c).connections<=199,           rate:`${settings.connTierPrices[200]}/conn`},
        {label:"200–299 conns",filter:c=>u(c).connections>=200&&u(c).connections<=299,           rate:`${settings.connTierPrices[300]}/conn`},
        {label:"300+ conns",  filter:c=>u(c).connections>=300,                                   rate:`${settings.connTierPrices[300]}/conn`},
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
      const tierGroups=[
        {label:"1 unit",      filter:c=>(c.integrations?.[intg]||0)===1,                                      rate:mode==="flat"?`${tp[1]} flat`:`${tp[1]} flat`},
        {label:"2–10 units",  filter:c=>{const n=c.integrations?.[intg]||0;return n>=2&&n<=10;},              rate:"$290 flat"},
        {label:"11–24 units", filter:c=>{const n=c.integrations?.[intg]||0;return n>=11&&n<=24;},             rate:mode==="flat"?`${fp}/unit`:`${tp[25]}/unit`},
        {label:"25–49 units", filter:c=>{const n=c.integrations?.[intg]||0;return n>=25&&n<=49;},             rate:mode==="flat"?`${fp}/unit`:`${tp[50]}/unit`},
        {label:"50–99 units", filter:c=>{const n=c.integrations?.[intg]||0;return n>=50&&n<=99;},             rate:mode==="flat"?`${fp}/unit`:`${tp[100]}/unit`},
        {label:"100–199 units",filter:c=>{const n=c.integrations?.[intg]||0;return n>=100&&n<=199;},          rate:mode==="flat"?`${fp}/unit`:`${tp[200]}/unit`},
        {label:"200+ units",  filter:c=>(c.integrations?.[intg]||0)>=200,                                     rate:mode==="flat"?`${fp}/unit`:`${tp[300]}/unit`},
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
    if (hybrid.useTemplatePayPerUse) {
      const total=applyDisc(data,c=>u(c).templatesPerMonth*settings.perTemplateUse);
      return {formula:`${data.length.toLocaleString()} customers × avg ${fmtD(totalTemplatesPerMo/data.length)} templates/mo × $${settings.perTemplateUse}/use`, total};
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
    if (hybrid.useBudgetsProPayPerUse) {
      const total=applyDisc(data,c=>u(c).budgetsProPerMonth*settings.perBudgetsProUse);
      return {formula:`${data.length.toLocaleString()} customers × avg ${fmtD(totalBudgetsProPerMo/data.length)} uses/mo × $${settings.perBudgetsProUse}/use`, total};
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
    const disc=1-settings.annualDiscount/100, n=data.length;
    const totalRepMo  = data.reduce((a,c)=>a+c.reportsPerMonth,0);
    const totalDashMo = data.reduce((a,c)=>a+c.dashPerMonth,0);
    const mktTotal = hybrid.useMarketplace ? mktMrrFor(settings, totalRepMo, totalDashMo, n) : 0;
    const mktPerCust = n > 0 ? mktTotal / n : 0;
    return data.map(r=>{
      const uc=u(r);
      const hybridBase=calcHybridOne({...r,...uc},hybrid,settings,n);
      const hybridMrr=(r.billing==="annual"?hybridBase*disc:hybridBase)+mktPerCust;
      const hybridDiff=hybridMrr-r.mrr;
      const hybridDiffPct=r.mrr!==0?(hybridDiff/r.mrr*100):null;
      return {...r, hybridMrr, hybridDiff, hybridDiffPct};
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
    rows.sort((a,b)=>{
      const av=a[reconSort.col]!=null?a[reconSort.col]:-Infinity, bv=b[reconSort.col]!=null?b[reconSort.col]:-Infinity;
      return reconSort.dir==="asc"?av-bv:bv-av;
    });
    return rows;
  },[reconRows,reconSort,reconFilter,reconSearch]);

  const reconPageRows=reconSorted.slice(reconPage*RECON_PAGE_SIZE,(reconPage+1)*RECON_PAGE_SIZE);
  const reconTotalPages=Math.ceil(reconSorted.length/RECON_PAGE_SIZE);
  const toggleReconSort=c=>setReconSort(s=>({col:c,dir:s.col===c&&s.dir==="desc"?"asc":"desc"}));
  const filteredActMrr=reconSorted.reduce((s,r)=>s+r.mrr,0);
  const filteredHybridMrr=reconSorted.reduce((s,r)=>s+r.hybridMrr,0);

  if (!authed) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{background:"linear-gradient(135deg,#023E8A 0%,#00B4D8 100%)"}}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{background:R.primaryLight}}><span className="text-2xl">🔒</span></div>
          <h1 className="text-xl font-bold text-gray-800">Reach Pricing Tool</h1>
          <p className="text-sm text-gray-500 mt-1">Internal use only</p>
        </div>
        <input type="password" placeholder="Enter password" value={pw} onChange={e=>{setPw(e.target.value);setPwErr(false);}} onKeyDown={e=>{if(e.key==="Enter"){if(pw===PASSWORD)setAuthed(true);else setPwErr(true);}}} className={"w-full border rounded-lg px-4 py-2.5 text-sm mb-3 outline-none "+(pwErr?"border-rose-400":"border-gray-300")} />
        {pwErr&&<p className="text-xs text-rose-500 mb-2">Incorrect password</p>}
        <button onClick={()=>{if(pw===PASSWORD)setAuthed(true);else setPwErr(true);}} className="w-full text-white rounded-lg py-2.5 text-sm font-semibold" style={{background:R.primary}}>Access Tool</button>
      </div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{background:"linear-gradient(135deg,#023E8A 0%,#00B4D8 100%)"}}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3" style={{background:R.primaryLight}}><span className="text-2xl">📊</span></div>
          <h1 className="text-xl font-bold text-gray-800">Reach Pricing Scenario Modeler</h1>
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
    <div className="min-h-screen" style={{background:"#f8fafc"}}>
      <div className="text-white px-6 py-4 flex items-center justify-between" style={{background:"linear-gradient(90deg,#023E8A 0%,#0096B7 100%)"}}>
        <div>
          <h1 className="text-lg font-bold tracking-tight">Reach Pricing Scenario Modeler</h1>
          <p className="text-xs mt-0.5" style={{color:"#90E0EF"}}>{data.length.toLocaleString()} customers · Feb 2026</p>
        </div>
        <div className="flex gap-2">
          {tab==="forecast"&&<>
            <button onClick={()=>setForecastView("mrr")} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition" style={forecastView==="mrr"?{background:"#fff",color:R.primaryText}:{background:"rgba(255,255,255,0.15)",color:"#fff"}}>MRR</button>
            <button onClick={()=>setForecastView("arr")} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition" style={forecastView==="arr"?{background:"#fff",color:R.primaryText}:{background:"rgba(255,255,255,0.15)",color:"#fff"}}>ARR</button>
          </>}
          <button onClick={()=>setSnapMode(m=>!m)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition" style={snapMode?{background:"#fff",color:R.primaryText}:{background:"rgba(255,255,255,0.15)",color:"#fff"}}>{snapMode?"📸 Feb Snapshot":"📊 Lifetime Avg"}</button>
          <button onClick={()=>setData(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold transition" style={{background:"rgba(255,255,255,0.15)",color:"#fff"}}>↑ New File</button>
        </div>
      </div>

      <div className="border-b px-6 flex gap-1 pt-2 overflow-x-auto" style={{background:"#f1f5f9",borderColor:"#e2e8f0"}}>
        {[["overview","📈 Overview"],["configure","⚙️ Configure"],["forecast","🔮 Forecast"],["segments","👥 Segments"],["recommendation","💡 Recommendation"],["reconciliation","🔍 Reconciliation"]].map(([k,l])=>(
          <Tab key={k} active={tab===k} onClick={()=>setTab(k)}>{l}</Tab>
        ))}
      </div>

      <div className="p-6 max-w-7xl mx-auto">

        {/* OVERVIEW */}
        {tab==="overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricBox label="Current MRR" value={fmt(totalMrr)} color="reach"/>
              <MetricBox label="Current ARR" value={fmt(totalMrr*12)} color="reach"/>
              <MetricBox label="Annual Customers" value={annualCount+" ("+(annualCount/data.length*100).toFixed(1)+"%)"} sub={(data.length-annualCount)+" monthly"} color="amber"/>
              <MetricBox label="Total Customers" value={data.length.toLocaleString()} color="green"/>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <MetricBox label="Avg Connections" value={fmtD(avgConn)} color="reach"/>
              <MetricBox label="Avg Reports Created/mo" value={fmtD(avgRep)} color="reach"/>
              <MetricBox label="Avg Report Downloads/mo" value={fmtD(avgDownloads)} color="reach"/>
              <MetricBox label="Avg Dashboards/mo" value={fmtD(avgDash)} color="reach"/>
              <MetricBox label="Avg Templates/mo" value={fmtD(avgTemplate)} color="reach"/>
              <MetricBox label="Avg Budgets Pro/mo" value={fmtD(avgBudgets)} color="reach"/>
            </div>
            <Card>
              <h2 className="font-semibold text-gray-700 mb-3">Customers by Connection Tier</h2>
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
          </div>
        )}

        {/* CONFIGURE */}
        {tab==="configure" && rev && (
          <div className="space-y-4">
            <div className="sticky top-0 z-20 rounded-xl shadow-md p-4" style={{background:"#FFFBEB",border:"2px solid #FCD34D"}}>
              <div className="flex flex-wrap items-center gap-6">
                <div><p className="text-xs font-semibold text-amber-700">🧩 Hybrid MRR</p><p className="text-2xl font-bold text-gray-800">{fmt(rev.hybrid.mrr)}</p></div>
                <div><p className="text-xs text-gray-500">ARR</p><p className="text-xl font-bold text-gray-800">{fmt(rev.hybrid.mrr*12)}</p></div>
                <div><p className="text-xs text-gray-500">12-mo Cash Flow</p><p className="text-xl font-bold text-gray-800">{fmt(rev.hybrid.cash)}</p></div>
                <div><p className="text-xs text-gray-500">vs Current MRR</p><p className={"text-xl font-bold "+(rev.hybrid.mrr>=rev.baseline.mrr?"text-green-600":"text-rose-600")}>{fmt(rev.hybrid.mrr-rev.baseline.mrr)}</p></div>
                <div><p className="text-xs text-gray-500">vs Current ARR</p><p className={"text-xl font-bold "+(rev.hybrid.mrr>=rev.baseline.mrr?"text-green-600":"text-rose-600")}>{fmt((rev.hybrid.mrr-rev.baseline.mrr)*12)}</p></div>
                <div className="ml-auto flex items-center gap-3">
                  {pctDelta(rev.hybrid.mrr,rev.baseline.mrr)}
                  <button onClick={()=>{setSettings(DEFAULT_SETTINGS);setHybrid(DEFAULT_HYBRID);}} className="px-3 py-1.5 bg-rose-50 text-rose-600 rounded-lg text-xs font-semibold hover:bg-rose-100">Reset All</button>
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
                <p className="text-xs font-bold mb-3" style={{color:INTG_COLOR}}>{intg}</p>
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
                      {CONN_TIER_DEFS.map(({label,key,sliderMax})=>(
                        <Slider key={key} label={label} value={settings.intgTierPrices[intg][key]} min={1} max={sliderMax} step={0.5} onChange={v=>setIntgTier(intg,key,v)} prefix="$" suffix="/mo" color={INTG_COLOR}/>
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
                    {k:"useTemplateMonthly",   label:"Monthly fee", off:["useTemplatePayPerUse","useTemplatePacks"]},
                    {k:"useTemplatePayPerUse", label:"Pay-per-use", off:["useTemplateMonthly","useTemplatePacks"]},
                    {k:"useTemplatePacks",     label:"Packs",       off:["useTemplateMonthly","useTemplatePayPerUse"]},
                  ].map(({k,label,off})=>(
                    <ToggleOpt key={k} label={label} checked={hybrid[k]} onChange={v=>{setH(k)(v);if(v)off.forEach(o=>setH(o)(false));}} color="#f59e0b"/>
                  ))}
                </div>
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-x-6">
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Monthly Fee</p><Slider label="Per template / mo" value={settings.perTemplateMonthly} min={1} max={100} step={0.5} onChange={set("perTemplateMonthly")} prefix="$" color="#f59e0b"/></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pay-Per-Use</p><Slider label="Per use" value={settings.perTemplateUse} min={0.10} max={10} step={0.1} onChange={set("perTemplateUse")} prefix="$" color="#f59e0b"/></div>
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
                    {k:"useBudgetsProMonthly",   label:"Monthly fee", off:["useBudgetsProPayPerUse","useBudgetsProPacks"]},
                    {k:"useBudgetsProPayPerUse", label:"Pay-per-use", off:["useBudgetsProMonthly","useBudgetsProPacks"]},
                    {k:"useBudgetsProPacks",     label:"Packs",       off:["useBudgetsProMonthly","useBudgetsProPayPerUse"]},
                  ].map(({k,label,off})=>(
                    <ToggleOpt key={k} label={label} checked={hybrid[k]} onChange={v=>{setH(k)(v);if(v)off.forEach(o=>setH(o)(false));}} color="#f43f5e"/>
                  ))}
                </div>
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-x-6">
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Monthly Fee</p><Slider label="Per Budgets Pro / mo" value={settings.perBudgetsProMonthly} min={5} max={200} step={1} onChange={set("perBudgetsProMonthly")} prefix="$" color="#f43f5e"/></div>
                  <div><p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Pay-Per-Use</p><Slider label="Per use" value={settings.perBudgetsProUse} min={0.50} max={20} step={0.5} onChange={set("perBudgetsProUse")} prefix="$" color="#f43f5e"/></div>
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
                <h2 className="font-semibold text-gray-700 mb-3 text-sm">Forecast Detail Table</h2>
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

        {/* SEGMENTS */}
        {tab==="segments" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <h2 className="font-semibold text-gray-700 mb-3">Customers by Tenure</h2>
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-gray-500 border-b text-left"><th className="pb-2">Tenure</th><th className="pb-2">Customers</th><th className="pb-2">Avg MRR</th></tr></thead>
                <tbody>{[["0–6 mo",0,6],["7–12 mo",7,12],["13–24 mo",13,24],["25+ mo",25,9999]].map(([label,lo,hi])=>{
                  const g=data.filter(c=>c.months>=lo&&c.months<=hi);
                  return <tr key={label} className="border-b last:border-0"><td className="py-1.5">{label}</td><td className="py-1.5">{g.length}</td><td className="py-1.5">{fmt(g.reduce((a,c)=>a+c.mrr,0)/Math.max(g.length,1))}</td></tr>;
                })}</tbody>
              </table>
            </Card>
            <Card>
              <h2 className="font-semibold text-gray-700 mb-3">Monthly vs Annual Billing</h2>
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
                <h2 className="font-semibold text-gray-700 mb-3">{label}</h2>
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-gray-500 border-b text-left"><th className="pb-2">Range</th><th className="pb-2">Customers</th><th className="pb-2">%</th></tr></thead>
                  <tbody>{[[0,0.009,"0"],[0.01,0.999,"<1"],[1,4.999,"1–5"],[5,19.999,"5–20"],[20,99999,"20+"]].map(([lo,hi,lbl])=>{
                    const g=data.filter(c=>c[field]>=lo&&c[field]<=hi);
                    return <tr key={lbl} className="border-b last:border-0"><td className="py-1.5">{lbl}</td><td className="py-1.5">{g.length}</td><td className="py-1.5">{(g.length/data.length*100).toFixed(1)}%</td></tr>;
                  })}</tbody>
                </table>
              </Card>
            ))}
          </div>
        )}

        {/* RECOMMENDATION */}
        {tab==="recommendation" && rev && (() => {
          const totalConn=data.reduce((a,c)=>a+c.connections,0),totalRepMo=data.reduce((a,c)=>a+c.reportsPerMonth,0);
          const totalDashMo=data.reduce((a,c)=>a+c.dashPerMonth,0),totalTmplMo=data.reduce((a,c)=>a+c.templatesPerMonth,0);
          const totalBProMo=data.reduce((a,c)=>a+c.budgetsProPerMonth,0),target=totalMrr;
          const shares={conn:0.45,rep:0.20,dash:0.12,tmpl:0.12,bpro:0.06};
          const connRevTarget=target*shares.conn,repRevTarget=target*shares.rep,dashRevTarget=target*shares.dash,tmplRevTarget=target*shares.tmpl,bproRevTarget=target*shares.bpro;
          const impliedConnFlat=totalConn>0?connRevTarget/totalConn:0;
          const impliedRepMo=totalRepMo>0?repRevTarget/totalRepMo:0,impliedDashMo=totalDashMo>0?dashRevTarget/totalDashMo:0;
          const impliedTmplMo=totalTmplMo>0?tmplRevTarget/totalTmplMo:0,impliedBProMo=totalBProMo>0?bproRevTarget/totalBProMo:0;
          const avgRepPerCust=totalRepMo/data.length,avgDashPerCust=totalDashMo/data.length,avgTmplPerCust=totalTmplMo/data.length,avgBProPerCust=totalBProMo/data.length;
          const tierMults={1:1.4,10:1.2,25:1.0,50:0.85,100:0.70,200:0.58,300:0.48};
          const wtAvgMult=data.reduce((a,c)=>{const k=c.connections<=1?1:c.connections<=10?10:c.connections<=24?25:c.connections<=49?50:c.connections<=99?100:c.connections<=199?200:300;return a+tierMults[k];},0)/data.length;
          const impliedBaseConn=wtAvgMult>0?impliedConnFlat/wtAvgMult:impliedConnFlat;
          const tieredPrices=Object.fromEntries(Object.entries(tierMults).map(([k,m])=>[k,impliedBaseConn*m]));
          const disc=1-settings.annualDiscount/100;
          const calcMrrFor=fn=>data.reduce((sum,c)=>{const b=fn(c);return sum+(c.billing==="annual"?b*disc:b);},0);
          const mrrFlatConn=calcMrrFor(c=>calcConnPriceWithRates(c.connections,{1:149,10:impliedConnFlat,25:impliedConnFlat,50:impliedConnFlat,100:impliedConnFlat,200:impliedConnFlat,300:impliedConnFlat})+c.reportsPerMonth*impliedRepMo+c.dashPerMonth*impliedDashMo+c.templatesPerMonth*impliedTmplMo+c.budgetsProPerMonth*impliedBProMo);
          const mrrTieredConn=calcMrrFor(c=>calcConnPriceWithRates(c.connections,tieredPrices)+c.reportsPerMonth*impliedRepMo+c.dashPerMonth*impliedDashMo+c.templatesPerMonth*impliedTmplMo+c.budgetsProPerMonth*impliedBProMo);
          const Row=({label,value,note})=>(<tr className="border-b last:border-0"><td className="py-2 text-sm font-medium text-gray-700">{label}</td><td className="py-2 text-sm font-bold" style={{color:R.primaryText}}>{value}</td><td className="py-2 text-xs text-gray-400">{note}</td></tr>);
          const AccuracyBadge=({mrr})=>{const diff=Math.abs(mrr-target)/target*100;return <span className={"text-xs font-bold px-2 py-0.5 rounded "+(diff<2?"bg-green-100 text-green-700":diff<5?"bg-amber-100 text-amber-700":"bg-rose-100 text-rose-700")}>{diff<0.1?"Exact match":diff.toFixed(1)+"% off target"}</span>;};
          return (
            <div className="space-y-6">
              <Card style={{border:`2px solid ${R.primary}`}}>
                <h2 className="font-semibold text-gray-800 mb-1">💡 Revenue-Neutral A La Carte Recommendation</h2>
                <p className="text-xs text-gray-500 mb-3">Based on {data.length.toLocaleString()} customers and current MRR of <strong>{fmt(target)}</strong>. Split: <strong>45% connections · 20% reports · 12% dashboards · 12% templates · 6% Budgets Pro · 5% marketplace</strong>.</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  <MetricBox label="Target MRR" value={fmt(target)} color="reach"/>
                  <MetricBox label="Total Connections" value={totalConn.toLocaleString()} color="reach"/>
                  <MetricBox label="Avg Reports/mo" value={fmtD(avgRepPerCust)} color="reach"/>
                  <MetricBox label="Avg Templates/mo" value={fmtD(avgTmplPerCust)} color="reach"/>
                  <MetricBox label="Avg Budgets Pro/mo" value={fmtD(avgBProPerCust)} color="reach"/>
                </div>
              </Card>
              {[
                {title:"Option 1 — Flat Per-Connection + Monthly Fees",desc:"Simplest structure.",mrr:mrrFlatConn,rows:[{label:"Per connection / mo",value:"$"+impliedConnFlat.toFixed(2),note:"× "+totalConn.toLocaleString()+" connections"},{label:"Per report / mo",value:"$"+impliedRepMo.toFixed(2),note:"× "+fmtD(avgRepPerCust)+" avg/mo"},{label:"Per dashboard / mo",value:"$"+impliedDashMo.toFixed(2),note:"× "+fmtD(avgDashPerCust)+" avg/mo"},{label:"Per template / mo",value:"$"+impliedTmplMo.toFixed(2),note:"× "+fmtD(avgTmplPerCust)+" avg/mo"},{label:"Budgets Pro / mo",value:"$"+impliedBProMo.toFixed(2),note:"× "+fmtD(avgBProPerCust)+" avg/mo"}]},
                {title:"Option 2 — Tiered Per-Connection + Monthly Fees",desc:"Volume discount on connections.",mrr:mrrTieredConn,rows:[...CONN_TIER_DEFS.map(({label,key})=>({label:label+" / conn / mo",value:"$"+tieredPrices[key].toFixed(2),note:""})),{label:"Per report / mo",value:"$"+impliedRepMo.toFixed(2),note:"× "+fmtD(avgRepPerCust)+" avg/mo"},{label:"Per dashboard / mo",value:"$"+impliedDashMo.toFixed(2),note:"× "+fmtD(avgDashPerCust)+" avg/mo"},{label:"Per template / mo",value:"$"+impliedTmplMo.toFixed(2),note:"× "+fmtD(avgTmplPerCust)+" avg/mo"},{label:"Budgets Pro / mo",value:"$"+impliedBProMo.toFixed(2),note:"× "+fmtD(avgBProPerCust)+" avg/mo"}]},
              ].map(({title,desc,mrr,rows})=>(
                <Card key={title}>
                  <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-gray-700">{title}</h3><AccuracyBadge mrr={mrr}/></div>
                  <p className="text-xs text-gray-400 mb-3">{desc}</p>
                  <table className="w-full"><thead><tr className="text-xs text-gray-400 border-b text-left"><th className="pb-1">Component</th><th className="pb-1">Suggested Price</th><th className="pb-1">Basis</th></tr></thead><tbody>{rows.map(r=><Row key={r.label} {...r}/>)}</tbody></table>
                  <div className="mt-3 pt-3 border-t flex justify-between text-sm"><span className="text-gray-500">Projected MRR</span><span className="font-bold text-gray-800">{fmt(mrr)} <span className="text-xs text-gray-400">({((mrr/target-1)*100).toFixed(1)}% vs target)</span></span></div>
                </Card>
              ))}
              <Card style={{background:R.primaryLighter,border:`1px solid ${R.primaryLight}`}}>
                <h3 className="font-semibold mb-2" style={{color:R.primaryText}}>📌 Summary Recommendation</h3>
                <p className="text-sm leading-relaxed" style={{color:R.primaryText}}>For <strong>2+ connection customers</strong>, <strong>Option 2 (Tiered Per-Connection + Monthly Fees)</strong> is the strongest starting point. Price <strong>templates higher than reports</strong> and <strong>Budgets Pro as a premium add-on</strong>. Layer in the <strong>Marketplace</strong> as net-new revenue. Use the <strong>Configure</strong> tab to fine-tune.</p>
              </Card>
            </div>
          );
        })()}

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
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr className="text-xs text-gray-500">
                      {[
                        {col:null,            label:"Customer ID"},
                        {col:"connections",   label:"Connections"},
                        {col:null,            label:"Billing"},
                        {col:"mrr",           label:"Actual MRR"},
                        {col:"hybridMrr",     label:"Hybrid MRR"},
                        {col:"hybridDiff",    label:"Hybrid Diff"},
                        {col:"hybridDiffPct", label:"Hybrid Diff %"},
                      ].map(({col,label})=>(
                        <th key={label} onClick={()=>col&&toggleReconSort(col)} className={"text-left px-4 py-3 font-semibold whitespace-nowrap "+(col?"cursor-pointer select-none":"")}>
                          {label}{col&&(reconSort.col===col?(reconSort.dir==="desc"?" ▼":" ▲"):" ↕")}
                        </th>
                      ))}
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
                          <td className="px-4 py-2.5 font-mono font-bold" style={{color:"#059669"}}>{fmt(r.hybridMrr)}</td>
                          <td className="px-4 py-2.5 font-bold font-mono" style={{color:hybridUp?"#16a34a":"#dc2626"}}>{r.hybridDiff>=0?"+":""}{fmt(r.hybridDiff)}</td>
                          <td className="px-4 py-2.5">{r.hybridDiffPct!==null?<span className={"px-2 py-0.5 rounded font-semibold text-xs "+(Math.abs(r.hybridDiffPct)<1?"bg-gray-100 text-gray-500":hybridUp?"bg-green-100 text-green-700":"bg-rose-100 text-rose-700")}>{r.hybridDiffPct>=0?"+":""}{r.hybridDiffPct.toFixed(1)}%</span>:"—"}</td>
                        </tr>
                      );
                    })}
                    {reconPageRows.length===0&&<tr><td colSpan="7" className="px-4 py-8 text-center text-gray-400 text-sm">No customers match this filter</td></tr>}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="text-xs font-bold text-gray-700">
                      <td className="px-4 py-2.5" colSpan="3">{reconFilter!=="all"?"Filtered total ("+reconSorted.length+" customers)":"All "+data.length+" customers"}</td>
                      <td className="px-4 py-2.5 font-mono" style={{color:R.primaryText}}>{fmt(filteredActMrr)}</td>
                      <td className="px-4 py-2.5 font-mono font-bold text-green-700">{fmt(filteredHybridMrr)}</td>
                      <td className="px-4 py-2.5" colSpan="2"></td>
                    </tr>
                  </tfoot>
                </table>
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
      </div>
    </div>
  );
}
