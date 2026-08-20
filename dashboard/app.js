let documents = [];

let groups = [];

/* ===== 数据层：从云端拉取远山店铺数据 ===== */
const CLOUD_URL = "https://kocuowtqklojxkhzlwpe.supabase.co";
const CLOUD_KEY = "sb_publishable_EinGWbe2S8hHl0kqngnmIg_uyZ5xRnp";

let cloudDays = null;
let cloudShops = [];
let cloudLatestDate = null;

async function fetchCloud() {
  const res = await fetch(`${CLOUD_URL}/rest/v1/state?select=days&id=eq.1`, {
    headers: { apikey: CLOUD_KEY, Authorization: `Bearer ${CLOUD_KEY}` }
  });
  if (!res.ok) throw new Error("云端请求失败 " + res.status);
  const data = await res.json();
  const days = (data[0] && data[0].days) || {};
  cloudDays = days;
  cloudShops = (days.__library__ && days.__library__.shops) || [];
  cloudLatestDate = findLatestFullDate(days);
  return { days, shops: cloudShops, latestDate: cloudLatestDate };
}

function findLatestFullDate(days) {
  const keys = Object.keys(days).filter((k) => /^2026-08-\d{2}$/.test(k)).sort();
  let latest = null;
  for (let i = keys.length - 1; i >= 0; i--) {
    const sd = days[keys[i]] && days[keys[i]].shopData;
    if (!sd) continue;
    let hasAdopt = false, hasExp = false;
    Object.keys(sd).forEach((id) => {
      const v = sd[id] || {};
      if (v.adoptionRate !== undefined && v.adoptionRate !== null && String(v.adoptionRate) !== "") hasAdopt = true;
      if (v.experienceScore !== undefined && v.experienceScore !== null && String(v.experienceScore) !== "") hasExp = true;
    });
    if (hasAdopt && hasExp) { latest = keys[i]; break; }
    if (hasAdopt && !latest) latest = keys[i];
  }
  return latest;
}

function metricVal(sd, field) {
  const v = sd && sd[field];
  return (v !== undefined && v !== null && String(v) !== "") ? parseFloat(v) : null;
}

function buildDocuments(shops, days, date) {
  return shops.map((shop) => {
    const sd = (days[date] && days[date].shopData && days[date].shopData[shop.id]) || {};
    const adopt = metricVal(sd, "adoptionRate");
    const gen = metricVal(sd, "generationRate");
    const conv = metricVal(sd, "conversionRate");
    const pure = metricVal(sd, "pureAgentRatio");
    const reply = metricVal(sd, "threeMinReplyRate");
    const exp = metricVal(sd, "experienceScore");
    const isKey = shop.key === true;
    const fmt = (v) => (v === null ? "--" : String(v));
    let status = "达标", priority = "中";
    if (adopt === null || exp === null) { status = "缺数据"; priority = "高"; }
    else if (exp < 3.5) { status = "体验分偏低"; priority = "高"; }
    else if (reply !== null && reply < 95) { status = "回复率偏低"; priority = "高"; }
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
      metrics: { adopt, gen, conv, pure, reply, exp }
    };
  });
}

function buildGroups(docs) {
  const missCore = docs.filter((d) => d.metrics.adopt === null || d.metrics.gen === null || d.metrics.conv === null || d.metrics.pure === null);
  const lowExp = docs.filter((d) => d.metrics.exp !== null && d.metrics.exp < 3.5);
  const lowReply = docs.filter((d) => d.metrics.reply !== null && d.metrics.reply > 0 && d.metrics.reply < 95);
  const groups = [];
  if (missCore.length) groups.push({ name: "缺数据店铺", count: missCore.length, color: "#ff8539", items: missCore.map((d) => [d.title, "待补数据", "今日"]) });
  if (lowExp.length) groups.push({ name: "体验分偏低(<3.5)", count: lowExp.length, color: "#ff4aa9", items: lowExp.map((d) => [d.title, "体验" + d.metrics.exp, "关注"]) });
  if (lowReply.length) groups.push({ name: "回复率偏低(<95%)", count: lowReply.length, color: "#56b8ff", items: lowReply.map((d) => [d.title, "回复" + d.metrics.reply + "%", "关注"]) });
  if (!groups.length) groups.push({ name: "数据健康", count: docs.length, color: "var(--accent-400)", items: [["全部店铺指标正常", "达标", docs.length + " 家"]] });
  return groups;
}

function updateMetricCards(docs) {
  const avg = (f) => {
    const vals = docs.map((d) => d.metrics[f]).filter((v) => v !== null);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : null;
  };
  const set = (vid, sid, val, unit) => {
    const vEl = document.querySelector("#" + vid), sEl = document.querySelector("#" + sid);
    if (vEl) vEl.innerHTML = (val === null ? "--" : val) + "<small>" + unit + "</small>";
    if (sEl) sEl.textContent = "全店均值 · " + docs.length + " 家";
  };
  set("valAdopt", "subAdopt", avg("adopt"), "%");
  set("valGen", "subGen", avg("gen"), "%");
  set("valConv", "subConv", avg("conv"), "%");
  set("valPure", "subPure", avg("pure"), "%");
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

function renderQueue() {
  const container = document.querySelector("#queueGroups");
  container.innerHTML = groups.map((group, groupIndex) => `
    <article class="queue-group ${groupIndex === 0 ? "open" : ""}">
      <button class="group-head" style="--group-color:${group.color}"><span><i></i>${group.name} <b>${group.count}</b></span><svg><use href="#i-chevron"/></svg></button>
      <div class="group-items">
        ${group.items.map((item) => `<button class="queue-item"><span>${item[0]}</span><em class="${item[1] === "在读" ? "reading" : ""}">${item[1]}</em><small>${item[2]}</small></button>`).join("")}
      </div>
    </article>
  `).join("");

  container.querySelectorAll(".group-head").forEach((button) => {
    button.addEventListener("click", () => button.closest(".queue-group").classList.toggle("open"));
  });
  container.querySelectorAll(".queue-item").forEach((button) => button.addEventListener("click", () => showToast(`已打开「${button.querySelector("span").textContent}」`)));
}

function renderCards() {
  scene.innerHTML = documents.map((doc, index) => `
    <button class="doc-card ${doc.accent} tone-${doc.tone || "green"}" data-index="${index}" aria-label="打开${doc.title}">
      <span class="paper-shine"></span>
      <span class="doc-kicker">${doc.short}</span>
      <span class="doc-lines"><i></i><i></i><i></i><i></i><i></i></span>
      <span class="doc-symbol">${index === 2 ? "!" : index === 0 ? "⌘" : index === 3 ? "↑" : "·"}</span>
      <span class="doc-copy"><strong>${doc.title}</strong><small>${doc.subtitle} · ${doc.state}</small></span>
    </button>
  `).join("");
  scene.querySelectorAll(".doc-card").forEach((card) => card.addEventListener("click", () => selectCard(Number(card.dataset.index), true)));
}

function renderTimeline() {
  const days = [];
  for (let i = 1; i <= 31; i++) days.push(String(i).padStart(2, "0"));
  const hasData = new Set();
  if (cloudDays) {
    Object.keys(cloudDays).forEach((k) => {
      const m = k.match(/^2026-08-(\d{2})$/);
      if (m) hasData.add(parseInt(m[1], 10));
    });
  }
  const latestDay = cloudLatestDate ? parseInt(cloudLatestDate.slice(8), 10) : 0;
  timelineDates.innerHTML = days.map((day) => {
    const n = parseInt(day, 10);
    const cls = hasData.has(n) ? "active" : "";
    const mark = n === latestDay ? `<i>${n}</i>` : "";
    return `<button data-day-index="${n}" class="${cls}">${mark}${day}</button>`;
  }).join("");
  timelineDates.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    timelineDates.querySelector(".active")?.classList.remove("active");
    button.classList.add("active");
    selectCard(Number(button.dataset.dayIndex) % documents.length);
  }));
}

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
  viewport.setAttribute("aria-label", fanView ? "可滚轮切换的侧向层叠复习卡片" : "可滚轮切换的复习卡片");
  document.querySelector(".scroll-tip p").textContent = fanView ? "连续滚动浏览侧向层叠；点击卡片展开" : "连续滚动转动复习卡片环；点击卡片展开";
  updateCardPositions(visualPosition);
  window.setTimeout(() => viewport.classList.remove("view-switching"), 760);
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
  document.querySelector("#detailId").textContent = doc.id;
  document.querySelector("#detailTitle").textContent = doc.detailTitle || doc.title;
  document.querySelector("#detailStatus").textContent = doc.status;
  document.querySelector("#detailDescription").textContent = doc.description;
  document.querySelector("#detailFolder").textContent = doc.folder;
  document.querySelector("#detailDate").textContent = doc.date;
  document.querySelector("#detailState").textContent = fmt(m.adopt, "%");
  document.querySelector("#detailPriority").textContent = fmt(m.exp);
  document.querySelector("#detailTags").innerHTML = doc.tags.map((tag) => `<span>${tag}</span>`).join("");
  document.querySelector("#detailAdvice").innerHTML = doc.advice.map((line) => `<li>${line}</li>`).join("");
  document.querySelector("#completionValue").textContent = fmt(m.adopt, "%");
  document.querySelector(".completion-card b").style.width = `${m.adopt === null || m.adopt === undefined ? 0 : Math.min(100, m.adopt)}%`;
  document.querySelector("#tipTitle").textContent = doc.title;
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
    return;
  }
  commitCarouselTarget(visualPosition + delta, explicit, Math.sign(delta));
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
    try { localStorage.setItem("kaoyan-workbench-theme", themePreference); } catch {}
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
    try { localStorage.setItem("kaoyan-workbench-accent", accentPreference); } catch {}
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
    card.addEventListener("click", () => selectMetricCard(index, { announce: true }));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectMetricCard(index, { announce: true });
    });
  });
  orbitModeBtn.addEventListener("click", () => setViewMode("orbit"));
  fanModeBtn.addEventListener("click", () => setViewMode("fan"));
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
      const currentBounds = scene.querySelector(".doc-card.selected").getBoundingClientRect();
      if (event.clientX > currentBounds.right) commitCarouselTarget(Math.round(visualPosition) + 1, true, 1);
      else if (event.clientX < currentBounds.left) commitCarouselTarget(Math.round(visualPosition) - 1, true, -1);
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

  // 导航项：有 data-href 的跳转回原工作台，其余保持 toast
  document.querySelectorAll(".primary-nav .nav-item:not(.active):not([data-open-material])").forEach((button) => button.addEventListener("click", () => {
    const href = button.dataset.href;
    if (href) { window.open(href, "_blank"); return; }
    showToast(`${button.textContent.trim()} · 已定位`);
  }));
  // 顶栏同步按钮 + 详情页操作按钮：跳转回原工作台对应功能
  const syncBtn = document.querySelector("#syncBtn");
  if (syncBtn) syncBtn.addEventListener("click", () => window.open("http://10.10.12.157:8080/sync", "_blank"));
  const openWorkbenchBtn = document.querySelector("#openWorkbenchBtn");
  if (openWorkbenchBtn) openWorkbenchBtn.addEventListener("click", () => window.open("https://wt1013.github.io/ai-workbench/", "_blank"));
  const viewReportBtn = document.querySelector("#viewReportBtn");
  if (viewReportBtn) viewReportBtn.addEventListener("click", () => window.open("https://wt1013.github.io/ai-workbench/", "_blank"));
  const syncShopBtn = document.querySelector("#syncShopBtn");
  if (syncShopBtn) syncShopBtn.addEventListener("click", () => window.open("http://10.10.12.157:8080/sync", "_blank"));
  document.querySelectorAll(".scene-actions button").forEach((button) => button.addEventListener("click", () => {
    const t = button.textContent.trim();
    if (t === "同步昨日") window.open("http://10.10.12.157:8080/sync", "_blank");
    else if (t === "补缺数据") window.open("http://10.10.12.157:8080/sync-gaps", "_blank");
    else showToast(`${t}成功`);
  }));
  document.querySelectorAll(".queue-tabs button").forEach((button) => button.addEventListener("click", () => {
    button.parentElement.querySelector(".active").classList.remove("active");
    button.classList.add("active");
  }));

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

async function initDashboard() {
  try {
    const data = await fetchCloud();
    documents = buildDocuments(data.shops, data.days, data.latestDate);
    groups = buildGroups(documents);
    updateMetricCards(documents);
    renderQueue();
    renderCards();
    renderTimeline();
    selectedIndex = 0;
    visualPosition = 0;
    targetPosition = 0;
    selectMetricCard(0, { syncDrawer: false });
    updateCardPositions(0);
    updateDetails(documents[0]);
    setPlaying(false);
  } catch (e) {
    console.error("数据加载失败:", e);
    showToast("云端数据加载失败，请检查网络");
  }
}
initDashboard();
