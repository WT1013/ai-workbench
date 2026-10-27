let documents = [];
let currentViewDate = null;
let currentMetricIdx = 0;

let groups = [];

/* 顶部四张指标卡可自由更换展示指标（2026-10-27）
   卡位固定 4 个（配色/材质跟随位置，不随指标变），指标任选、不重复，localStorage 记住。
   阈值沿用汇报口径：采纳≥65 / 生成≥95 / 纯智≥35 / 3分钟回复≥95 / 风控≤15；转化率与体验分暂无目标线。 */
const METRIC_DEFS = {
  adopt: { doc: "adopt", label: "采纳率",      en: "ADOPT",      unit: "%", target: 65,   dir: "gte", prev: "pAdopt" },
  gen:   { doc: "gen",   label: "生成率",      en: "GENERATE",   unit: "%", target: 95,   dir: "gte", prev: "pGen" },
  conv:  { doc: "conv",  label: "转化率",      en: "CONVERT",    unit: "%", target: null, dir: "gte", prev: "pConv" },
  pure:  { doc: "pure",  label: "纯智能体占比", en: "PURE AI",    unit: "%", target: 35,   dir: "gte", prev: "pPure" },
  reply: { doc: "reply", label: "3分钟回复率",  en: "REPLY 3MIN", unit: "%", target: 95,   dir: "gte", prev: "pReply" },
  exp:   { doc: "exp",   label: "体验分",      en: "SCORE",      unit: "",  target: null, dir: "gte", prev: "pExp" },
  risk:  { doc: "risk",  label: "风控率",      en: "RISK",       unit: "%", target: 15,   dir: "lte", prev: "pRisk" }
};
const METRIC_ORDER = ["adopt", "gen", "conv", "pure", "reply", "exp", "risk"];
const SLOT_STORE = "csa-mc-slots-v1";
const DEFAULT_SLOTS = ["adopt", "gen", "conv", "pure"];

/* 底部引导条「一次性」（2026-10-27）
   滚轮换过 3 档、或点开过卡片，即视为学会了操作方式：引导文案淡出，
   胶囊收窄成「鼠标图标 + 当前指标·店铺」，会话内记住，刷新不再打扰。 */
const TIP_STORE = "csa-tip-learned";
let tipWheelTurns = 0;
let tipWheelAt = 0;
function dismissScrollTip() {
  const tip = document.querySelector(".scroll-tip");
  if (!tip || tip.classList.contains("learned")) return;
  tip.classList.add("learned");
  try { sessionStorage.setItem(TIP_STORE, "1"); } catch (_) { }
}
function restoreScrollTip() {
  try {
    if (sessionStorage.getItem(TIP_STORE) !== "1") return;
    const tip = document.querySelector(".scroll-tip");
    if (tip) tip.classList.add("learned");
  } catch (_) { }
}

function loadMetricSlots() {
  let arr = DEFAULT_SLOTS.slice();
  try {
    const raw = JSON.parse(localStorage.getItem(SLOT_STORE) || "null");
    if (Array.isArray(raw) && raw.length === DEFAULT_SLOTS.length) {
      const seen = new Set();
      arr = raw.map((k, i) => {
        if (METRIC_DEFS[k] && !seen.has(k)) { seen.add(k); return k; }
        const alt = DEFAULT_SLOTS.find((d) => !seen.has(d)) || METRIC_ORDER.find((d) => !seen.has(d));
        seen.add(alt);
        return alt;
      });
    }
  } catch (e) {}
  return arr;
}
let metricSlots = loadMetricSlots();

function saveMetricSlots() {
  try { localStorage.setItem(SLOT_STORE, JSON.stringify(metricSlots)); } catch (e) {}
}
/* 第 i 张卡当前展示的指标定义 */
function slotMetric(i) { return METRIC_DEFS[metricSlots[i]] || METRIC_DEFS.adopt; }
function slotMetrics() { return metricSlots.map((k) => METRIC_DEFS[k] || METRIC_DEFS.adopt); }
function currentMetric() { return slotMetric(currentMetricIdx); }

/* ===== 数据层：从云端拉取远山店铺数据 ===== */
const CLOUD_URL = "https://kocuowtqklojxkhzlwpe.supabase.co";
const CLOUD_KEY = "sb_publishable_EinGWbe2S8hHl0kqngnmIg_uyZ5xRnp";

let cloudDays = null;
let cloudShops = [];
let cloudLatestDate = null;

/* 镜像模式: CloudStudio 国内镜像(无法访问 Supabase 海外域名)时改读同源 state.json 快照; 支持 ?mirror=1 调试 */
const IS_MIRROR = typeof location !== "undefined" && (location.hostname.indexOf("app.workbuddy.link") >= 0 || /[?&]mirror=1/.test(location.search));

async function fetchCloud() {
  let days;
  if (IS_MIRROR) {
    const res = await fetch("./state.json");
    if (!res.ok) throw new Error("镜像数据加载失败 " + res.status);
    const obj = await res.json();
    days = obj.days || {};
  } else {
    const res = await fetch(`${CLOUD_URL}/rest/v1/state?select=days&id=eq.1`, {
      headers: { apikey: CLOUD_KEY, Authorization: `Bearer ${CLOUD_KEY}` }
    });
    if (!res.ok) throw new Error("云端请求失败 " + res.status);
    const data = await res.json();
    days = (data[0] && data[0].days) || {};
  }
  cloudDays = days;
  cloudShops = (days.__library__ && days.__library__.shops) || [];
  cloudLatestDate = findLatestFullDate(days);
  return { days, shops: cloudShops, latestDate: cloudLatestDate };
}

function findLatestFullDate(days) {
  const keys = Object.keys(days).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
  let latest = null;
  for (let i = keys.length - 1; i >= 0; i--) {
    const sd = days[keys[i]] && days[keys[i]].shopData;
    if (!sd) continue;
    // 最新一天"有探域数据(采纳率)"即为最新日期(体验分可能因拼多多T+1/未登录缺失, 不影响日期推进)
    let hasAdopt = false;
    Object.keys(sd).forEach((id) => {
      const v = sd[id] || {};
      if (v.adoptionRate !== undefined && v.adoptionRate !== null && String(v.adoptionRate) !== "") hasAdopt = true;
    });
    if (hasAdopt) { latest = keys[i]; break; }
  }
  return latest;
}

function metricVal(sd, field) {
  const v = sd && sd[field];
  return (v !== undefined && v !== null && String(v) !== "") ? parseFloat(v) : null;
}

/* 日期键 YYYY-MM-DD 偏移（2026-10-26 指标卡环比用） */
function shiftDateKey(key, delta) {
  const d = new Date(key + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* 回溯取「最近一次有值」：给体验分这类非每日更新的指标用（2026-10-27） */
function nearestMetricVal(days, dateKey, shopId, metric, maxBack) {
  if (!dateKey) return null;
  const back = (maxBack === undefined || maxBack === null) ? 14 : maxBack;
  for (let i = 0; i <= back; i++) {
    const k = shiftDateKey(dateKey, -i);
    const sd = days && days[k] && days[k].shopData && days[k].shopData[shopId];
    const v = metricVal(sd, metric);
    if (v !== null) return v;
  }
  return null;
}

function monthAvgVal(days, monthPrefix, shopId, metric) {
  let sum = 0, n = 0;
  Object.keys(days || {}).forEach((k) => {
    if (monthPrefix && k.indexOf(monthPrefix) !== 0) return;
    const sd = days[k] && days[k].shopData && days[k].shopData[shopId];
    const v = metricVal(sd, metric);
    if (v !== null) { sum += v; n++; }
  });
  return n ? sum / n : null;
}

function buildDocuments(shops, days, date) {
  const monthPrefix = date ? date.slice(0, 7) : null;
  return shops.map((shop) => {
    const sd = (days[date] && days[date].shopData && days[date].shopData[shop.id]) || {};
    const adopt = metricVal(sd, "adoptionRate");
    const gen = metricVal(sd, "generationRate");
    const conv = metricVal(sd, "conversionRate");
    const pure = metricVal(sd, "pureAgentRatio");
    const reply = metricVal(sd, "threeMinReplyRate");
    /* 体验分不是每日出数（拼多多侧周期更新，2026-10-25 起停更）：
       当日无值时回溯最近 14 天，避免卡片与详情在空窗期整片显示 -- */
    const expRaw = metricVal(sd, "experienceScore");
    const exp = expRaw !== null ? expRaw : (date ? nearestMetricVal(days, date, shop.id, "experienceScore", 14) : null);
    const risk = metricVal(sd, "riskRate");
    const expAvg = (exp !== null && monthPrefix) ? monthAvgVal(days, monthPrefix, shop.id, "experienceScore") : null;
    // 环比基准：前一天（2026-10-26 指标卡四段式）
    const prevDateStr = date ? shiftDateKey(date, -1) : null;
    const sdP = (prevDateStr && days[prevDateStr] && days[prevDateStr].shopData && days[prevDateStr].shopData[shop.id]) || {};
    const pAdopt = metricVal(sdP, "adoptionRate");
    const pGen = metricVal(sdP, "generationRate");
    const pConv = metricVal(sdP, "conversionRate");
    const pPure = metricVal(sdP, "pureAgentRatio");
    const pReply = metricVal(sdP, "threeMinReplyRate");
    const pExp = prevDateStr ? nearestMetricVal(days, prevDateStr, shop.id, "experienceScore", 14) : null;
    const pRisk = metricVal(sdP, "riskRate");
    const isKey = shop.key === true;
    const fmt = (v) => (v === null ? "--" : String(v));
    const missCore = [adopt, gen, conv, pure, reply].some((v) => v === null);
    let status = "达标", priority = "中";
    if (missCore) { status = "缺数据"; priority = "高"; }
    else if (reply !== null && reply > 0 && reply < 95) { status = "回复率偏低"; priority = "高"; }
    else if (exp !== null && expAvg !== null && expAvg - exp >= 0.3) { status = "体验分下跌"; priority = "高"; }
    return {
      id: shop.id,
      short: shop.name.slice(0, 4) + " · 采纳" + fmt(adopt) + "%",
      title: shop.name,
      detailTitle: shop.name,
      subtitle: "采纳" + fmt(adopt) + "% · 体验" + fmt(exp),
      state: status,
      folder: isKey ? "重点店" : "店铺",
      priority: priority,
      date: date,
      status: status,
      description: "采纳率 " + fmt(adopt) + "% · 生成率 " + fmt(gen) + "% · 转化率 " + fmt(conv) + "% · 纯智能体 " + fmt(pure) + "%",
      tags: ["生成" + fmt(gen) + "%", "转化" + fmt(conv) + "%", "回复" + fmt(reply) + "%"],
      advice: [
        "生成率 " + fmt(gen) + "%",
        "转化率 " + fmt(conv) + "%",
        "纯智能体占比 " + fmt(pure) + "%",
        "3分钟回复率 " + fmt(reply) + "%"
      ],
      accent: isKey ? "warm" : (adopt !== null && adopt >= 50 ? "green" : "mist"),
      completion: adopt === null ? 0 : Math.round(adopt),
      metrics: { adopt, gen, conv, pure, reply, exp, expAvg, risk, pAdopt, pGen, pConv, pPure, pReply, pExp, pRisk }
    };
  });
}

function buildGroups(docs) {
  // 缺数据：扫描本月所有日期，列出每个店铺累计缺失明细
  const base = cloudLatestDate || todayKeyStr();
  const monthPrefix = base.slice(0, 7);
  const missFields = [
    { key: "adoptionRate", label: "采纳率" },
    { key: "generationRate", label: "生成率" },
    { key: "conversionRate", label: "转化率" },
    { key: "pureAgentRatio", label: "纯智" },
    { key: "threeMinReplyRate", label: "3分钟回复率" }
  ];
  const missItems = []; // { name, days: [day] }
  const todayKey = todayKeyStr();
  cloudShops.forEach((shop) => {
    const map = {}; // day -> [metrics]
    Object.keys(cloudDays).forEach((dt) => {
      if (dt.indexOf(monthPrefix) !== 0) return;
      if (dt >= todayKey) return; // 今天及未来不��缺数据
      const sd = cloudDays[dt] && cloudDays[dt].shopData && cloudDays[dt].shopData[shop.id];
      missFields.forEach((f) => {
        if (metricVal(sd, f.key) === null) {
          (map[dt.slice(8)] = map[dt.slice(8)] || []).push(f.label);
        }
      });
    });
    const days = Object.keys(map).sort();
    if (!days.length) return;
    missItems.push({ name: shop.name, days });
  });
  missItems.sort((a, b) => b.days.length - a.days.length);
  const lowExp = docs.filter((d) => d.metrics.exp !== null && d.metrics.expAvg !== null && d.metrics.expAvg - d.metrics.exp >= 0.3);
  const lowReply = docs.filter((d) => d.metrics.reply !== null && d.metrics.reply > 0 && d.metrics.reply < 95);
  // 指标异常 = 昨日较前日 4 项指标下降 ≥20 个百分点
  const todayK = todayKeyStr();
  const yKey = yesterdayKeyOf(todayK);
  const pKey = yesterdayKeyOf(yKey);
  const dropFields = [
    { key: "adoptionRate", label: "采纳率" },
    { key: "generationRate", label: "生成率" },
    { key: "conversionRate", label: "转化率" },
    { key: "pureAgentRatio", label: "纯智能体" }
  ];
  const dropItems = [];
  cloudShops.forEach((shop) => {
    const downs = [];
    dropFields.forEach((m) => {
      const sdY = cloudDays[yKey] && cloudDays[yKey].shopData && cloudDays[yKey].shopData[shop.id];
      const sdP = cloudDays[pKey] && cloudDays[pKey].shopData && cloudDays[pKey].shopData[shop.id];
      const latest = metricVal(sdY, m.key);
      const prev = metricVal(sdP, m.key);
      if (latest !== null && prev !== null) {
        const diff = Math.round((latest - prev) * 100) / 100;
        if (diff <= -20) downs.push({ label: m.label, diff: Math.abs(diff) });
      }
    });
    if (downs.length) dropItems.push({ name: shop.name, downs });
  });
  dropItems.sort((a, b) => b.downs.length - a.downs.length);
  const groups = [];
  if (missItems.length) groups.push({ type: "miss", name: "本月缺数据", count: missItems.length, color: "#ff8539", defaultCollapsed: true, items: missItems.map((it) => [it.name, "本月缺 " + it.days.length + " 天", it.days.map((d) => d + "日").join("·")]) });
  if (dropItems.length) groups.push({ type: "drop", name: "昨日大幅下降(≥20%)", count: dropItems.length, color: "#ff4aa9", items: dropItems.map((it) => [it.name, it.downs.map((m) => m.label + "↓" + m.diff + "%").join("、"), "昨日"]) });
  if (lowExp.length) groups.push({ type: "abn", name: "体验分较月均下跌(≥0.3)", count: lowExp.length, color: "#ff8539", items: lowExp.map((d) => [d.title, "体验" + d.metrics.exp + " · 月均" + (d.metrics.expAvg === null ? "--" : Math.round(d.metrics.expAvg * 10) / 10), "关注"]) });
  if (lowReply.length) groups.push({ type: "abn", name: "回复率偏低(<95% 且非0)", count: lowReply.length, color: "#56b8ff", items: lowReply.map((d) => [d.title, "回复" + d.metrics.reply + "%", "关注"]) });
  if (!groups.length) groups.push({ type: "ok", name: "数据健康", count: docs.length, color: "var(--accent-400)", items: [["全部店铺指标正常", "达标", docs.length + " 家"]] });
  return groups;
}

/* 2026-10-26 指标卡四段式：值 / 环比 / 目标线 / 状态
   阈值取汇报口径：采纳率≥65、生成率≥95、纯智占比≥35；转化率暂无目标线。 */
/* 排行表 / 徽标沿用同一套阈值 */
const MC_TARGETS = METRIC_ORDER.reduce(function (acc, k) {
  acc[k] = { target: METRIC_DEFS[k].target, dir: METRIC_DEFS[k].dir };
  return acc;
}, {});

/* 四张卡的「静态部分」：英文标号 + 中文名（换指标后立即生效） */
function renderMetricCardMeta() {
  metricCards.forEach(function (card, i) {
    const def = slotMetric(i);
    const enEl = card.querySelector(":scope > span");
    if (enEl) enEl.textContent = def.en;
    const nameEl = card.querySelector("h3 .mc-name");
    if (nameEl) nameEl.textContent = def.label;
  });
}

let lastCardFocusIdx;

function updateMetricCards(docs, focusIdx) {
  lastCardFocusIdx = focusIdx;
  const focus = (focusIdx !== undefined && docs[focusIdx]) ? docs[focusIdx] : null;
  const avg = function (f) {
    if (focus) { const v = focus.metrics[f]; return (v === null || v === undefined) ? null : v; }
    const vals = docs.map(function (d) { return d.metrics[f]; }).filter(function (v) { return v !== null && v !== undefined; });
    return vals.length ? (vals.reduce(function (a, b) { return a + b; }, 0) / vals.length).toFixed(2) : null;
  };
  renderMetricCardMeta();

  metricCards.forEach(function (card, i) {
    const def = slotMetric(i);
    const now = avg(def.doc);
    const before = avg(def.prev);
    const isPct = def.unit === "%";
    const target = def.target;

    /* 大数字 + 单位 */
    const vEl = card.querySelector("strong");
    if (vEl) vEl.innerHTML = (now === null ? "--" : now) + (def.unit ? "<small>" + def.unit + "</small>" : "");

    /* 副标题：全店均值 / 已选店铺 */
    const sEl = card.querySelector("p > em");
    if (sEl) sEl.textContent = focus ? "已选：" + focus.title : "全店均值 · " + docs.length + " 家";

    /* 环比：百分比用 pp，体验分用绝对差 */
    const cmpEl = card.querySelector(".mc-cmp");
    if (cmpEl) {
      if (now === null || before === null) {
        cmpEl.className = "mc-cmp mc-flat";
        cmpEl.textContent = "—";
        cmpEl.title = "前日无数据";
      } else {
        const d = Number(now) - Number(before);
        const txt = (d > 0 ? "+" : "") + (Math.round(d * 100) / 100) + (isPct ? "pp" : "");
        const arrow = Math.abs(d) < 0.005 ? "·" : (d > 0 ? "▲" : "▼");
        cmpEl.className = "mc-cmp " + (Math.abs(d) < 0.005 ? "mc-flat" : (d > 0 ? "mc-up" : "mc-down"));
        cmpEl.textContent = arrow + " " + txt;
        cmpEl.title = "较前日 " + txt + "（前日 " + (Math.round(Number(before) * 100) / 100) + def.unit + "）";
      }
    }

    /* 状态徽标 */
    const badge = card.querySelector(".mc-badge");
    if (badge) {
      if (now === null || target === null || target === undefined) {
        badge.hidden = true;
      } else {
        const ok = def.dir === "gte" ? Number(now) >= target : Number(now) <= target;
        badge.hidden = false;
        badge.className = "mc-badge " + (ok ? "is-ok" : "is-bad");
        badge.textContent = ok ? "达标" : "未达标";
      }
    }

    /* 目标线 */
    const tgt = card.querySelector(".mc-target");
    if (tgt) {
      if (target === null || target === undefined) {
        tgt.textContent = "无目标线";
        tgt.classList.add("mc-target-na");
        tgt.classList.remove("mc-target-miss");
      } else {
        tgt.classList.remove("mc-target-na");
        const gap = now === null ? null : Math.round((target - Number(now)) * 100) / 100;
        const behind = gap !== null && (def.dir === "gte" ? gap > 0 : gap < 0);
        tgt.classList.toggle("mc-target-miss", behind);
        tgt.textContent = "目标 " + (def.dir === "gte" ? "≥" : "≤") + target + def.unit;
      }
    }
  });
}

/* ===== 月度汇总视图 ===== */
const MONTHLY_METRICS = [
  { key: "adoptionRate", label: "采纳率" },
  { key: "generationRate", label: "生成率" },
  { key: "conversionRate", label: "转化率" },
  { key: "pureAgentRatio", label: "纯智能体" },
  { key: "experienceScore", label: "体验分" },
  { key: "threeMinReplyRate", label: "3分钟回复率" },
];
let monthlyMetric = "adoptionRate";
// 2026-10-26：原来硬编码 2026/7（=8月），打开月度汇总永远看到 8 月，改为当前月
let monthlyYear = new Date().getFullYear();
let monthlyMonth = new Date().getMonth();

/* 重点店铺(key===true)置顶，其余保持原顺序（与「店铺库」列表一致） */
function shopsKeyFirst(list) {
  return list.slice().sort((a, b) => (b.key === true ? 1 : 0) - (a.key === true ? 1 : 0));
}

function pctSuffix(metric) {
  return metric === "experienceScore" ? "" : "%";
}

function renderMonthlySeg() {
  const seg = document.querySelector("#monthlyMetricSeg");
  if (!seg) return;
  seg.innerHTML = MONTHLY_METRICS.map((m) =>
    `<button data-metric="${m.key}" class="${m.key === monthlyMetric ? "active" : ""}">${m.label}</button>`
  ).join("");
  seg.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    monthlyMetric = b.dataset.metric;
    renderMonthlySeg();
    renderMonthlyTable();
  }));
}

/* 月份选择器：点击月份标题弹出整年 12 个月，点击切换月份 */
function renderMonthPicker() {
  const yearLabel = document.querySelector("#mpYearLabel");
  const grid = document.querySelector("#mpGrid");
  if (!yearLabel || !grid) return;
  yearLabel.textContent = monthlyYear;
  grid.innerHTML = "";
  for (let m = 0; m < 12; m++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mp-month" + (m === monthlyMonth ? " active" : "");
    btn.textContent = (m + 1) + "月";
    btn.title = monthlyYear + "年" + (m + 1) + "月";
    btn.addEventListener("click", () => {
      monthlyMonth = m;
      renderMonthlyTable();
      hideMonthPicker();
    });
    grid.appendChild(btn);
  }
}
function showMonthPicker() {
  const picker = document.querySelector("#monthPicker");
  const head = document.querySelector(".monthly-head");
  if (!picker) return;
  renderMonthPicker();
  picker.hidden = false;
  if (head) head.classList.add("mp-open");
}
function hideMonthPicker() {
  const picker = document.querySelector("#monthPicker");
  const head = document.querySelector(".monthly-head");
  if (picker) picker.hidden = true;
  if (head) head.classList.remove("mp-open");
}
function toggleMonthPicker() {
  const picker = document.querySelector("#monthPicker");
  if (!picker) return;
  if (picker.hidden) showMonthPicker(); else hideMonthPicker();
}
function bindMonthPicker() {
  const title = document.querySelector("#monthlyDateTitle");
  const prev = document.querySelector("#mpYearPrev");
  const next = document.querySelector("#mpYearNext");
  if (title) title.addEventListener("click", toggleMonthPicker);
  if (prev) prev.addEventListener("click", (e) => { e.stopPropagation(); monthlyYear -= 1; renderMonthPicker(); });
  if (next) next.addEventListener("click", (e) => { e.stopPropagation(); monthlyYear += 1; renderMonthPicker(); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".month-picker") && !e.target.closest("#monthlyDateTitle")) hideMonthPicker();
  });
}

/* 比率型指标的加权口径：月均 = Σ分子 ÷ Σ分母（与探域月报 natural_month 一致）
   注意分母：采纳率/生成率/风控率三者共用卡片事件数 ai_agent_card_event_cnt，
   采纳率不是「采纳数÷生成数」（那样松迅 10 月会算成 69.68%，实际 65.32%） */
const MONTHLY_RATIO = {
  adoptionRate:   { num: "adoptCount", den: "agenticMsgCount" },
  generationRate: { num: "genCount",   den: "agenticMsgCount" },
  riskRate:       { num: "riskCount",  den: "agenticMsgCount" }
};

function toNumOrNull(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

/* 某店某月的「月均」（2026-10-27 由「日均」改为「月均」）
   日均 = 各日比率简单平均：一个只有 5 条对话的淡日与 2000 条的大日等权，
   会被低量日严重拉偏，也和探域后台月报口径不一致，故改为月均：
     · 采纳率 / 生成率 / 风控率 → Σ分子 ÷ Σ分母（计数加权，与探域 natural_month 相同）
     · 转化率 / 3分钟回复率 / 纯智 → 以当日卡片事件数加权（无原始分子分母可用）
     · 体验分 → 有值日期的简单平均（分数型，不适用加权）
   未过完的月份 = 累计至今。分母全缺时回退简单平均（早期月份只有比率、没存计数）。 */
function shopMonthStat(shopId, prefix, metric) {
  const y = parseInt(prefix.slice(0, 4), 10);
  const m = parseInt(prefix.slice(5, 7), 10);
  const daysIn = new Date(y, m, 0).getDate();
  const spec = MONTHLY_RATIO[metric];
  let sum = 0, n = 0;        // 简单平均（兜底）
  let num = 0, den = 0;      // 计数加权
  let wsum = 0, wden = 0;    // 事件加权
  for (let i = 1; i <= daysIn; i++) {
    const k = prefix + "-" + String(i).padStart(2, "0");
    const day = cloudDays && cloudDays[k];
    const sd = day && day.shopData && day.shopData[shopId];
    if (!sd) continue;
    const val = toNumOrNull(sd[metric]);
    if (val !== null) { sum += val; n++; }
    if (spec) {
      const a = toNumOrNull(sd[spec.num]);
      const b = toNumOrNull(sd[spec.den]);
      if (a !== null && b !== null && b > 0) { num += a; den += b; }
    } else if (val !== null) {
      const w = toNumOrNull(sd.agenticMsgCount);
      if (w !== null && w > 0) { wsum += val * w; wden += w; }
    }
  }
  if (spec && den > 0) return { avg: (num / den) * 100, mode: "weighted" };
  if (!spec && wden > 0) return { avg: wsum / wden, mode: "weighted" };
  if (n) return { avg: sum / n, mode: "simple" };
  return { avg: null, mode: "none" };
}

function shopMonthAvg(shopId, prefix, metric) {
  return shopMonthStat(shopId, prefix, metric).avg;
}

/* 月份偏移，返回 { y, m, prefix } */
function monthShift(y, m, delta) {
  const d = new Date(y, m + delta, 1);
  return { y: d.getFullYear(), m: d.getMonth(), prefix: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` };
}

function fmt2(v, sfx) {
  if (v === null || v === undefined || isNaN(v)) return "—";
  return (Math.round(v * 100) / 100) + sfx;
}

function renderMonthlyTable() {
  document.querySelector("#monthlyDateTitle").textContent = monthlyYear + "年" + (monthlyMonth + 1) + "月";
  const daysInMonth = new Date(monthlyYear, monthlyMonth + 1, 0).getDate();
  const head = document.querySelector("#monthlyTableHead");
  const body = document.querySelector("#monthlyTableBody");
  const prefix = `${monthlyYear}-${String(monthlyMonth + 1).padStart(2, "0")}`;
  const prev = monthShift(monthlyYear, monthlyMonth, -1);
  const sfx = pctSuffix(monthlyMetric);
  const isScore = monthlyMetric === "experienceScore";

  // 表头：左侧固定区（店铺 / 月均 / 环比 / 排名）+ 右侧每日
  const avgTip = isScore
    ? "月均＝本月有值日期的平均分"
    : "月均＝本月累计口径（采纳数÷生成数 等），不是各日比率的简单平均；未过完的月份为累计至今";
  let headHtml = '<tr><th class="mt-name">店铺</th><th class="mt-sum" title="' + avgTip + '">月均</th><th class="mt-sum">环比</th><th class="mt-sum mt-rank">排名</th>';
  for (let i = 1; i <= daysInMonth; i++) headHtml += `<th class="mt-day">${i}</th>`;
  headHtml += "</tr>";
  head.innerHTML = headHtml;

  // 第一遍：收集每日值与月均
  const rows = shopsKeyFirst(cloudShops).map((shop) => {
    const vals = [];
    for (let i = 1; i <= daysInMonth; i++) {
      const dateKey = prefix + "-" + String(i).padStart(2, "0");
      const day = cloudDays && cloudDays[dateKey];
      const v = (day && day.shopData && day.shopData[shop.id]) ? day.shopData[shop.id][monthlyMetric] : null;
      vals.push(toNumOrNull(v));
    }
    const stat = shopMonthStat(shop.id, prefix, monthlyMetric);
    const pstat = shopMonthStat(shop.id, prev.prefix, monthlyMetric);
    return { shop, vals, avg: stat.avg, mode: stat.mode, prevAvg: pstat.avg, prevMode: pstat.mode, rank: 0 };
  });

  // 排名：有数据的店按月均降序
  rows.filter((r) => r.avg !== null).sort((a, b) => b.avg - a.avg).forEach((r, i) => { r.rank = i + 1; });

  // 月均热力归一化（仅月均列，避免每日格子过度着色）
  const avgList = rows.map((r) => r.avg).filter((v) => v !== null);
  const lo = avgList.length ? Math.min(...avgList) : 0;
  const hi = avgList.length ? Math.max(...avgList) : 1;
  const heat = (v) => {
    if (v === null || hi === lo) return "";
    const t = (v - lo) / (hi - lo);           // 0..1
    return `background: rgb(var(--accent-rgb) / ${(0.05 + t * 0.16).toFixed(3)});`;
  };

  body.innerHTML = rows.map((r) => {
    const isKey = r.shop.key === true;
    const cells = r.vals.map((v) => `<td class="mt-day${v === null ? " mt-null" : ""}">${v === null ? "—" : fmt2(v, sfx)}</td>`).join("");
    // 环比：百分比指标用「百分点差」，体验分用普通差值
    let cmp = '<span class="mt-na">—</span>';
    if (r.avg !== null && r.prevAvg !== null) {
      const d = r.avg - r.prevAvg;
      const cls = Math.abs(d) < 0.005 ? "mt-flat" : (d > 0 ? "mt-up" : "mt-down");
      const txt = (d > 0 ? "+" : "") + (Math.round(d * 100) / 100) + (isScore ? "" : "pp");
      const arrow = Math.abs(d) < 0.005 ? "·" : (d > 0 ? "▲" : "▼");
      const warn = r.prevMode === "simple"
        ? "（上月未存计数，为简单平均，口径略有差异）"
        : "";
      cmp = `<span class="${cls}" title="上月月均 ${fmt2(r.prevAvg, sfx)}${warn}">${arrow}${txt}</span>`;
    } else if (r.avg !== null) {
      cmp = '<span class="mt-na" title="上月无数据">—</span>';
    }
    const avgTitle = r.mode === "simple"
      ? "本月未存计数，退化为各日简单平均"
      : "月均（累计口径）";
    return `<tr class="${isKey ? "key-row" : ""}">` +
      `<td class="mt-name" title="${r.shop.name}">${r.shop.name}</td>` +
      `<td class="mt-sum mt-avg" style="${heat(r.avg)}" title="${avgTitle}">${fmt2(r.avg, sfx)}</td>` +
      `<td class="mt-sum">${cmp}</td>` +
      `<td class="mt-sum mt-rank">${r.rank ? r.rank : "—"}</td>` +
      cells + "</tr>";
  }).join("");
}

function setDashboardMode(mode) {
  const shell = document.querySelector(".app-shell");
  const monthlyView = document.querySelector("#monthlyView");
  const metricGrid = document.querySelector(".metric-grid");
  const workspaceGrid = document.querySelector(".workspace-grid");
  const detailsPanel = document.querySelector(".details-panel");
  const wbViews = {
    today: document.querySelector("#todayView"),
    report: document.querySelector("#reportView"),
    shops: document.querySelector("#shopsView"),
    summary: document.querySelector("#summaryView"),
    groups: document.querySelector("#groupsView"),
    ai: document.querySelector("#aiView")
  };
  const isWbView = !!wbViews[mode];
  // 隐藏所有工作台内置视图
  Object.keys(wbViews).forEach((k) => { if (wbViews[k]) wbViews[k].hidden = true; });
  if (monthlyView) monthlyView.hidden = true;
  // dashboard 内容显隐: dashboard=全部; monthly=保留指标卡; 工作台视图=隐藏
  if (metricGrid) metricGrid.style.display = isWbView ? "none" : "";
  if (workspaceGrid) workspaceGrid.style.display = (mode === "dashboard") ? "" : "none";
  if (shell) {
    shell.classList.toggle("monthly-mode", mode === "monthly");
    shell.classList.toggle("workbench-mode", isWbView);
  }

  if (mode === "monthly") {
    monthlyView.hidden = false;
    renderMonthlyTable();
  } else if (isWbView) {
    wbViews[mode].hidden = false;
    if (mode === "today" && typeof window.wbRenderToday === "function") window.wbRenderToday();
    else if (mode === "report" && typeof window.wbRenderReport === "function") window.wbRenderReport();
    else if (mode === "shops" && typeof window.wbRenderShops === "function") window.wbRenderShops();
    else if (mode === "summary" && typeof window.wbRenderSummary === "function") window.wbRenderSummary();
    else if (mode === "groups" && typeof window.wbRenderGroups === "function") window.wbRenderGroups();
    else if (mode === "ai" && typeof window.wbRenderAi === "function") window.wbRenderAi();
  }
  document.querySelectorAll('.primary-nav .nav-item[data-view]').forEach((b) => {
    b.classList.toggle("active", b.dataset.view === mode);
  });
}

const materialPalettes = {
  cyan: ["#27e8df", "#11a9c8", "#17346f"],
  original: ["#ff4aa9", "#ff8849", "#aa49ff"],
  rain: ["#2e66ff", "#ff693f", "#4721ac"],
  chrome: ["#f4f8f6", "#8d9996", "#11172b"],
};

let selectedIndex = 1;
let isPlaying = true;
let speed = 2;
let autoplayTimer;
let autoplayLastFrame = 0;
let pointerStart = null;
let pointerCurrent = null;
let toastTimer;
let detailAnimationTimer;
let motionTimer;
let visualPosition = selectedIndex;
let targetPosition = selectedIndex;
let carouselFrame = null;
let lastFrameTime = 0;
let lastWheelDirection = 1;
let dragOriginPosition = selectedIndex;
let viewMode = "orbit";
let selectedMetricIndex = 0;
let themePreference = document.documentElement.dataset.theme || "dark";
let accentPreference = document.documentElement.dataset.accent || "ocean";

const scene = document.querySelector("#cardScene");
const viewport = document.querySelector("#carouselViewport");
const playToggle = document.querySelector("#playToggle");
const playLabel = playToggle.querySelector(".play-label");
const orbitModeBtn = document.querySelector("#orbitModeBtn");
const fanModeBtn = document.querySelector("#fanModeBtn");
const rankModeBtn = document.querySelector("#rankModeBtn");
const rankViewEl = document.querySelector("#rankView");
const carouselPanelEl = document.querySelector(".carousel-panel");
const timelineDates = document.querySelector("#timelineDates");
const progress = document.querySelector("#timelineProgress");
const detailsContent = document.querySelector(".details-content");
const materialOverlay = document.querySelector("#materialOverlay");
const materialPreview = document.querySelector("#materialPreview");
const metricCards = [...document.querySelectorAll(".metric-card")];
const materialCardSelect = document.querySelector("#materialCardSelect");
const themeControl = document.querySelector(".theme-control");
const themeToggleBtn = document.querySelector("#themeToggleBtn");
const systemThemeQuery = window.matchMedia("(prefers-color-scheme: light)");
metricCards.forEach((card) => {
  const opacity = Number(card.dataset.opacity || 100) / 100;
  const blur = Number(card.dataset.blur || 18);
  const flow = Number(card.dataset.flow || 200);
  card.style.setProperty("--material-opacity", opacity);
  card.style.setProperty("--material-blur", `${blur}px`);
  card.style.setProperty("--flow-duration", `${Math.max(2.2, 8 - flow / 50)}s`);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-pressed", "false");
  card.setAttribute("aria-label", `选择${card.querySelector("h3").textContent}进行配色设置`);
  const marker = document.createElement("span");
  marker.className = "metric-select-mark";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = "✓ 已选择";
  card.appendChild(marker);
});

/* ===== 指标卡更换展示指标（2026-10-27） =====
   点击卡片上的指标名 → 弹出 7 个指标；已被别张卡占用则两张互换，不出现重复。 */
let mcPickerEl = null;
let mcPickerSlot = -1;

function onPickerOutside(e) {
  if (mcPickerEl && !mcPickerEl.contains(e.target)) closeMetricPicker();
}
function closeMetricPicker() {
  if (mcPickerEl && mcPickerEl.parentNode) mcPickerEl.parentNode.removeChild(mcPickerEl);
  mcPickerEl = null;
  mcPickerSlot = -1;
  document.removeEventListener("click", onPickerOutside, true);
}

function openMetricPicker(slotIdx, anchorEl) {
  closeMetricPicker();
  mcPickerSlot = slotIdx;
  const el = document.createElement("div");
  el.className = "mc-picker";
  el.setAttribute("role", "menu");
  el.innerHTML = '<div class="mc-picker-head">第 ' + (slotIdx + 1) + ' 张卡展示</div>' +
    METRIC_ORDER.map(function (k) {
      const d = METRIC_DEFS[k];
      const at = metricSlots.indexOf(k);
      const cur = at === slotIdx;
      const hint = cur ? "当前" : (at >= 0 ? "与第 " + (at + 1) + " 张互换" : "");
      return '<button type="button" role="menuitem" data-metric="' + k + '" class="' + (cur ? "is-cur" : "") + '">' +
        '<span class="mc-pick-name">' + d.label + '</span>' +
        '<span class="mc-pick-en">' + d.en + '</span>' +
        (hint ? '<span class="mc-pick-hint">' + hint + '</span>' : "") +
        "</button>";
    }).join("");
  document.body.appendChild(el);

  const r = anchorEl.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.min(Math.max(8, r.left - 10), Math.max(8, window.innerWidth - w - 8));
  let top = r.bottom + 8;
  if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
  el.style.left = left + "px";
  el.style.top = top + "px";

  el.querySelectorAll("button").forEach(function (b) {
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      applySlotMetric(mcPickerSlot, b.dataset.metric);
      closeMetricPicker();
    });
  });
  window.setTimeout(function () { document.addEventListener("click", onPickerOutside, true); }, 0);
  mcPickerEl = el;
}

function applySlotMetric(slotIdx, key) {
  if (!METRIC_DEFS[key] || slotIdx < 0 || slotIdx >= metricSlots.length) return;
  if (metricSlots[slotIdx] === key) return;
  const at = metricSlots.indexOf(key);
  if (at >= 0) metricSlots[at] = metricSlots[slotIdx];   // 已被别张卡占用 → 两张互换
  metricSlots[slotIdx] = key;
  saveMetricSlots();
  renderMetricCardMeta();
  if (documents.length) updateMetricCards(documents, lastCardFocusIdx);
  if (typeof rankMode !== "undefined" && rankMode) renderRankTable();
  if (documents[selectedIndex]) updateDetails(documents[selectedIndex]);
  showToast("第 " + (slotIdx + 1) + " 张卡已切换为「" + METRIC_DEFS[key].label + "」");
}

metricCards.forEach(function (card, i) {
  const nameEl = card.querySelector("h3 .mc-name");
  if (!nameEl) return;
  nameEl.classList.add("is-switchable");
  nameEl.setAttribute("tabindex", "0");
  nameEl.setAttribute("role", "button");
  nameEl.setAttribute("aria-label", "更换指标");
  nameEl.addEventListener("click", function (e) {
    e.stopPropagation();
    e.preventDefault();
    openMetricPicker(i, nameEl);
  });
  nameEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); e.stopPropagation();
      openMetricPicker(i, nameEl);
    }
  });
});
renderMetricCardMeta();

const initialMetricStates = metricCards.map((card) => ({
  material: card.dataset.material || "original",
  opacity: card.dataset.opacity || "100",
  blur: card.dataset.blur || "18",
  flow: card.dataset.flow || "200",
  colors: [card.dataset.colorA || "#f4f8f6", card.dataset.colorB || "#8d9996", card.dataset.colorC || "#11172b"],
}));

function icon(name) {
  return `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
}

let queueFilter = "all";
let searchQuery = "";

function applyNoticeFilter() {
  const f = queueFilter;
  const std = document.querySelector("#stdNoticeBar");
  const gap = document.querySelector("#gapNoticeBar");
  const down = document.querySelector("#downNoticeBar");
  const risk = document.querySelector("#riskNoticeBar");
  // 全部：全部显示；缺数据：只显示缺口；指标异常：只显示昨日大幅下降 + 风控率
  if (std) std.hidden = (f !== "all");
  if (gap) gap.hidden = (f === "abn");
  if (down) down.hidden = (f === "miss");
  if (risk) risk.hidden = (f === "miss");
}

function renderQueue() {
  const container = document.querySelector("#queueGroups");
  const list = groups.filter((g) => {
    if (queueFilter === "miss") return g.type === "miss";
    if (queueFilter === "abn") return g.type === "drop";
    return true;
  });
  applyNoticeFilter();
  const q = searchQuery.trim().toLowerCase();
  const rows = list.map((group) => ({
    ...group,
    items: q ? group.items.filter((it) => it[0].toLowerCase().includes(q)) : group.items
  })).filter((group) => group.items.length > 0);
  // 默认展开"缺数据"之外的第一个分组(避免缺数据始终展开占据视觉)
  const firstOpenIdx = rows.findIndex((g) => g.type !== "miss");
  container.innerHTML = rows.length
    ? rows.map((group, groupIndex) => `
    <article class="queue-group ${(!group.defaultCollapsed && groupIndex === firstOpenIdx) ? "open" : ""}">
      <button class="group-head" style="--group-color:${group.color}"><span><i></i>${group.name} <b>${group.items.length}</b></span><svg><use href="#i-chevron"/></svg></button>
      <div class="group-items">
        ${group.items.map((item) => `<button class="queue-item"><span>${item[0]}</span><em>${item[1]}</em><small>${item[2]}</small></button>`).join("")}
      </div>
    </article>
  `).join("")
    : '<div class="queue-empty">暂无匹配项</div>';

  container.querySelectorAll(".group-head").forEach((button) => {
    button.addEventListener("click", () => button.closest(".queue-group").classList.toggle("open"));
  });
  container.querySelectorAll(".queue-item").forEach((button) => button.addEventListener("click", () => {
    const name = button.querySelector("span").textContent;
    const idx = documents.findIndex((d) => d.title === name);
    if (idx >= 0) selectCard(idx, true);
    else showToast(`已打开「${name}」`);
  }));
}

/* ===== 达标提醒（当月均值 vs 自定义阈值，兼容老工作台 csa-metric-thresholds） ===== */
const THRESH_KEY = "csa-metric-thresholds";
const THRESH_FIELDS = [
  { key: "adoptionRate", label: "采纳率", unit: "%" },
  { key: "generationRate", label: "生成率", unit: "%" },
  { key: "conversionRate", label: "转化率", unit: "%" },
  { key: "pureAgentRatio", label: "纯智能体占比", unit: "%" }
];
const THRESH_DEFAULT = { adoptionRate: 50, generationRate: 90, conversionRate: 20, pureAgentRatio: 35 };

/* 考核标准变更迁移：纯智能体占比标准 30% → 35%（2026-09-24），仅抬升低于新标准的旧值 */
const THRESH_MIGR_KEY = "csa-threshold-migr";
const THRESH_MIGR_VERSION = 2;
function migrateThresholds() {
  try {
    const cur = parseInt(localStorage.getItem(THRESH_MIGR_KEY) || "0", 10);
    if (cur >= THRESH_MIGR_VERSION) return;
    let s = null;
    try { s = JSON.parse(localStorage.getItem(THRESH_KEY) || "null"); } catch (e) {}
    const t = Object.assign({}, THRESH_DEFAULT, s && typeof s === "object" ? s : {});
    if (!(parseFloat(t.pureAgentRatio) >= 35)) t.pureAgentRatio = 35;
    saveThresholds(t);
    localStorage.setItem(THRESH_MIGR_KEY, String(THRESH_MIGR_VERSION));
  } catch (e) {}
}
migrateThresholds();

function thresholdSettings() {
  let t = THRESH_DEFAULT;
  try {
    const s = JSON.parse(localStorage.getItem(THRESH_KEY) || "null");
    if (s && typeof s === "object") t = Object.assign({}, THRESH_DEFAULT, s);
  } catch (e) {}
  return t;
}
function saveThresholds(t) {
  try { localStorage.setItem(THRESH_KEY, JSON.stringify(t)); } catch (e) {}
}

/* ===== 缺口检查设置(检查天数) ===== */
const GAP_DAYS_KEY = "csa-gap-days";
const GAP_DAYS_DEFAULT = 7;
function gapDays() {
  try {
    const v = parseInt(localStorage.getItem(GAP_DAYS_KEY), 10);
    if (!isNaN(v) && v >= 1 && v <= 30) return v;
  } catch (e) {}
  return GAP_DAYS_DEFAULT;
}
function saveGapDays(v) {
  try { localStorage.setItem(GAP_DAYS_KEY, String(v)); } catch (e) {}
}

/* ===== 风控率提醒设置(最新一天话术风控拦截率阈值%, 超过则提醒) ===== */
const RISK_THRESH_KEY = "csa-risk-threshold";
const RISK_THRESH_DEFAULT = 25;
function riskThreshold() {
  try {
    const v = parseFloat(localStorage.getItem(RISK_THRESH_KEY));
    if (!isNaN(v) && v >= 1 && v <= 100) return v;
  } catch (e) {}
  return RISK_THRESH_DEFAULT;
}
function saveRiskThreshold(v) {
  try { localStorage.setItem(RISK_THRESH_KEY, String(v)); } catch (e) {}
}

/* ===== 昨日大幅下降设置(下跌阈值%) ===== */
const DOWN_THRESH_KEY = "csa-down-threshold";
const DOWN_THRESH_DEFAULT = 20;
function downThreshold() {
  try {
    const v = parseInt(localStorage.getItem(DOWN_THRESH_KEY), 10);
    if (!isNaN(v) && v >= 5 && v <= 50) return v;
  } catch (e) {}
  return DOWN_THRESH_DEFAULT;
}
function saveDownThreshold(v) {
  try { localStorage.setItem(DOWN_THRESH_KEY, String(v)); } catch (e) {}
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ===== 达标提醒口径: day=当月日均(逐日算术平均) / month=本月累计(探域计数÷总事件数) ===== */
const STD_CALIBER_KEY = "csa-std-caliber";
function stdCaliber() {
  try { const v = localStorage.getItem(STD_CALIBER_KEY); if (v === "month" || v === "day") return v; } catch (e) {}
  return "day";
}
function saveStdCaliber(v) { try { localStorage.setItem(STD_CALIBER_KEY, v); } catch (e) {} }
// 月度库字段名与日字段名不同(探域月度抓取脚本写入 __library__.monthly)
const MONTHLY_FIELD = { adoptionRate: "adoptRate", generationRate: "genRate", riskRate: "riskRate", pureAgentRatio: "pureRatio" };
function monthlyLib(monthPrefix) {
  const m = (cloudDays && cloudDays.__library__ && cloudDays.__library__.monthly) || {};
  return m[monthPrefix] || null;
}
function monthCumVal(monthPrefix, shopId, metric) {
  const lib = monthlyLib(monthPrefix);
  if (!lib) return null;
  const rec = lib[shopId];
  if (!rec) return null;
  const v = rec[MONTHLY_FIELD[metric]];
  const n = Number(v);
  return (v === undefined || v === null || v === "" || isNaN(n)) ? null : n;
}

function renderStdNotice() {
  const bar = document.querySelector("#stdNoticeBar");
  if (!bar) return;
  const wasOpen = bar.classList.contains("open");
  const t = thresholdSettings();
  const caliber = stdCaliber();
  const latest = cloudLatestDate;
  const monthPrefix = latest ? latest.slice(0, 7) : null;
  const hasMonthData = !!(monthPrefix && monthlyLib(monthPrefix));
  const items = [];
  if (latest) {
    cloudShops.forEach((shop) => {
      const lows = [];
      THRESH_FIELDS.forEach((f) => {
        const std = t[f.key];
        if (std === undefined || std === null || std === "") return;
        const v = caliber === "month"
          ? monthCumVal(monthPrefix, shop.id, f.key)
          : monthAvgVal(cloudDays, monthPrefix, shop.id, f.key);
        if (v !== null && v < std) lows.push({ label: f.label, value: v, std: std });
      });
      if (lows.length) items.push({ name: shop.name, lows: lows });
    });
  }
  const lm = latest ? parseInt(latest.slice(5, 7), 10) : null;
  const ok = !items.length;
  const caliberName = caliber === "month" ? "累计" : "均值";
  bar.hidden = false;
  bar.className = "notice-bar std-notice-bar";
  if (wasOpen) bar.classList.add("open");
  bar.innerHTML = `
    <button class="notice-head" type="button" aria-expanded="${wasOpen}">
      <span class="notice-title">${ok ? "✓" : "⚠"} 数据达标提醒${lm ? "（" + lm + "月" + caliberName + "）" : ""}</span>
      <span class="notice-count">${ok ? (latest ? "全部达标" : "暂无数据") : items.length + " 家未达标"}</span>
      <svg class="notice-chevron"><use href="#i-chevron"/></svg>
    </button>
    <div class="notice-body">
      <div class="notice-caliber" role="group" aria-label="判断口径">
        <button type="button" class="caliber-btn${caliber === "day" ? " active" : ""}" id="stdCaliberDay">当月日均</button>
        <button type="button" class="caliber-btn${caliber === "month" ? " active" : ""}" id="stdCaliberMonth">本月累计</button>
        <span class="caliber-hint">${caliber === "month" ? "探域计数÷总事件数" : "逐日算术平均"}</span>
      </div>
      ${caliber === "month" && !hasMonthData ? `<div class="notice-ok">⚠ 本月累计数据未同步 — 请在本机运行 tanyu-monthly-fetch.js 后重试</div>` : ""}
      ${ok
        ? `<div class="notice-ok">${latest ? "所有店铺数据均达到标准 ✓" : "暂无店铺数据，请先同步"}</div>`
        : items.map((it) => `<button class="notice-shop" type="button" data-shop="${esc(it.name)}"><span class="notice-shop-name">${esc(it.name)}</span><span class="notice-tags">${it.lows.map((l) => `<em class="notice-tag">${l.label} ${(+l.value).toFixed(1)}%（标准 ≥${l.std}%）</em>`).join("")}</span></button>`).join("")}
      <button class="notice-action" type="button" id="stdSetBtn">⚙ 设置达标标准</button>
    </div>`;
}

function editStdThresholds() {
  const t = thresholdSettings();
  const body = document.createElement("div");
  body.className = "std-modal-body";
  THRESH_FIELDS.forEach((f) => {
    const row = document.createElement("label");
    row.className = "std-modal-row";
    row.innerHTML = `<span>${f.label}（${f.unit}）</span>`;
    const input = document.createElement("input");
    input.type = "number";
    input.min = 0;
    input.max = 100;
    input.step = 1;
    input.value = t[f.key] ?? "";
    input.setAttribute("data-thresh-key", f.key);
    row.appendChild(input);
    body.appendChild(row);
  });
  const hint = document.createElement("div");
  hint.className = "std-modal-hint";
  hint.textContent = "低于设定标准的店铺将显示在「数据达标提醒」中（按当月均值判断）";
  body.appendChild(hint);

  const overlay = document.createElement("div");
  overlay.className = "std-modal-overlay";
  const box = document.createElement("div");
  box.className = "std-modal";
  const head = document.createElement("div");
  head.className = "std-modal-head";
  head.innerHTML = "<strong>达标标准设置</strong><button type='button' class='std-modal-close'>×</button>";
  const foot = document.createElement("div");
  foot.className = "std-modal-foot";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "std-modal-save";
  saveBtn.textContent = "保存";
  foot.appendChild(cancelBtn);
  foot.appendChild(saveBtn);
  box.appendChild(head);
  box.appendChild(body);
  box.appendChild(foot);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));

  const close = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 200); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  head.querySelector(".std-modal-close").addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", () => {
    const nt = {};
    THRESH_FIELDS.forEach((f) => {
      const el = body.querySelector(`[data-thresh-key="${f.key}"]`);
      const v = el ? parseFloat(el.value) : NaN;
      nt[f.key] = isNaN(v) ? "" : v;
    });
    saveThresholds(nt);
    close();
    renderStdNotice();
    showToast("达标标准已保存");
  });
}

/* ===== 日期工具（以今日为基准，与老工作台逻辑一致） ===== */
function todayKeyStr() {
  const n = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}
function toKeyStr(d) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function yesterdayKeyOf(key) {
  const parts = key.split("-").map(Number);
  return toKeyStr(new Date(parts[0], parts[1] - 1, parts[2] - 1));
}

/* ===== 数据缺口提醒（最近 7 天 4 项核心指标缺失） ===== */
function renderGapNotice() {
  const bar = document.querySelector("#gapNoticeBar");
  if (!bar) return;
  const days = gapDays();
  const today = todayKeyStr();
  const start = new Date(today);
  start.setDate(start.getDate() - 1); // 从昨天开始往前 N 天（今天未结束不算缺）
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    dates.push(toKeyStr(d));
  }
  const fields = [
    { key: "adoptionRate", label: "采纳率" },
    { key: "generationRate", label: "生成率" },
    { key: "conversionRate", label: "转化率" },
    { key: "pureAgentRatio", label: "纯智能体占比" }
  ];
  const items = [];
  cloudShops.forEach((shop) => {
    const gaps = [];
    dates.forEach((dt) => {
      fields.forEach((f) => {
        const sd = cloudDays[dt] && cloudDays[dt].shopData && cloudDays[dt].shopData[shop.id];
        if (metricVal(sd, f.key) === null) gaps.push(dt.slice(8) + "日缺" + f.label);
      });
    });
    if (gaps.length) items.push({ name: shop.name, gaps: gaps });
  });
  bar.hidden = false;
  const ok = !items.length;
  bar.className = "notice-bar gap-notice-bar";
  bar.innerHTML = `
    <button class="notice-head" type="button" aria-expanded="false">
      <span class="notice-title">${ok ? "✓" : "⚠"} 数据缺口检查（最近 ${days} 天）</span>
      <span class="notice-count">${ok ? "数据完整" : items.length + " 家缺数据"}</span>
      <svg class="notice-chevron"><use href="#i-chevron"/></svg>
    </button>
    <div class="notice-body">
      ${ok
        ? `<div class="notice-ok">最近 ${days} 天所有店铺数据完整 ✓</div>`
        : items.map((it) => `<button class="notice-shop" type="button" data-shop="${esc(it.name)}"><span class="notice-shop-name">${esc(it.name)}</span><span class="notice-tags">${it.gaps.map((g) => `<em class="notice-tag">${g}</em>`).join("")}</span></button>`).join("")}
      <button class="notice-action" type="button" id="gapSetBtn">⚙ 设置检查天数</button>
    </div>`;
}

/* ===== 昨日下降通知（较前日 4 项指标下降 ≥10 个百分点） ===== */
function renderDownNotice() {
  const bar = document.querySelector("#downNoticeBar");
  if (!bar) return;
  const today = todayKeyStr();
  const yKey = yesterdayKeyOf(today);
  const pKey = yesterdayKeyOf(yKey);
  const metrics = [
    { key: "adoptionRate", label: "采纳率" },
    { key: "generationRate", label: "生成率" },
    { key: "conversionRate", label: "转化率" },
    { key: "pureAgentRatio", label: "纯智能体占比" }
  ];
  const items = [];
  const thresh = downThreshold();
  cloudShops.forEach((shop) => {
    const downs = [];
    metrics.forEach((m) => {
      const sdY = cloudDays[yKey] && cloudDays[yKey].shopData && cloudDays[yKey].shopData[shop.id];
      const sdP = cloudDays[pKey] && cloudDays[pKey].shopData && cloudDays[pKey].shopData[shop.id];
      const latest = metricVal(sdY, m.key);
      const prev = metricVal(sdP, m.key);
      if (latest !== null && prev !== null) {
        const diff = Math.round((latest - prev) * 100) / 100;
        if (diff <= -thresh) downs.push({ label: m.label, diff: Math.abs(diff) });
      }
    });
    if (downs.length) items.push({ name: shop.name, downs: downs });
  });
  bar.hidden = false;
  const ok = !items.length;
  bar.className = "notice-bar down-notice-bar";
  bar.innerHTML = `
    <button class="notice-head" type="button" aria-expanded="false">
      <span class="notice-title">${ok ? "✓" : "⚠"} 昨日大幅下降（较前日 ↓≥${thresh}%）</span>
      <span class="notice-count">${ok ? "无大幅下降" : items.length + " 家下跌"}</span>
      <svg class="notice-chevron"><use href="#i-chevron"/></svg>
    </button>
    <div class="notice-body">
      ${ok
        ? `<div class="notice-ok">昨日无指标下降 ≥${thresh}% 的店铺 ✓</div>`
        : items.map((it) => `<button class="notice-shop" type="button" data-shop="${esc(it.name)}"><span class="notice-shop-name">${esc(it.name)}</span><span class="notice-tags">${it.downs.map((m) => `<em class="notice-tag">${m.label}↓${m.diff}%</em>`).join("")}</span></button>`).join("")}
      <button class="notice-action" type="button" id="downSetBtn">⚙ 设置下跌阈值</button>
    </div>`;
}

/* ===== 缺口检查设置弹窗(检查天数) ===== */
function editGapDays() {
  const cur = gapDays();
  const overlay = document.createElement("div");
  overlay.className = "std-modal-overlay";
  const box = document.createElement("div");
  box.className = "std-modal";
  box.style.width = "320px";
  const head = document.createElement("div");
  head.className = "std-modal-head";
  head.innerHTML = "<strong>缺口检查天数设置</strong><button type='button' class='std-modal-close'>×</button>";
  const body = document.createElement("div");
  body.className = "std-modal-body";
  const row = document.createElement("label");
  row.className = "std-modal-row";
  row.innerHTML = "<span>检查天数（1-30）</span>";
  const input = document.createElement("input");
  input.type = "number";
  input.min = 1;
  input.max = 30;
  input.step = 1;
  input.value = cur;
  row.appendChild(input);
  body.appendChild(row);
  const hint = document.createElement("div");
  hint.className = "std-modal-hint";
  hint.textContent = "「数据缺口检查」将扫描最近 N 天各店铺四项指标缺失情况（今天未结束不算缺）";
  body.appendChild(hint);
  const foot = document.createElement("div");
  foot.className = "std-modal-foot";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "std-modal-save";
  saveBtn.textContent = "保存";
  foot.appendChild(cancelBtn);
  foot.appendChild(saveBtn);
  box.appendChild(head);
  box.appendChild(body);
  box.appendChild(foot);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
  const close = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 200); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  head.querySelector(".std-modal-close").addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", () => {
    const v = parseInt(input.value, 10);
    saveGapDays(isNaN(v) ? GAP_DAYS_DEFAULT : Math.max(1, Math.min(30, v)));
    close();
    renderGapNotice();
    showToast("缺口检查天数已保存");
  });
}

/* ===== 昨日大幅下降设置弹窗(下跌阈值%) ===== */
function editDownThreshold() {
  const cur = downThreshold();
  const overlay = document.createElement("div");
  overlay.className = "std-modal-overlay";
  const box = document.createElement("div");
  box.className = "std-modal";
  box.style.width = "320px";
  const head = document.createElement("div");
  head.className = "std-modal-head";
  head.innerHTML = "<strong>大幅下降阈值设置</strong><button type='button' class='std-modal-close'>×</button>";
  const body = document.createElement("div");
  body.className = "std-modal-body";
  const row = document.createElement("label");
  row.className = "std-modal-row";
  row.innerHTML = "<span>下跌阈值（5%-50%）</span>";
  const input = document.createElement("input");
  input.type = "number";
  input.min = 5;
  input.max = 50;
  input.step = 1;
  input.value = cur;
  row.appendChild(input);
  body.appendChild(row);
  const hint = document.createElement("div");
  hint.className = "std-modal-hint";
  hint.textContent = "「昨日大幅下降」将标记较前日下跌 ≥ 该百分点的指标（4 项指标逐一判断）";
  body.appendChild(hint);
  const foot = document.createElement("div");
  foot.className = "std-modal-foot";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "std-modal-save";
  saveBtn.textContent = "保存";
  foot.appendChild(cancelBtn);
  foot.appendChild(saveBtn);
  box.appendChild(head);
  box.appendChild(body);
  box.appendChild(foot);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
  const close = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 200); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  head.querySelector(".std-modal-close").addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", () => {
    const v = parseInt(input.value, 10);
    saveDownThreshold(isNaN(v) ? DOWN_THRESH_DEFAULT : Math.max(5, Math.min(50, v)));
    close();
    renderDownNotice();
    showToast("下跌阈值已保存");
  });
}

/* ===== 风控率提醒（最新一天话术风控拦截率 > 阈值, 越低越好） ===== */
function renderRiskNotice() {
  const bar = document.querySelector("#riskNoticeBar");
  if (!bar) return;
  const thresh = riskThreshold();
  const latest = cloudLatestDate;
  const items = [];
  if (latest) {
    cloudShops.forEach((shop) => {
      const sd = cloudDays[latest] && cloudDays[latest].shopData && cloudDays[latest].shopData[shop.id];
      const v = metricVal(sd, "riskRate");
      if (v !== null && v > thresh) items.push({ name: shop.name, risk: v });
    });
  }
  items.sort((a, b) => b.risk - a.risk);
  bar.hidden = false;
  const ok = !items.length;
  bar.className = "notice-bar risk-notice-bar";
  bar.innerHTML = `
    <button class="notice-head" type="button" aria-expanded="false">
      <span class="notice-title">${ok ? "✓" : "⚠"} 风控率提醒${latest ? "（" + latest.slice(5).replace("-", "月") + "日）" : ""}</span>
      <span class="notice-count">${ok ? (latest ? "全部正常" : "暂无数据") : items.length + " 家偏高"}</span>
      <svg class="notice-chevron"><use href="#i-chevron"/></svg>
    </button>
    <div class="notice-body">
      ${ok
        ? `<div class="notice-ok">${latest ? `风控率均未超过阈值 ${thresh}% ✓` : "暂无店铺数据，请先同步"}</div>`
        : items.map((it) => `<button class="notice-shop" type="button" data-shop="${esc(it.name)}"><span class="notice-shop-name">${esc(it.name)}</span><span class="notice-tags"><em class="notice-tag">风控率 ${it.risk}%（标准 ≤${thresh}%）</em></span></button>`).join("")}
      <button class="notice-action" type="button" id="riskSetBtn">⚙ 设置风控阈值</button>
    </div>`;
}

/* ===== 风控率提醒设置弹窗(阈值%) ===== */
function editRiskThreshold() {
  const cur = riskThreshold();
  const overlay = document.createElement("div");
  overlay.className = "std-modal-overlay";
  const box = document.createElement("div");
  box.className = "std-modal";
  box.style.width = "320px";
  const head = document.createElement("div");
  head.className = "std-modal-head";
  head.innerHTML = "<strong>风控率阈值设置</strong><button type='button' class='std-modal-close'>×</button>";
  const body = document.createElement("div");
  body.className = "std-modal-body";
  const row = document.createElement("label");
  row.className = "std-modal-row";
  row.innerHTML = "<span>风控率阈值（1%-100%）</span>";
  const input = document.createElement("input");
  input.type = "number";
  input.min = 1;
  input.max = 100;
  input.step = 1;
  input.value = cur;
  row.appendChild(input);
  body.appendChild(row);
  const hint = document.createElement("div");
  hint.className = "std-modal-hint";
  hint.textContent = "「风控率提醒」将标记最新一天话术风控拦截率超过该阈值的店铺（风控率越低越好）";
  body.appendChild(hint);
  const foot = document.createElement("div");
  foot.className = "std-modal-foot";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.textContent = "取消";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "std-modal-save";
  saveBtn.textContent = "保存";
  foot.appendChild(cancelBtn);
  foot.appendChild(saveBtn);
  box.appendChild(head);
  box.appendChild(body);
  box.appendChild(foot);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("open"));
  const close = () => { overlay.classList.remove("open"); setTimeout(() => overlay.remove(), 200); };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  head.querySelector(".std-modal-close").addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  saveBtn.addEventListener("click", () => {
    const v = parseFloat(input.value);
    saveRiskThreshold(isNaN(v) ? RISK_THRESH_DEFAULT : Math.max(1, Math.min(100, v)));
    close();
    renderRiskNotice();
    showToast("风控率阈值已保存");
  });
}

function renderCards() {
  const m = currentMetric();
  scene.innerHTML = documents.map((doc, index) => {
    const v = doc.metrics[m.doc];
    const display = v === null ? "--" : v;
    const kicker = doc.title.slice(0, 4) + " · " + m.label + " " + display + m.unit;
    return `
    <button class="doc-card ${doc.accent} tone-${doc.tone || "green"}" data-index="${index}" aria-label="打开${doc.title} ${m.label}${display}${m.unit}">
      <span class="paper-shine"></span>
      <span class="doc-kicker">${kicker}</span>
      <span class="doc-lines"><i></i><i></i><i></i><i></i><i></i></span>
      <span class="doc-symbol">${index === 2 ? "!" : index === 0 ? "⌘" : index === 3 ? "↑" : "·"}</span>
      <span class="doc-copy"><strong>${doc.title}</strong><small>${m.label} ${display}${m.unit} · 体验 ${doc.metrics.exp === null ? "--" : doc.metrics.exp}</small></span>
    </button>`;
  }).join("");
  scene.querySelectorAll(".doc-card").forEach((card) => card.addEventListener("click", () => { selectCard(Number(card.dataset.index), true); dismissScrollTip(); }));
  if (rankMode) renderRankTable();
}

function viewOnDate(dateKey) {
  if (!dateKey || !cloudDays || !cloudDays[dateKey]) {
    showToast(`${dateKey} 无数据`);
    document.querySelectorAll("#timelineDates button").forEach((b) => b.classList.toggle("active", parseInt(b.dataset.dayIndex, 10) === parseInt(dateKey.slice(8), 10)));
    return;
  }
  currentViewDate = dateKey;
  documents = buildDocuments(cloudShops, cloudDays, dateKey);
  groups = buildGroups(documents);
  updateMetricCards(documents);
  renderStdNotice();
  renderGapNotice();
  renderDownNotice();
  renderRiskNotice();
  selectedIndex = 0; visualPosition = 0; targetPosition = 0;
  if (!documents.length) {
    renderCards(); renderQueue();
    showToast(`${dateKey} 无店铺数据`);
  } else {
    selectMetricCard(0, { syncDrawer: false });
    updateCardPositions(0);
    updateDetails(documents[0]);
    renderCards();
    renderQueue();
  }
  document.querySelectorAll("#timelineDates button").forEach((b) => b.classList.toggle("active", parseInt(b.dataset.dayIndex, 10) === parseInt(dateKey.slice(8), 10)));
  // 月度汇总也同步切到该月
  const m = dateKey.match(/^(\d{4})-(\d{2})/);
  if (m && (monthlyYear !== parseInt(m[1], 10) || monthlyMonth !== parseInt(m[2], 10) - 1)) {
    monthlyYear = parseInt(m[1], 10);
    monthlyMonth = parseInt(m[2], 10) - 1;
    renderMonthlyTable();
  }
}

function renderTimeline() {
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const base = cloudLatestDate || todayStr;
  const year = parseInt(base.slice(0, 4), 10);
  const month = parseInt(base.slice(5, 7), 10);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthEl = document.querySelector("#timelineMonth");
  if (monthEl) monthEl.innerHTML = `<svg><use href="#i-calendar"/></svg> ${year}年${month}月`;
  const days = [];
  for (let i = 1; i <= daysInMonth; i++) days.push(String(i).padStart(2, "0"));
  const prefix = base.slice(0, 7);
  const hasData = new Set();
  if (cloudDays) {
    Object.keys(cloudDays).forEach((k) => {
      const m = k.match(/^\d{4}-\d{2}-(\d{2})$/);
      if (m && k.slice(0, 7) === prefix) hasData.add(parseInt(m[1], 10));
    });
  }
  const latestDay = cloudLatestDate ? parseInt(cloudLatestDate.slice(8), 10) : 0;
  timelineDates.style.setProperty("--tl-cols", daysInMonth);
  timelineDates.innerHTML = days.map((day) => {
    const n = parseInt(day, 10);
    const cls = hasData.has(n) ? "active" : "";
    const mark = n === latestDay ? `<i>${n}</i>` : "";
    // 2026-10-26：偶数日数字单独标注，窄屏下弱化 → 形成主次刻度，避免 31 个数字挤成一片
    return `<button data-day-index="${n}" class="${cls}" title="${prefix}-${day}">${mark}<span class="tl-d${n % 2 === 0 ? " tl-d-alt" : ""}">${day}</span></button>`;
  }).join("");
  applyTimelineDensity();
  timelineDates.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    const day = String(button.dataset.dayIndex).padStart(2, "0");
    const ym = (currentViewDate || cloudLatestDate || todayKeyStr()).slice(0, 7);
    viewOnDate(`${ym}-${day}`);
  }));
}

/* 时间轴密度：单列可用宽度 < 25px 时启用「主次刻度」（偶数日数字弱化） */
function applyTimelineDensity() {
  if (!timelineDates) return;
  const btns = timelineDates.querySelectorAll("button");
  if (!btns.length) return;
  const per = timelineDates.clientWidth / btns.length;
  timelineDates.classList.toggle("tl-dense", per > 0 && per < 14);
}

let tlResizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(tlResizeTimer);
  tlResizeTimer = setTimeout(applyTimelineDensity, 120);
});

function modulo(value, length = documents.length) {
  return ((value % length) + length) % length;
}

function relativePosition(index, position = visualPosition) {
  let delta = index - modulo(position);
  const half = documents.length / 2;
  if (delta > half) delta -= documents.length;
  if (delta < -half) delta += documents.length;
  return delta;
}

function updateCardPositions(position = visualPosition) {
  scene.querySelectorAll(".doc-card").forEach((card) => {
    const cardIndex = Number(card.dataset.index);
    const delta = relativePosition(cardIndex, position);
    const absolute = Math.abs(delta);
    const fanView = viewMode === "fan";
    const x = fanView ? -12 + delta * 46 : 85 + Math.sin(delta * .6) * 270;
    const z = fanView ? (absolute < .08 ? 105 : 58 - Math.min(absolute, 4.5) * 7) : 80 - Math.min(absolute, 2.5) * 70;
    const y = fanView ? 2 + Math.min(absolute, 4.5) * 2.5 : Math.min(absolute, 2.5) * 7;
    const rotation = fanView
      ? (absolute < .08 ? -34 : -Math.min(64, 56 + absolute * 1.8))
      : -Math.sign(delta) * Math.min(22, absolute * 11);
    const scale = fanView ? (absolute < .08 ? 1.02 : Math.max(.88, .98 - absolute * .018)) : Math.max(.72, 1.02 - absolute * .12);
    card.style.setProperty("--x", `${x}px`);
    card.style.setProperty("--y", `${y}px`);
    card.style.setProperty("--z", `${z}px`);
    card.style.setProperty("--rotate", `${rotation}deg`);
    card.style.setProperty("--scale", scale);
    const depthOpacity = fanView ? Math.max(.52, 1 - absolute * .105) : Math.max(.46, 1 - absolute * .22);
    const wrapFade = fanView ? (absolute > 3.8 ? Math.max(.46, 1 - (absolute - 3.8) * .7) : 1) : (absolute > 2.15 ? Math.max(0, (2.5 - absolute) / .35) : 1);
    const cardOpacity = depthOpacity * wrapFade;
    card.style.setProperty("--opacity", cardOpacity);
    card.style.setProperty("--card-delay", "0ms");
    card.style.zIndex = String(fanView && absolute < .08 ? 90 : Math.round(fanView ? 58 + delta * 2 : 30 - absolute * 8));
    card.style.pointerEvents = cardOpacity < .08 ? "none" : "auto";
    card.tabIndex = cardOpacity < .08 ? -1 : 0;
    card.classList.toggle("selected", cardIndex === selectedIndex);
    card.setAttribute("aria-current", cardIndex === selectedIndex ? "true" : "false");
  });
}

function setViewMode(mode) {
  viewMode = mode === "fan" ? "fan" : "orbit";
  const fanView = viewMode === "fan";
  viewport.classList.toggle("fan-view", fanView);
  viewport.classList.add("view-switching");
  orbitModeBtn.classList.toggle("active", !fanView);
  orbitModeBtn.classList.toggle("quiet", fanView);
  orbitModeBtn.setAttribute("aria-pressed", String(!fanView));
  fanModeBtn.classList.toggle("active", fanView);
  fanModeBtn.classList.toggle("quiet", !fanView);
  fanModeBtn.setAttribute("aria-pressed", String(fanView));
  viewport.setAttribute("aria-label", fanView ? "可滚轮切换的侧向层叠店铺卡片" : "可滚轮切换的店铺卡片");
  document.querySelector(".scroll-tip p").textContent = fanView ? "滚动浏览层叠 · 点击看详情" : "滚动切换店铺 · 点击看详情";
  updateCardPositions(visualPosition);
  window.setTimeout(() => viewport.classList.remove("view-switching"), 760);
}

/* ============================================================
   全店排行（2026-10-26）
   3D 卡片一次只能看 1 家店；补一张「一眼看完 20 家」的排行表，
   沿用顶部 4 张指标卡当前选中的指标，点击行 = 选中该店（右侧详情同步）。
   ============================================================ */
let rankMode = false;
const RANK_STORE = "csa-rank-mode";
const COLS_META = { adopt: "采纳率", gen: "生成率", conv: "转化率", pure: "纯智", reply: "3分钟", exp: "体验分", risk: "风控率" };

function setRankMode(on, opts) {
  const persist = !opts || opts.persist !== false;
  rankMode = !!on;
  if (carouselPanelEl) carouselPanelEl.classList.toggle("rank-mode", rankMode);
  if (rankViewEl) rankViewEl.hidden = !rankMode;
  if (rankModeBtn) {
    rankModeBtn.classList.toggle("active", rankMode);
    rankModeBtn.classList.toggle("quiet", !rankMode);
    rankModeBtn.setAttribute("aria-pressed", String(rankMode));
  }
  if (rankMode) {
    if (isPlaying) setPlaying(false);
    renderRankTable();
  } else if (typeof updateCardPositions === "function") {
    updateCardPositions(visualPosition);
  }
  if (persist) { try { localStorage.setItem(RANK_STORE, rankMode ? "1" : "0"); } catch (e) { } }
}

function renderRankTable() {
  if (!rankMode || !rankViewEl) return;
  const COLS = metricSlots.slice();
  const m = currentMetric();
  const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
  const fmt = (v) => v === null ? "--" : (Math.round(v * 100) / 100).toFixed(2);
  const rows = documents.map((doc, i) => ({ doc: doc, i: i })).sort((a, b) => {
    const av = num(a.doc.metrics[m.doc]), bv = num(b.doc.metrics[m.doc]);
    if (av === null && bv === null) return a.i - b.i;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });
  const vals = rows.map((r) => num(r.doc.metrics[m.doc])).filter((v) => v !== null);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const cfg = MC_TARGETS[m.doc] || {};
  const okOf = (v) => {
    if (v === null || cfg.target === null || cfg.target === undefined) return null;
    return cfg.dir === "lte" ? v <= cfg.target : v >= cfg.target;
  };
  const okCount = vals.filter((v) => okOf(v) === true).length;

  const head = `<div class="rk-sum">
      <b>${m.label}排行</b>
      <span>${documents.length} 家 · 达标 <i class="${okCount ? "is-ok" : "is-bad"}">${okCount}</i> 家 · 均值 <em>${fmt(avg)}%</em>${cfg.target !== null && cfg.target !== undefined ? " · 目标 " + (cfg.dir === "lte" ? "≤" : "≥") + cfg.target + "%" : ""}</span>
    </div>
    <div class="rk-head">
      <span class="rk-idx">#</span>
      <span class="rk-name">店铺</span>
      ${COLS.map((k) => `<span class="rk-num${k === m.doc ? " is-active" : ""}">${COLS_META[k]}</span>`).join("")}
    </div>`;

  const body = rows.length ? rows.map((r, pos) => {
    const dv = num(r.doc.metrics[m.doc]);
    const ok = okOf(dv);
    const fill = dv === null ? 0 : Math.max(0, Math.min(100, dv));
    return `<button type="button" class="rk-row${r.i === selectedIndex ? " is-selected" : ""}${ok === false ? " is-miss" : ""}" data-idx="${r.i}">
      <span class="rk-idx">${pos + 1}</span>
      <span class="rk-name" title="${r.doc.title}">${r.doc.folder === "重点店" ? '<b class="rk-key">重点</b>' : ""}<i class="rk-txt">${r.doc.title}</i></span>
      ${COLS.map((k) => {
        const v = num(r.doc.metrics[k]);
        const kc = MC_TARGETS[k] || {};
        const st = (v !== null && kc.target !== null && kc.target !== undefined)
          ? (kc.dir === "lte" ? (v <= kc.target ? " is-ok" : " is-bad") : (v >= kc.target ? " is-ok" : " is-bad")) : "";
        const isCur = k === m.doc;
        return `<span class="rk-num${st}${isCur ? " is-active" : ""}"${isCur ? ' style="--fill:' + fill + '%"' : ""}>${fmt(v)}</span>`;
      }).join("")}
    </button>`;
  }).join("") : `<div class="rk-empty">当日无店铺数据</div>`;

  rankViewEl.innerHTML = head + `<div class="rk-body">${body}</div>`;
  rankViewEl.querySelectorAll(".rk-row").forEach((row) => {
    row.addEventListener("click", () => {
      const i = Number(row.dataset.idx);
      if (!documents[i]) return;
      selectCard(i, true);
      renderRankTable();
    });
  });
}

function startCarouselAnimation() {
  if (carouselFrame !== null) return;
  viewport.classList.add("continuous-motion");
  lastFrameTime = performance.now();

  const tick = (now) => {
    const elapsed = Math.min(32, now - lastFrameTime);
    lastFrameTime = now;
    const distance = targetPosition - visualPosition;
    const smoothing = 1 - Math.exp(-elapsed / 170);
    visualPosition += distance * smoothing;
    const visualIndex = modulo(Math.round(visualPosition));
    if (visualIndex !== selectedIndex) {
      selectedIndex = visualIndex;
      const direction = Math.sign(targetPosition - visualPosition) || lastWheelDirection;
      if (direction) kickScene(direction);
      updateDetails(documents[selectedIndex]);
    }
    updateCardPositions(visualPosition);

    if (Math.abs(distance) < .006) {
      visualPosition = targetPosition;
      updateCardPositions(visualPosition);
      carouselFrame = null;
      viewport.classList.remove("continuous-motion");
      return;
    }
    carouselFrame = requestAnimationFrame(tick);
  };

  carouselFrame = requestAnimationFrame(tick);
}

function kickScene(direction) {
  const motionClass = direction < 0 ? "moving-backward" : "moving-forward";
  viewport.classList.remove("moving-forward", "moving-backward");
  void viewport.offsetWidth;
  viewport.classList.add(motionClass);
  window.clearTimeout(motionTimer);
  motionTimer = window.setTimeout(() => viewport.classList.remove(motionClass), 880);
}

function updateDetails(doc) {
  const m = doc.metrics || {};
  const fmt = (v, suffix) => (v === null || v === undefined ? "--" : String(v) + (suffix || ""));
  const cur = currentMetric();
  // completion 卡片：跟随当前指标
  const curVal = m[cur.doc];
  const labelEl = document.querySelector("#completionLabel");
  const smallEl = document.querySelector("#completionSmall");
  if (labelEl) labelEl.textContent = cur.label;
  if (smallEl) smallEl.textContent = "当前店铺" + cur.label;
  document.querySelector("#completionValue").textContent = fmt(curVal, cur.unit);
  const tipTitle = document.querySelector("#tipTitle");
  if (tipTitle) {
    // 2026-10-27：拆成「指标名(accent) · 店铺名(浅色)」两段，长店名由 CSS 省略号收口，
    // 避免整段同色粗体糊成一根白柱抢视线。
    const emEl = document.createElement("em");
    emEl.textContent = cur.label;
    const spEl = document.createElement("span");
    spEl.textContent = doc.title || "";
    tipTitle.replaceChildren(emEl, document.createTextNode(" · "), spEl);
  }
  const completionBar = document.querySelector(".completion-card i b");
  if (completionBar) completionBar.style.width = `${curVal === null || curVal === undefined ? 0 : Math.min(100, curVal)}%`;
  // 详情字段
  document.querySelector("#detailId").textContent = doc.id;
  document.querySelector("#detailTitle").textContent = doc.detailTitle || doc.title;
  document.querySelector("#detailStatus").textContent = doc.status;
  document.querySelector("#detailDescription").textContent = doc.description;
  document.querySelector("#detailFolder").textContent = doc.folder;
  document.querySelector("#detailDate").textContent = doc.date;
  document.querySelector("#detailState").textContent = fmt(m.adopt, "%");
  document.querySelector("#detailPriority").textContent = fmt(m.exp);
  document.querySelector("#detailTags").innerHTML = doc.tags.map((tag) => `<span>${tag}</span>`).join("");
  // 指标明细：当前指标置顶+高亮（sort 把 isCur=true 排前面）；风控率固定追加在末尾
  const ordered = slotMetrics().map((k) => {
    const v = m[k.doc];
    return { k, v, line: `${k.label} ${fmt(v, k.unit)}`, isCur: k === cur };
  }).sort((a, b) => (a.isCur ? -1 : 0) - (b.isCur ? -1 : 0));
  document.querySelector("#detailAdvice").innerHTML = ordered.map((a) => `<li class="${a.isCur ? "current-metric" : ""}">${a.isCur ? "★ " : ""}${a.line}</li>`).join("") +
    `<li>风控率 ${fmt(m.risk, "%")}</li>`;
  progress.style.width = `${25 + selectedIndex * (56 / Math.max(1, documents.length - 1))}%`;
  detailsContent.classList.remove("detail-refresh");
  void detailsContent.offsetWidth;
  detailsContent.classList.add("detail-refresh");
  window.clearTimeout(detailAnimationTimer);
  detailAnimationTimer = window.setTimeout(() => detailsContent.classList.remove("detail-refresh"), 620);
}

function commitCarouselTarget(position, explicit = false, requestedDirection = 0) {
  targetPosition = position;
  lastWheelDirection = requestedDirection || Math.sign(targetPosition - visualPosition) || lastWheelDirection;
  startCarouselAnimation();
  if (explicit && isPlaying) restartAutoplay();
}

function selectCard(index, explicit = false, requestedDirection = 0) {
  const normalizedIndex = modulo(index);
  const delta = requestedDirection || relativePosition(normalizedIndex, visualPosition);
  if (Math.abs(delta) < .001) {
    selectedIndex = normalizedIndex;
    visualPosition = normalizedIndex;
    targetPosition = normalizedIndex;
    updateCardPositions(visualPosition);
    updateDetails(documents[selectedIndex]);
    if (explicit) updateMetricCards(documents, selectedIndex); // 用户操作时顶部卡同步切换到该店
    return;
  }
  commitCarouselTarget(visualPosition + delta, explicit, Math.sign(delta));
  if (explicit) updateMetricCards(documents, normalizedIndex); // 用户操作(键盘/拖动)切换顶部卡
}

function nextCard(direction = 1) {
  commitCarouselTarget(Math.round(targetPosition) + direction, false, direction);
}

function restartAutoplay() {
  if (autoplayTimer) cancelAnimationFrame(autoplayTimer);
  autoplayTimer = null;
  if (!isPlaying || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  autoplayLastFrame = performance.now();
  const advance = (now) => {
    const elapsed = Math.min(34, now - autoplayLastFrame);
    autoplayLastFrame = now;
    targetPosition -= elapsed * .00018 * speed;
    lastWheelDirection = -1;
    startCarouselAnimation();
    autoplayTimer = requestAnimationFrame(advance);
  };
  autoplayTimer = requestAnimationFrame(advance);
}

function setPlaying(value) {
  isPlaying = value;
  playToggle.classList.toggle("playing", value);
  playToggle.classList.toggle("active", value);
  playLabel.textContent = value ? "自动播放中" : "自动播放";
  restartAutoplay();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function resolveTheme(preference = themePreference) {
  return preference === "system" ? (systemThemeQuery.matches ? "light" : "dark") : preference;
}

function applyTheme(preference, { persist = true, announce = false } = {}) {
  themePreference = ["system", "light", "dark"].includes(preference) ? preference : "dark";
  const resolvedTheme = resolveTheme();
  const labels = { system: "跟随系统", light: "亮色", dark: "暗色" };
  const icons = { system: "◐", light: "☀", dark: "☾" };
  const themeOrder = ["system", "light", "dark"];
  const nextTheme = themeOrder[(themeOrder.indexOf(themePreference) + 1) % themeOrder.length];
  document.documentElement.dataset.theme = themePreference;
  document.documentElement.dataset.themeResolved = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  document.querySelector('meta[name="theme-color"]').content = resolvedTheme === "light" ? "#eef3f0" : "#080b0a";
  themeToggleBtn.querySelector(".theme-toggle-icon").textContent = icons[themePreference];
  const resolvedHint = themePreference === "system" ? `（当前${labels[resolvedTheme]}）` : "";
  themeToggleBtn.setAttribute("aria-label", `切换显示主题，当前${labels[themePreference]}${resolvedHint}`);
  themeToggleBtn.title = `${labels[themePreference]}${resolvedHint} · 点击切换为${labels[nextTheme]}`;
  if (persist) {
    try { localStorage.setItem("yuanshan-workbench-theme", themePreference); } catch {}
  }
  if (announce) showToast(`已切换为${labels[themePreference]}${resolvedHint}`);
}

function applyAccent(accent, { persist = true, announce = false } = {}) {
  const accentNames = { emerald: "翡翠", ocean: "静海", iris: "鸢尾", amber: "琥珀", sakura: "绯樱" };
  accentPreference = Object.hasOwn(accentNames, accent) ? accent : "ocean";
  document.documentElement.dataset.accent = accentPreference;
  document.querySelectorAll("[data-accent-option]").forEach((button) => {
    const selected = button.dataset.accentOption === accentPreference;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document.querySelector("#accentName").textContent = accentNames[accentPreference];
  if (persist) {
    try { localStorage.setItem("yuanshan-workbench-accent", accentPreference); } catch {}
  }
  if (announce) showToast(`界面强调色已切换为「${accentNames[accentPreference]}」`);
}

function currentMetricCard() {
  return metricCards[selectedMetricIndex];
}

function selectMetricCard(index, { announce = false, syncDrawer = true } = {}) {
  selectedMetricIndex = Math.max(0, Math.min(metricCards.length - 1, Number(index) || 0));
  materialCardSelect.value = String(selectedMetricIndex);
  metricCards.forEach((card, cardIndex) => {
    const selected = cardIndex === selectedMetricIndex;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
  const selectedCard = currentMetricCard();
  selectedCard.classList.remove("selection-kick");
  void selectedCard.offsetWidth;
  selectedCard.classList.add("selection-kick");
  window.setTimeout(() => selectedCard.classList.remove("selection-kick"), 560);
  const cardName = selectedCard.querySelector("h3").textContent;
  document.querySelector("#materialSettingsBtn").setAttribute("aria-label", `设置${cardName}的流体配色`);
  document.querySelector("#materialSettingsBtn").title = `设置「${cardName}」配色`;
  if (syncDrawer && materialOverlay.classList.contains("open")) syncMaterialDrawer();
  if (announce) showToast(`已选择「${cardName}」· 点击顶部调节按钮设置配色`);
}

function replayMaterialMorph() {
  [materialPreview, currentMetricCard()].forEach((element) => {
    element.classList.remove("material-morph");
    void element.offsetWidth;
    element.classList.add("material-morph");
  });
}

function applyMaterial(material) {
  const metric = currentMetricCard();
  const palette = materialPalettes[material];
  if (palette) {
    const inputs = [document.querySelector("#colorA"), document.querySelector("#colorB"), document.querySelector("#colorC")];
    palette.forEach((color, index) => {
      inputs[index].value = color;
      inputs[index].nextElementSibling.textContent = color.toUpperCase();
    });
    [metric.dataset.colorA, metric.dataset.colorB, metric.dataset.colorC] = palette;
    [materialPreview, metric].forEach((element) => {
      element.style.setProperty("--mat-a", palette[0]);
      element.style.setProperty("--mat-b", palette[1]);
      element.style.setProperty("--mat-c", palette[2]);
    });
  }
  materialPreview.dataset.material = material;
  metric.dataset.material = material;
  document.querySelectorAll(".material-swatch").forEach((button) => button.classList.toggle("active", button.dataset.material === material));
  replayMaterialMorph();
}

function updateMaterialRanges() {
  const metric = currentMetricCard();
  const opacity = document.querySelector("#materialOpacity").value;
  const blur = document.querySelector("#materialBlur").value;
  const flow = document.querySelector("#flowSpeed").value;
  document.querySelector("#opacityOutput").textContent = `${opacity}%`;
  document.querySelector("#blurOutput").textContent = `${blur}px`;
  document.querySelector("#flowOutput").textContent = `${(flow / 100).toFixed(2)}×`;
  metric.dataset.opacity = opacity;
  metric.dataset.blur = blur;
  metric.dataset.flow = flow;
  [materialPreview, metric].forEach((element) => {
    element.style.setProperty("--material-opacity", opacity / 100);
    element.style.setProperty("--material-blur", `${blur}px`);
    element.style.setProperty("--flow-duration", `${Math.max(2.2, 8 - flow / 50)}s`);
  });
}

function updateCustomColors() {
  const metric = currentMetricCard();
  const inputs = [document.querySelector("#colorA"), document.querySelector("#colorB"), document.querySelector("#colorC")];
  const [colorA, colorB, colorC] = inputs.map((input) => input.value);
  inputs.forEach((input) => { input.nextElementSibling.textContent = input.value.toUpperCase(); });
  metric.dataset.colorA = colorA;
  metric.dataset.colorB = colorB;
  metric.dataset.colorC = colorC;
  [materialPreview, metric].forEach((element) => {
    element.style.setProperty("--mat-a", colorA);
    element.style.setProperty("--mat-b", colorB);
    element.style.setProperty("--mat-c", colorC);
  });
  applyMaterial("custom");
}

function syncMaterialDrawer() {
  const metric = currentMetricCard();
  const material = metric.dataset.material || "original";
  const styles = getComputedStyle(metric);
  const colorValues = [
    metric.dataset.colorA || styles.getPropertyValue("--mat-a").trim() || "#33ff4b",
    metric.dataset.colorB || styles.getPropertyValue("--mat-b").trim() || "#ff8539",
    metric.dataset.colorC || styles.getPropertyValue("--mat-c").trim() || "#11172b",
  ];
  const inputs = [document.querySelector("#colorA"), document.querySelector("#colorB"), document.querySelector("#colorC")];
  materialPreview.dataset.material = material;
  materialPreview.querySelector("strong").textContent = metric.querySelector("h3").textContent;
  inputs.forEach((input, index) => {
    input.value = colorValues[index];
    input.nextElementSibling.textContent = colorValues[index].toUpperCase();
    materialPreview.style.setProperty(`--mat-${String.fromCharCode(97 + index)}`, colorValues[index]);
  });
  document.querySelector("#materialOpacity").value = metric.dataset.opacity || 88;
  document.querySelector("#materialBlur").value = metric.dataset.blur || 18;
  document.querySelector("#flowSpeed").value = metric.dataset.flow || 200;
  document.querySelectorAll(".material-swatch").forEach((button) => button.classList.toggle("active", button.dataset.material === material));
  updateMaterialRanges();
  replayMaterialMorph();
}

function openMaterialDrawer() {
  materialCardSelect.value = String(selectedMetricIndex);
  syncMaterialDrawer();
  materialOverlay.setAttribute("aria-hidden", "false");
  document.querySelectorAll("[data-open-material]").forEach((button) => button.setAttribute("aria-expanded", "true"));
  document.body.classList.add("material-open");
  requestAnimationFrame(() => materialOverlay.classList.add("open"));
  window.setTimeout(() => document.querySelector("#closeMaterialBtn").focus(), 380);
}

function closeMaterialDrawer() {
  materialOverlay.classList.remove("open");
  materialOverlay.setAttribute("aria-hidden", "true");
  document.querySelectorAll("[data-open-material]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  document.body.classList.remove("material-open");
  document.querySelector("#materialSettingsBtn").focus();
}

function resetMaterialControls(resetTheme = false) {
  const initial = initialMetricStates[Number(materialCardSelect.value) || 0];
  document.querySelector("#materialOpacity").value = initial.opacity;
  document.querySelector("#materialBlur").value = initial.blur;
  document.querySelector("#flowSpeed").value = initial.flow;
  if (resetTheme) {
    const metric = currentMetricCard();
    const inputs = [document.querySelector("#colorA"), document.querySelector("#colorB"), document.querySelector("#colorC")];
    initial.colors.forEach((color, index) => {
      inputs[index].value = color;
      inputs[index].nextElementSibling.textContent = color.toUpperCase();
      metric.style.setProperty(`--mat-${String.fromCharCode(97 + index)}`, color);
      metric.dataset[`color${String.fromCharCode(65 + index)}`] = color;
    });
    applyMaterial(initial.material);
  }
  updateMaterialRanges();
}

function bindEvents() {
  themeToggleBtn.addEventListener("click", () => {
    const themeOrder = ["system", "light", "dark"];
    const nextTheme = themeOrder[(themeOrder.indexOf(themePreference) + 1) % themeOrder.length];
    themeControl.classList.remove("theme-switching");
    void themeControl.offsetWidth;
    themeControl.classList.add("theme-switching");
    applyTheme(nextTheme, { announce: true });
    window.setTimeout(() => themeControl.classList.remove("theme-switching"), 460);
  });
  systemThemeQuery.addEventListener("change", () => {
    if (themePreference === "system") applyTheme("system", { persist: false });
  });
  document.querySelectorAll("[data-accent-option]").forEach((button) => button.addEventListener("click", () => {
    applyAccent(button.dataset.accentOption, { announce: true });
  }));
  metricCards.forEach((card, index) => {
    card.addEventListener("pointermove", (event) => {
      card.classList.add("hovering");
      const bounds = card.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
      card.style.setProperty("--pointer-x", `${x * 100}%`);
      card.style.setProperty("--pointer-y", `${y * 100}%`);
      card.style.setProperty("--metric-rx", `${(0.5 - y) * 5}deg`);
      card.style.setProperty("--metric-ry", `${(x - 0.5) * 7}deg`);
    });
    card.addEventListener("pointerleave", () => {
      card.classList.remove("hovering");
      card.style.setProperty("--metric-rx", "0deg");
      card.style.setProperty("--metric-ry", "0deg");
    });
    card.addEventListener("click", () => {
      currentMetricIdx = index;
      selectMetricCard(index, { announce: false, syncDrawer: false });
      renderCards();
      if (documents[selectedIndex]) updateDetails(documents[selectedIndex]);
      showToast(`已切换到「${slotMetric(index).label}」视图`);
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      currentMetricIdx = index;
      selectMetricCard(index, { announce: false, syncDrawer: false });
      renderCards();
      if (documents[selectedIndex]) updateDetails(documents[selectedIndex]);
    });
  });
  orbitModeBtn.addEventListener("click", () => { if (rankMode) setRankMode(false); setViewMode("orbit"); });
  fanModeBtn.addEventListener("click", () => { if (rankMode) setRankMode(false); setViewMode("fan"); });
  if (rankModeBtn) rankModeBtn.addEventListener("click", () => setRankMode(!rankMode));
  playToggle.addEventListener("click", () => setPlaying(!isPlaying));
  document.querySelector("#prevBtn").addEventListener("click", () => nextCard(-1));
  document.querySelector("#nextBtn").addEventListener("click", () => nextCard(1));
  document.querySelector("#speedBtn").addEventListener("click", (event) => {
    speed = speed === 2 ? 1 : speed === 1 ? 0.5 : 2;
    event.currentTarget.textContent = `速度 ${speed}×`;
    restartAutoplay();
  });

  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    let dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (!dominantDelta) return;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) dominantDelta *= 16;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) dominantDelta *= viewport.clientHeight;
    // 滚动节流计数：换过 3 档就收起引导文案
    const tipNow = performance.now();
    if (tipNow - tipWheelAt > 240) {
      tipWheelAt = tipNow;
      if (++tipWheelTurns >= 3) dismissScrollTip();
    }
    const contribution = -Math.max(-140, Math.min(140, dominantDelta)) / 145;
    lastWheelDirection = Math.sign(contribution);
    targetPosition += contribution;
    startCarouselAnimation();
  }, { passive: false });

  viewport.addEventListener("pointerdown", (event) => {
    pointerStart = event.clientX;
    pointerCurrent = event.clientX;
    dragOriginPosition = visualPosition;
    if (carouselFrame !== null) cancelAnimationFrame(carouselFrame);
    carouselFrame = null;
    targetPosition = visualPosition;
    viewport.classList.add("dragging");
    viewport.classList.add("continuous-motion");
    if (autoplayTimer) cancelAnimationFrame(autoplayTimer);
    autoplayTimer = null;
  });
  viewport.addEventListener("pointermove", (event) => {
    if (pointerStart === null) return;
    pointerCurrent = event.clientX;
    const offset = Math.max(-240, Math.min(240, pointerCurrent - pointerStart));
    visualPosition = dragOriginPosition - offset / 112;
    targetPosition = visualPosition;
    scene.style.setProperty("--drag-tilt", `${offset * -.012}deg`);
    updateCardPositions(visualPosition);
  });
  viewport.addEventListener("pointerup", (event) => {
    if (pointerStart === null) return;
    const distance = event.clientX - pointerStart;
    let snapTarget = Math.round(visualPosition);
    if (Math.abs(distance) > 38) {
      const direction = distance > 0 ? -1 : 1;
      if (snapTarget === Math.round(dragOriginPosition)) snapTarget += direction;
      commitCarouselTarget(snapTarget, true, direction);
    } else if (!event.target.closest(".doc-card")) {
      const selectedEl = scene.querySelector(".doc-card.selected");
      const currentBounds = selectedEl ? selectedEl.getBoundingClientRect() : null;
      if (currentBounds && event.clientX > currentBounds.right) commitCarouselTarget(Math.round(visualPosition) + 1, true, 1);
      else if (currentBounds && event.clientX < currentBounds.left) commitCarouselTarget(Math.round(visualPosition) - 1, true, -1);
      else commitCarouselTarget(snapTarget, true);
    } else {
      commitCarouselTarget(snapTarget, true);
    }
    pointerStart = null;
    pointerCurrent = null;
    viewport.classList.remove("dragging");
    scene.style.removeProperty("--drag-tilt");
    if (isPlaying) restartAutoplay();
  });
  viewport.addEventListener("pointercancel", () => {
    commitCarouselTarget(Math.round(visualPosition), true);
    pointerStart = null;
    pointerCurrent = null;
    viewport.classList.remove("dragging");
    scene.style.removeProperty("--drag-tilt");
    if (isPlaying) restartAutoplay();
  });
  viewport.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextCard(1);
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextCard(-1);
    if (event.key === " ") { event.preventDefault(); setPlaying(!isPlaying); }
  });

  // 导航项：data-view 本地切换视图；data-href 跳转回原工作台；其余 toast
  document.querySelectorAll('.primary-nav .nav-item[data-view]').forEach((button) => button.addEventListener("click", () => setDashboardMode(button.dataset.view)));
  document.querySelectorAll(".primary-nav .nav-item:not(.active):not([data-open-material]):not([data-view])").forEach((button) => button.addEventListener("click", () => {
    const href = button.dataset.href;
    if (href) { window.open(href, "_blank"); return; }
    showToast(`${button.textContent.trim()} · 已定位`);
  }));
  // 月度汇总：上月/下月切换
  document.querySelector("#monthPrev").addEventListener("click", () => {
    monthlyMonth -= 1;
    if (monthlyMonth < 0) { monthlyMonth = 11; monthlyYear -= 1; }
    renderMonthlyTable();
  });
  document.querySelector("#monthNext").addEventListener("click", () => {
    monthlyMonth += 1;
    if (monthlyMonth > 11) { monthlyMonth = 0; monthlyYear += 1; }
    renderMonthlyTable();
  });
  bindMonthPicker();
  // 同步服务地址：页面由本地 serve.js(:8080) 提供时用同源，其它来源回落到 127.0.0.1:8080
  // （2026-10-26：旧实现硬编码 10.10.12.157:8080，线上点同步按钮必然失败）
  const LOCAL_BASE = (typeof window.__LOCAL_HOST === "string")
    ? window.__LOCAL_HOST
    : ((location.port === "8080" || location.protocol === "file:") ? "" : "http://127.0.0.1:8080");
  // 导航项 data-href 在 HTML 里写的是服务内路径（/sync 等），这里补上基址
  document.querySelectorAll('.primary-nav .nav-item[data-href^="/"]').forEach((b) => {
    b.dataset.href = LOCAL_BASE + b.dataset.href;
  });
  const SYNC_URLS = {
    sync: `${LOCAL_BASE}/sync`,
    fillDingtalk: `${LOCAL_BASE}/fill-dingtalk`,
    fixShopData: `${LOCAL_BASE}/fix-shop-data`,
    syncGaps: `${LOCAL_BASE}/sync-gaps`
  };
  const openLocal = (url, label) => {
    const win = window.open(url, "_blank");
    if (!win) showToast(`无法打开${label}（本地服务可能未启动）`);
  };
  // 同步选择弹窗：探域 / 拼多多 可分开同步
  const syncModal = document.querySelector("#syncModal");
  const openSyncModal = () => {
    if (!syncModal) { openLocal(SYNC_URLS.sync, "同步页"); return; }
    syncModal.hidden = false;
  };
  const closeSyncModal = () => { if (syncModal) syncModal.hidden = true; };
  if (syncModal) {
    syncModal.addEventListener("click", (e) => {
      // 选项卡片选中态
      const opt = e.target.closest(".sync-option");
      if (opt) {
        syncModal.querySelectorAll(".sync-option").forEach((o) => o.classList.remove("active"));
        opt.classList.add("active");
        const radio = opt.querySelector("input[type=radio]");
        if (radio) radio.checked = true;
        return;
      }
      // 关闭（遮罩 + 关闭按钮 + 取消）
      if (e.target.closest("[data-sync-modal-close]")) { closeSyncModal(); return; }
    });
    const syncConfirm = document.querySelector("#syncModalConfirm");
    if (syncConfirm) syncConfirm.addEventListener("click", () => {
      const checked = syncModal.querySelector("input[name=syncScope]:checked");
      const scope = (checked && checked.value) || "all";
      const label = scope === "tanyu" ? "探域同步页" : (scope === "pdd" ? "拼多多同步页" : "同步页");
      closeSyncModal();
      openLocal(SYNC_URLS.sync + "?scope=" + scope, label);
    });
  }
  // 月度弹窗内的同步入口（唯一入口：月度数据只在点击后同步）
  const monthlySyncBtns = document.querySelectorAll("#monthlyModal [data-sync-monthly], #monthlyModal [data-sync-pddmonthly]");
  monthlySyncBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const scope = btn.getAttribute("data-sync-monthly") !== null ? "monthly" : "pddmonthly";
      const label = scope === "monthly" ? "探域月度同步页" : "拼多多月度同步页";
      openLocal(SYNC_URLS.sync + "?scope=" + scope, label);
    });
  });
  const syncBtn = document.querySelector("#syncBtn");
  if (syncBtn) syncBtn.addEventListener("click", openSyncModal);

  // ===== 月度数据统计弹窗（探域自然月：销售额/采纳数/拦截数/采纳率/生成率/风控率等） =====
  let monthlyMonth = null;
  const fmtNum = (v) => (v === null || v === undefined || isNaN(v) ? "--" : "¥" + Number(v).toLocaleString("zh-CN"));
  const fmtInt = (v) => (v === null || v === undefined || isNaN(v) ? "--" : Math.round(v).toLocaleString("zh-CN"));
  const fmtPct = (v) => (v === null || v === undefined || isNaN(v) ? "--" : (Math.round(v * 100) / 100) + "%");
  const monthlyModal = document.querySelector("#monthlyModal");
  const openMonthlyModal = () => {
    if (!monthlyModal) { showToast("月度统计暂不可用"); return; }
    monthlyModal.hidden = false;
    renderMonthlyModal();
  };
  const closeMonthlyModal = () => { if (monthlyModal) monthlyModal.hidden = true; };
  function renderMonthlyModal() {
    const tabsEl = document.querySelector("#monthlyMonthTabs");
    const rowsEl = document.querySelector("#monthlyRows");
    const hint = document.querySelector("#monthlyHint");
    if (!tabsEl || !rowsEl) return;
    const monthly = (cloudDays.__library__ && cloudDays.__library__.monthly) || {};
    const months = Object.keys(monthly).sort().reverse();
    if (!months.length) {
      tabsEl.innerHTML = "";
      rowsEl.innerHTML = `<div class="m-empty">暂无月度统计数据 — 请在本机运行探域月度抓取脚本后同步</div>`;
      if (hint) hint.textContent = "提示：月度统计需在本机执行 tanyu-monthly-all.js 抓取探域数据后写入云端";
      return;
    }
    if (!monthlyMonth || months.indexOf(monthlyMonth) < 0) monthlyMonth = months[0];
    tabsEl.innerHTML = months.map((m) => `<button class="monthly-tab ${m === monthlyMonth ? "active" : ""}" data-month="${m}">${m}</button>`).join("");
    const data = monthly[monthlyMonth] || {};
    const libMap = {};
    cloudShops.forEach((s) => { libMap[s.id] = s.name; });
    const rows = Object.keys(data).map((id) => ({ id, name: libMap[id] || id, ...data[id] }));
    // 按店铺库顺序排序(重点店铺置顶, 与「月度汇总」视图一致, 不按销售额)
    const shopOrder = {};
    shopsKeyFirst(cloudShops).forEach((s, i) => { shopOrder[s.id] = i; });
    rows.sort((a, b) => (shopOrder[a.id] !== undefined ? shopOrder[a.id] : 999) - (shopOrder[b.id] !== undefined ? shopOrder[b.id] : 999));
    // 拼多多侧月度: 优先用同步抓取的 monthly[month].pdd (拼多多网站口径), 否则回退云端日数据月均
    // pdd = { replyRate: xls月均, expScore: 当月抓取值 }; 转化率用云端 conversionRate (探域/拼多多询单转化率同源)
    const pddFields = [
      { key: "conversionRate", label: "转化率" },
      { key: "threeMinReplyRate", label: "回复率" },
      { key: "experienceScore", label: "体验分" }
    ];
    const monthPrefix = monthlyMonth + "-";
    const dim = new Date(Number(monthlyMonth.slice(0, 4)), Number(monthlyMonth.slice(5, 7)), 0).getDate();
    rows.forEach((r) => {
      pddFields.forEach((f) => {
        const vals = [];
        for (let d = 1; d <= dim; d++) {
          const dateKey = monthPrefix + String(d).padStart(2, "0");
          const sd = cloudDays[dateKey] && cloudDays[dateKey].shopData && cloudDays[dateKey].shopData[r.id];
          const v = sd && sd[f.key];
          if (v !== undefined && v !== null && String(v) !== "") vals.push(parseFloat(v));
        }
        r[f.key] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100 : null;
      });
      // 用拼多多网站口径覆盖(同步"拼多多月度"后写入)
      if (r.pdd) {
        if (r.pdd.replyRate !== null && r.pdd.replyRate !== undefined) r.threeMinReplyRate = r.pdd.replyRate;
        if (r.pdd.expScore !== null && r.pdd.expScore !== undefined) r.experienceScore = r.pdd.expScore;
      }
    });
    if (!rows.length) {
      rowsEl.innerHTML = `<div class="m-empty">该月暂无店铺数据</div>`;
    } else {
      // 探域: 采纳率/生成率/风控率 | 拼多多: 询单转化率/3分钟回复率/商家体验分
      rowsEl.innerHTML = rows.map((r) => {
        const riskCls = r.riskRate !== null && r.riskRate >= 25 ? " m-risk" : "";
        const adoptCls = r.adoptRate !== null && r.adoptRate < 30 ? " m-warn" : "";
        const expCls = r.experienceScore !== null && r.experienceScore < 3 ? " m-warn" : "";
        return `<div class="m-cell m-shop">${esc(r.name)}</div>
          <div class="m-cell m-num${adoptCls}">${fmtPct(r.adoptRate)}</div>
          <div class="m-cell m-num">${fmtPct(r.genRate)}</div>
          <div class="m-cell m-num${riskCls}">${fmtPct(r.riskRate)}</div>
          <div class="m-cell m-num">${fmtPct(r.pureRatio)}</div>
          <div class="m-cell m-num">${fmtPct(r.conversionRate)}</div>
          <div class="m-cell m-num">${fmtPct(r.threeMinReplyRate)}</div>
          <div class="m-cell m-num${expCls}">${r.experienceScore === null || r.experienceScore === undefined ? "--" : r.experienceScore}</div>`;
      }).join("");
    }
    if (hint) hint.textContent = `${monthlyMonth} · ${rows.length} 家店铺 · 探域采纳/生成/风控率=计数÷总事件数 · 纯智占比=探域整月接待方式 · 转化率/回复率/体验分=日数据月均`;
  }
  if (monthlyModal) {
    monthlyModal.addEventListener("click", (e) => {
      if (e.target.closest("[data-monthly-modal-close]")) { closeMonthlyModal(); return; }
      const tab = e.target.closest("[data-month]");
      if (tab) { monthlyMonth = tab.dataset.month; renderMonthlyModal(); }
    });
  }
  const monthlyBtn = document.querySelector("#monthlyBtn");
  if (monthlyBtn) monthlyBtn.addEventListener("click", openMonthlyModal);
  const openWorkbenchBtn = document.querySelector("#openWorkbenchBtn");
  if (openWorkbenchBtn) openWorkbenchBtn.addEventListener("click", () => window.open("https://wt1013.github.io/ai-workbench/", "_blank"));
  const viewReportBtn = document.querySelector("#viewReportBtn");
  if (viewReportBtn) viewReportBtn.addEventListener("click", () => window.open("https://wt1013.github.io/ai-workbench/", "_blank"));
  const syncShopBtn = document.querySelector("#syncShopBtn");
  if (syncShopBtn) syncShopBtn.addEventListener("click", () => {
    // 单店同步: 只同步当前选中店铺(探域四项, 最近3天)
    const titleEl = document.querySelector("#detailTitle");
    const shopName = (titleEl ? titleEl.textContent : "").trim();
    if (!shopName) { showToast("未获取到当前店铺"); return; }
    openLocal(SYNC_URLS.sync + "?idx=" + encodeURIComponent(shopName), "单店同步页");
  });
  document.querySelectorAll(".scene-actions button").forEach((button) => button.addEventListener("click", () => {
    const t = button.textContent.trim();
    if (t === "同步昨日") openSyncModal();
    else if (t === "补缺数据") openLocal(SYNC_URLS.syncGaps, "补缺页");
    else showToast(`${t}成功`);
  }));
  // 数据体检 tab 筛选
  document.querySelectorAll(".queue-tabs button").forEach((button, i) => button.addEventListener("click", () => {
    button.parentElement.querySelector(".active").classList.remove("active");
    button.classList.add("active");
    queueFilter = ["all", "miss", "abn"][i] || "all";
    renderQueue();
  }));
  // 提醒条：点击标题展开/收起；点击店铺跳转对应卡片；点击设置标准
  const queuePane = document.querySelector(".queue-pane");
  if (queuePane) queuePane.addEventListener("click", (e) => {
    const bar = e.target.closest(".notice-bar");
    if (!bar) return;
    if (e.target.closest("#stdSetBtn")) { editStdThresholds(); return; }
    if (e.target.closest("#stdCaliberDay")) { saveStdCaliber("day"); renderStdNotice(); return; }
    if (e.target.closest("#stdCaliberMonth")) { saveStdCaliber("month"); renderStdNotice(); return; }
    if (e.target.closest("#gapSetBtn")) { editGapDays(); return; }
    if (e.target.closest("#downSetBtn")) { editDownThreshold(); return; }
    if (e.target.closest("#riskSetBtn")) { editRiskThreshold(); return; }
    const shopBtn = e.target.closest(".notice-shop");
    if (shopBtn) {
      const idx = documents.findIndex((d) => d.title === shopBtn.dataset.shop);
      if (idx >= 0) selectCard(idx, true);
      return;
    }
    if (e.target.closest(".notice-head")) {
      const open = bar.classList.toggle("open");
      bar.querySelector(".notice-head").setAttribute("aria-expanded", String(open));
    }
  });
  // 顶栏搜索（店铺名过滤 + ⌘K 聚焦）
  const searchInput = document.querySelector("#searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      renderQueue();
      const q = searchQuery.trim().toLowerCase();
      if (q) {
        const idx = documents.findIndex((d) => d.title.toLowerCase().includes(q));
        if (idx >= 0) selectCard(idx, true);
      }
    });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });
  }

  document.querySelectorAll("[data-open-material]").forEach((button) => button.addEventListener("click", openMaterialDrawer));
  document.querySelector("#closeMaterialBtn").addEventListener("click", () => closeMaterialDrawer());
  materialOverlay.addEventListener("pointerdown", (event) => {
    if (event.target === materialOverlay) closeMaterialDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && materialOverlay.classList.contains("open")) closeMaterialDrawer();
  });
  document.querySelectorAll(".material-swatch").forEach((button) => button.addEventListener("click", () => applyMaterial(button.dataset.material)));
  document.querySelectorAll(".color-fields input").forEach((input) => input.addEventListener("input", updateCustomColors));
  document.querySelectorAll(".material-controls input").forEach((input) => input.addEventListener("input", updateMaterialRanges));
  materialCardSelect.addEventListener("change", () => selectMetricCard(Number(materialCardSelect.value), { syncDrawer: true }));
  document.querySelector("#resetMaterialBtn").addEventListener("click", () => { resetMaterialControls(false); showToast("参数已重置"); });
  document.querySelector("#defaultMaterialBtn").addEventListener("click", () => { resetMaterialControls(true); showToast("已恢复初始材质"); });
  document.querySelector("#saveMaterialBtn").addEventListener("click", () => { closeMaterialDrawer(); showToast("材质设置已保存"); });
}

applyTheme(themePreference, { persist: false });
applyAccent(accentPreference, { persist: false });
bindEvents();

function setCloudStatus(text, cls) {
  const el = document.querySelector("#cloudStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "cloud-status" + (cls ? " " + cls : "");
}

async function initDashboard() {
  restoreScrollTip();
  setCloudStatus("同步中…", "loading");
  try {
    const data = await fetchCloud();
    setCloudStatus("已同步 · " + (data.latestDate ? data.latestDate.slice(5) : "暂无"), "ok");
    // 顶栏副标题 + 侧栏店铺规模：家数按云端库实时统计（原来硬编码「23 家」，与真实 20 家不符）
    const n = (data.shops || []).length;
    const subEl = document.querySelector("#pageSubtitle");
    if (subEl) {
      subEl.textContent = (n || "—") + " 店核心指标 · 异常提醒";
      subEl.title = n ? "云端店铺库共 " + n + " 家（含已停更店铺）" : "店铺库为空";
    }
    const vaultText = document.querySelector("#vaultText");
    if (vaultText) vaultText.textContent = (n || "—") + " 家店铺 / 客服AI / 远山";
    const vaultRow = document.querySelector("#vaultRow");
    if (vaultRow) vaultRow.title = (n || "—") + " 家拼多多店铺 · 客服AI";
    renderTimeline(); // 先渲染时间轴按钮
    viewOnDate(data.latestDate); // 加载最新数据日并联动仪表盘所有视图
    if (!documents.length) {
      showToast("暂无店铺数据，请先同步昨日数据");
      renderMonthlySeg();
      renderMonthlyTable();
      return;
    }
    setPlaying(false);
    // 恢复上次的主区模式（3D 卡片 / 全店排行）
    try { if (localStorage.getItem(RANK_STORE) === "1") setRankMode(true, { persist: false }); } catch (e) { }
    // 月度汇总：初始化指标切换 + 定位到最新数据月份
    if (data.latestDate) {
      const m = data.latestDate.match(/^(\d{4})-(\d{2})/);
      if (m) { monthlyYear = parseInt(m[1], 10); monthlyMonth = parseInt(m[2], 10) - 1; }
    }
    renderMonthlySeg();
    renderMonthlyTable();
  } catch (e) {
    console.error("数据加载失败:", e);
    setCloudStatus("云端加载失败", "err");
    showToast("云端数据加载失败，请检查网络");
  }
}
initDashboard();
