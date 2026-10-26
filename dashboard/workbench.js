/* ============================================================
 * workbench.js — 旧工作台功能迁移（今日任务/排班日历/数据指标/日报/店铺库）
 * 贴合新驾驶舱设计：卡片式布局、CSS 变量主题、云端数据同源
 * ============================================================ */
(function () {
  "use strict";

  var CLOUD_URL = "https://kocuowtqklojxkhzlwpe.supabase.co";
  var CLOUD_KEY = "sb_publishable_EinGWbe2S8hHl0kqngnmIg_uyZ5xRnp";
  var STORAGE_KEY = "csa-workbench-v1";
  // 镜像模式: CloudStudio 国内镜像(无法访问 Supabase 海外域名)时改读同源 state.json 快照
  var IS_MIRROR = (typeof location !== "undefined" && (location.hostname.indexOf("app.workbuddy.link") >= 0 || /[?&]mirror=1/.test(location.search)));

  var TASKS = [
    { id: "data-update", name: "数据更新" },
    { id: "pre-reception", name: "前置接待监控" },
    { id: "label-scene", name: "调优工坊-打标场景处理" },
    { id: "script-missing", name: "调优工坊-未生成话术处理" },
    { id: "tuling-qa", name: "探域-图灵问答（链接营销配置）" },
    { id: "appeal", name: "申诉处理" },
    { id: "others", name: "其他事项" },
    { id: "kb-update", name: "产品知识库更新" },
    { id: "rpa", name: "售后智能体维护（RPA）" }
  ];

  var METRICS = [
    { id: "labelCount", label: "本月店铺已打标数", sub: "打标处理总量" },
    { id: "scriptCount", label: "本月话术未生成数", sub: "待补话术总量" },
    { id: "badcaseCount", label: "Agent 更新条数", sub: "本月累计" },
    { id: "kbCount", label: "知识库更新条数", sub: "本月累计" }
  ];

  var STATUS_ORDER = ["todo", "doing", "done", "closed"];
  var SHIFT_LABELS = { zhong: "中", a: "A", xiu: "休" };

  var DEFAULT_SHIFTS = [
    "zhong", "xiu", "xiu", "a", "a", "a", "a", "a", "xiu", "a",
    "a", "a", "a", "a", "xiu", "xiu", "a", "a", "a", "a",
    "a", "xiu", "a", "a", "a", "a", "a", "a", "xiu", "a", "a"
  ];

  var SHOP_METRICS = [
    { key: "adoptionRate", label: "采纳率 %" },
    { key: "generationRate", label: "生成率 %" },
    { key: "conversionRate", label: "转化率 %" },
    { key: "pureAgentRatio", label: "纯智能体接待占比 %" },
    { key: "experienceScore", label: "消费者服务体验分" },
    { key: "threeMinReplyRate", label: "3分钟人工回复率 %" }
  ];

  // 重点店铺 = 店铺库 shop.key === true（在「店铺库」界面勾选，持久化到云端 __library__.shops[i].key）
  // 旧硬编码 KEY_SHOPS 已废弃，全部统一读 shop.key。

  var DEFAULT_SHOPS = [
    "松迅医疗器械专营店", "祥佳健康企业店", "PANAPOPO居家官方旗舰店", "PANAPOPO旗舰店（众创）",
    "个人护理海外购", "PANAPOPO医疗器械旗舰店", "moffe筑越专卖店", "panapopo居家日用旗舰店",
    "PANAPOPO家居官方旗舰店", "精进器械保健专营店", "伊藤源健康生活企业店", "Luffy居家日用企业店",
    "PANAPOPO健康用品官方旗舰店", "御足康生活保健馆", "康健理疗馆", "PANAPOPO保健按摩旗舰店",
    "PANAPOPO生活用品官方旗舰店", "PANAPOPO护理旗舰", "Sung居家生活企业店", "PANAPOPO居家日化官方旗舰店",
    "桑桃企业店", "PANAPOPO医疗用品官方旗舰店", "PANAPOPO家居生活官方旗舰店", "PANAPOPO保健器械官方旗舰店"
  ];

  var state = { days: {}, shifts: {} };
  var shopLibrary = [];
  var currentDateKey = null;
  var calYear = null, calMonth = null;
  var showClosed = false;
  var shopsTab = "roster";
  var selectedShopId = null;
  var shopsSearchQuery = "";
  var shopsDailyDate = ""; // 数据录入所选日期(空=默认昨天)
  var wbReady = false;

  /* ---------- 工具 ---------- */
  function $id(id) { return document.getElementById(id); }
  function toKey(d) { var p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function todayKey() { return toKey(new Date()); }
  function fromKey(key) { var parts = key.split("-").map(Number); return new Date(parts[0], parts[1] - 1, parts[2]); }
  function weekdayLabel(key) { return "星期" + ["日", "一", "二", "三", "四", "五", "六"][fromKey(key).getDay()]; }
  function yesterdayKeyOf(key) {
    var p = key.split("-").map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() - 1);
    return toKey(d);
  }
  // 日报默认日期：最近一天有店铺指标数据的（跳过空壳天）
  function lastReportKey() {
    if (!state || !state.days) { return yesterdayKeyOf(todayKey()); }
    var keys = Object.keys(state.days).filter(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || k === "__library__" || k === "__logs__") { return false; }
      var d = state.days[k];
      if (!d || !d.shopData) { return false; }
      // 必须至少有 1 家店有任意 4 项指标之一非空
      var shops = Object.keys(d.shopData);
      for (var i = 0; i < shops.length; i++) {
        var sd = d.shopData[shops[i]] || {};
        if (sd.adoptionRate !== undefined && sd.adoptionRate !== "" && sd.adoptionRate !== null) { return true; }
        if (sd.generationRate !== undefined && sd.generationRate !== "" && sd.generationRate !== null) { return true; }
        if (sd.conversionRate !== undefined && sd.conversionRate !== "" && sd.conversionRate !== null) { return true; }
        if (sd.pureAgentRatio !== undefined && sd.pureAgentRatio !== "" && sd.pureAgentRatio !== null) { return true; }
      }
      return false;
    }).sort();
    var picked = keys.length ? keys[keys.length - 1] : yesterdayKeyOf(todayKey());
    if (typeof console !== "undefined" && console.log) { console.log("[report] lastReportKey:", { candidates: keys.length, picked: picked, currentDateKey: currentDateKey }); }
    return picked;
  }
  function esc(s) { return String(s === undefined || s === null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function toast(msg) {
    var t = document.querySelector(".wb-toast");
    if (t) { t.textContent = msg; t.style.opacity = "1"; }
    else {
      t = document.createElement("div");
      t.className = "wb-toast";
      t.textContent = msg;
      document.body.appendChild(t);
    }
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.style.opacity = "0"; }, 2200);
  }

  /* ---------- 数据层 ---------- */
  function seedDefaultShifts() {
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth();
    DEFAULT_SHIFTS.forEach(function (shift, i) {
      var key = toKey(new Date(y, m, i + 1));
      state.shifts[key] = shift;
    });
  }

  function ensureShopLibrary(persist) {
    if (state.days["__library__"] && Array.isArray(state.days["__library__"].shops)) {
      shopLibrary = state.days["__library__"].shops;
    } else {
      shopLibrary = DEFAULT_SHOPS.map(function (name, index) {
        return { id: "s" + (index + 1), name: name, owner: "远山", adoptionRate: "", generationRate: "", conversionRate: "", pureAgentRatio: "", experienceScore: "", note: "" };
      });
      state.days["__library__"] = Object.assign({}, state.days["__library__"] || {}, { shops: shopLibrary });
      if (persist) { wbSave(false); }
    }
  }

  function dayData(key) {
    if (!state.days[key]) { state.days[key] = { tasks: {}, metrics: {}, difficulty: "", shopData: {} }; }
    var day = state.days[key];
    if (!day.tasks) { day.tasks = {}; }
    if (!day.metrics) { day.metrics = {}; }
    if (day.difficulty === undefined) { day.difficulty = ""; }
    if (!day.shopData) { day.shopData = {}; }
    return day;
  }

  function taskData(key, taskId) {
    var day = dayData(key);
    if (!day.tasks[taskId]) { day.tasks[taskId] = { status: "todo", priority: "mid", note: "" }; }
    return day.tasks[taskId];
  }

  function dayHasData(key) {
    var day = state.days[key];
    if (!day || key === "__library__") { return false; }
    if (day.difficulty && day.difficulty.trim()) { return true; }
    var sd = day.shopData || {};
    for (var id in sd) {
      var v = sd[id] || {};
      if (v.adoptionRate || v.generationRate || v.conversionRate || v.pureAgentRatio || v.experienceScore) { return true; }
    }
    var tasks = day.tasks || {};
    for (var tid in tasks) {
      var t = tasks[tid] || {};
      if (t.note || (t.status && t.status !== "todo") || (t.priority && t.priority !== "mid")) { return true; }
    }
    var metrics = day.metrics || {};
    for (var mid in metrics) {
      if (metrics[mid] !== undefined && metrics[mid] !== null && String(metrics[mid]).trim() !== "") { return true; }
    }
    return false;
  }

  function countStatus(key) {
    var counts = { done: 0, doing: 0, todo: 0, closed: 0 };
    TASKS.forEach(function (task) {
      var st = taskData(key, task.id).status || "todo";
      if (counts[st] !== undefined) { counts[st] += 1; }
    });
    return counts;
  }

  function wbLoad() {
    if (IS_MIRROR) {
      // 镜像模式: 读同源 state.json 快照(国内可访问), 失败回退本地 localStorage
      return fetch("./state.json").then(function (r) { return r.json(); }).then(function (obj) {
        state.days = obj.days || {};
        state.shifts = obj.shifts || {};
        if (!state.shifts || Object.keys(state.shifts).length === 0) { seedDefaultShifts(); }
        ensureShopLibrary(false);
        wbReady = true;
      }).catch(function () {
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (raw) { var parsed = JSON.parse(raw); state.days = parsed.days || {}; state.shifts = parsed.shifts || {}; }
        } catch (e) { state.days = {}; state.shifts = {}; }
        if (!state.shifts || Object.keys(state.shifts).length === 0) { seedDefaultShifts(); }
        ensureShopLibrary(false);
        wbReady = true;
      });
    }
    return fetch(CLOUD_URL + "/rest/v1/state?select=days,shifts&id=eq.1", {
      headers: { apikey: CLOUD_KEY, Authorization: "Bearer " + CLOUD_KEY }
    }).then(function (r) { return r.json(); }).then(function (rows) {
      if (rows && rows.length > 0) {
        state.days = rows[0].days || {};
        state.shifts = rows[0].shifts || {};
      } else {
        state.days = {}; state.shifts = {}; seedDefaultShifts();
      }
      if (!state.shifts || Object.keys(state.shifts).length === 0) { seedDefaultShifts(); }
      ensureShopLibrary(false);
      wbReady = true;
    }).catch(function () {
      // 云端不可达时回退本地
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) { var parsed = JSON.parse(raw); state.days = parsed.days || {}; state.shifts = parsed.shifts || {}; }
      } catch (e) { state.days = {}; state.shifts = {}; }
      if (!state.shifts || Object.keys(state.shifts).length === 0) { seedDefaultShifts(); }
      ensureShopLibrary(false);
      wbReady = true;
    });
  }

  var saveTimer = null;
  function wbSave(showTip) {
    try {
      // 2026-10-02 修复: 原为 state.days["__library__"] = { shops: shopLibrary },
      // 会把云端写入的 __library__.monthly(月度累计, 供达标提醒「本月累计」+ 钉钉汇总看板) 整块抹掉。
      // 改为 Object.assign 保留 __library__ 其它键, 只更新 shops。
      state.days["__library__"] = Object.assign({}, state.days["__library__"] || {}, { shops: shopLibrary });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, days: state.days, shifts: state.shifts }));
      if (IS_MIRROR) {
        // 镜像模式只读: 仅存本地, 不写云端(查看者无 Supabase 访问权限)
        if (showTip) { toast("已保存到本地（镜像只读模式）"); }
        return;
      }
      if (saveTimer) { clearTimeout(saveTimer); }
      saveTimer = setTimeout(function () {
        fetch(CLOUD_URL + "/rest/v1/state", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: CLOUD_KEY, Authorization: "Bearer " + CLOUD_KEY, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ id: 1, days: state.days, shifts: state.shifts })
        }).then(function (r) {
          if (showTip) { toast(r.ok ? "已同步到云端" : "云端同步失败"); }
        }).catch(function () { if (showTip) { toast("云端同步失败"); } });
      }, 500);
    } catch (e) { if (showTip) { toast("保存失败"); } }
  }

  /* ---------- 今日工作台视图 ---------- */
  function renderCalendar() {
    var grid = $id("wbCalGrid");
    var monthEl = $id("wbCalMonth");
    if (!grid) { return; }
    var key = currentDateKey || todayKey();
    var parts = key.split("-").map(Number);
    if (calYear === null || calMonth === null) { calYear = parts[0]; calMonth = parts[1] - 1; }
    monthEl.textContent = calYear + "年" + (calMonth + 1) + "月";
    grid.innerHTML = "";
    var lead = new Date(calYear, calMonth, 1).getDay();
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var today = todayKey();
    for (var i = 0; i < lead; i += 1) {
      var blank = document.createElement("div");
      blank.className = "wb-cal-day blank";
      grid.appendChild(blank);
    }
    for (var d = 1; d <= daysInMonth; d += 1) {
      var dateKey = toKey(new Date(calYear, calMonth, d));
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wb-cal-day";
      btn.dataset.date = dateKey;
      btn.textContent = d;
      var shift = state.shifts[dateKey];
      if (shift && SHIFT_LABELS[shift]) {
        var chip = document.createElement("span");
        chip.className = "wb-shift-chip shift-" + shift;
        chip.textContent = SHIFT_LABELS[shift];
        btn.appendChild(chip);
      }
      if (dateKey === key) { btn.classList.add("selected"); }
      if (dateKey === today) { btn.classList.add("today"); }
      if (dayHasData(dateKey)) { btn.classList.add("has-data"); }
      grid.appendChild(btn);
    }
  }

  function renderTasks() {
    var wrap = $id("wbTaskGroups");
    if (!wrap) { return; }
    var key = currentDateKey || todayKey();
    var counts = countStatus(key);
    var total = TASKS.length - counts.closed;
    var done = counts.done;
    var pct = total > 0 ? Math.round((done / total) * 100) : 0;
    var progressHtml =
      '<div class="wb-progress-row">' +
      '<div class="wb-progress-track"><div class="wb-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<span class="wb-progress-text">已完成 ' + done + '/' + total + ' · 进行中 ' + counts.doing + '</span>' +
      '</div>';
    var rows = TASKS.map(function (task) {
      var data = taskData(key, task.id);
      var st = data.status || "todo";
      var seg = STATUS_ORDER.map(function (s) {
        return '<button type="button" class="wb-seg-btn" data-task="' + task.id + '" data-status="' + s + '"' +
          (st === s ? ' class="wb-seg-btn active st-' + s + '"' : '') + '>' + (s === "todo" ? "待处理" : s === "doing" ? "进行中" : s === "done" ? "已完成" : "关闭") + '</button>';
      }).join("");
      return '<div class="wb-task-row' + (st === "closed" ? " closed" : "") + '" data-task="' + task.id + '">' +
        '<span class="wb-task-name" data-action="note" title="点击编辑备注">' + esc(task.name) + '</span>' +
        (data.note ? '<span class="wb-task-note-dot" title="' + esc(data.note) + '"></span>' : '') +
        '<div class="wb-status-seg">' + seg + '</div>' +
        '</div>';
    }).join("");
    var closedBtn = counts.closed > 0
      ? '<button type="button" class="pill-btn quiet" id="wbClosedToggle" style="margin-top:8px">已关闭 ' + counts.closed + ' 项 ' + (showClosed ? "▲" : "▼") + '</button>'
      : "";
    wrap.innerHTML = progressHtml + '<div class="wb-task-list">' + rows + '</div>' + closedBtn;
    // 备注编辑（点击任务名）
    Array.prototype.forEach.call(wrap.querySelectorAll("[data-action='note']"), function (el) {
      el.addEventListener("click", function () {
        var taskId = el.parentElement.dataset.task;
        var d = taskData(currentDateKey || todayKey(), taskId);
        var current = prompt("为任务「" + TASKS.filter(function (t) { return t.id === taskId; })[0].name + "」填写备注：", d.note || "");
        if (current !== null) {
          d.note = current;
          wbSave(true);
          renderTasks();
          renderCalendar();
        }
      });
    });
    // 已关闭折叠
    var closedBtnEl = $id("wbClosedToggle");
    if (closedBtnEl) {
      closedBtnEl.addEventListener("click", function () {
        showClosed = !showClosed;
        renderTasks();
      });
    }
  }

  function renderMetrics() {
    var grid = $id("wbMetricGrid");
    if (!grid) { return; }
    var key = currentDateKey || todayKey();
    var month = key.slice(0, 7);
    var sum = { badcaseCount: 0, kbCount: 0 };
    Object.keys(state.days).forEach(function (k) {
      if (k.slice(0, 7) !== month) { return; }
      var m = (state.days[k] && state.days[k].metrics) || {};
      ["badcaseCount", "kbCount"].forEach(function (id) {
        var v = parseFloat(m[id]);
        if (!isNaN(v)) { sum[id] += v; }
      });
    });
    var todayM = dayData(key).metrics || {};
    var items = METRICS.map(function (m) {
      var v = m.id === "badcaseCount" ? sum.badcaseCount : m.id === "kbCount" ? sum.kbCount
        : (todayM[m.id] !== undefined && todayM[m.id] !== null && todayM[m.id] !== "") ? todayM[m.id] : 0;
      return '<div class="wb-metric-mini"><span class="wb-m-label">' + m.label + '</span><span class="wb-m-value">' + v + '</span><span class="wb-m-sub">' + m.sub + '</span></div>';
    }).join("");
    // 已打标待审核便签
    var marked = (dayData(key).shopMarked) || {};
    var names = Object.keys(marked).filter(function (n) { return marked[n] > 0; }).sort(function (a, b) { return marked[b] - marked[a]; });
    var noteHtml = names.length
      ? '<div class="wb-marked-note"><div class="wb-marked-title">已标记待审核（' + names.length + ' 店）</div><div class="wb-marked-chips">' +
        names.map(function (n) { return '<span class="wb-marked-chip"><span>' + esc(n) + '</span><span class="wb-marked-num">' + marked[n] + '</span></span>'; }).join("") +
        '</div></div>'
      : '<div class="wb-marked-note"><div class="wb-marked-title">已标记待审核</div><div class="wb-marked-chips"><span class="wb-marked-chip" style="color:var(--muted)">无待审核</span></div></div>';
    grid.innerHTML = items;
    var noteBox = $id("wbMarkedNote");
    if (noteBox) { noteBox.innerHTML = noteHtml; }
    var diffInput = $id("wbDifficulty");
    if (diffInput) { diffInput.value = dayData(key).difficulty || ""; }
  }

  function wbRenderToday() {
    if (!wbReady) { wbLoad().then(function () { wbRenderTodayInternal(); }); return; }
    wbRenderTodayInternal();
  }
  function wbRenderTodayInternal() {
    if (!currentDateKey) { currentDateKey = todayKey(); }
    var label = $id("wbDateLabel");
    if (label) { label.textContent = currentDateKey + " · " + weekdayLabel(currentDateKey); }
    renderCalendar();
    renderTasks();
    renderMetrics();
    var diffInput = $id("wbDifficulty");
    if (diffInput) {
      diffInput.oninput = function () {
        dayData(currentDateKey || todayKey()).difficulty = diffInput.value;
        wbSave(false);
      };
    }
  }

  /* ---------- 日报视图 ---------- */
  function shopMetricVal(dateKey, shopId, field) {
    var sd = state.days[dateKey] && state.days[dateKey].shopData && state.days[dateKey].shopData[shopId];
    var v = sd && sd[field];
    return (v !== undefined && v !== null && String(v) !== "") ? parseFloat(v) : null;
  }
  function pct(v) { return v === null ? "—" : (Math.round(v * 100) / 100) + "%"; }
  function deltaText(prev, latest) {
    if (prev === null || latest === null) { return ""; }
    var diff = Math.round((latest - prev) * 100) / 100;
    if (diff === 0) { return '<span class="wb-delta-eq">0.00</span>'; }
    return diff > 0
      ? '<span class="wb-delta-up">↑ ' + diff.toFixed(2) + '</span>'
      : '<span class="wb-delta-down">↓ ' + Math.abs(diff).toFixed(2) + '</span>';
  }
  function reportDraft() {
    try { return JSON.parse(localStorage.getItem("csa-report-draft") || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveReportDraft(key, obj) {
    var d = reportDraft();
    d[key] = obj;
    try { localStorage.setItem("csa-report-draft", JSON.stringify(d)); } catch (e) {}
  }

  function renderDailyReport() {
    var content = $id("reportContent");
    var dateLabel = $id("reportDateLabel");
    if (!content) { return; }
    // 日报独立取数：自动找最近一天有店铺指标的（跳过今天空壳日）
    var key = lastReportKey();
    if (dateLabel) { dateLabel.textContent = "数据截止 " + key + "（" + weekdayLabel(key) + "）"; }
    var day = state.days[key];
    var draft = reportDraft()[key] || {};
    var shopRows = "";
    var shops = shopLibrary.slice().sort(function (a, b) {
      var ka = a && a.key === true ? 1 : 0;
      var kb = b && b.key === true ? 1 : 0;
      return kb - ka;
    }).filter(shopKey);
    var metrics4 = [
      { key: "adoptionRate", label: "采纳率" },
      { key: "generationRate", label: "生成率" },
      { key: "riskRate", label: "风控率" },
      { key: "conversionRate", label: "转化率" },
      { key: "pureAgentRatio", label: "纯智能体占比" }
    ];
    var prevKey = null;
    if (key) {
      var prev = fromKey(key);
      prev.setDate(prev.getDate() - 1);
      prevKey = toKey(prev);
    }
    shops.forEach(function (shop) {
      var cells = metrics4.map(function (m) {
        var v = shopMetricVal(key, shop.id, m.key);
        var pv = shopMetricVal(prevKey, shop.id, m.key);
        return '<td>' + pct(v) + ' ' + deltaText(pv, v) + '</td>';
      }).join("");
      shopRows += '<tr><td>' + esc(shop.name) + (shop.key === true ? ' <span class="shop-key-badge">重点</span>' : '') + '</td>' + cells + '</tr>';
    });
    var tableHtml =
      '<div class="wb-report-card">' +
      '<h3>一、重点店铺核心指标（数据截止 ' + key + '）</h3>' +
      '<div class="wb-table-wrap"><table class="wb-report-table"><thead><tr><th>店铺</th><th>采纳率</th><th>生成率</th><th>风控率</th><th>转化率</th><th>纯智能体占比</th></tr></thead><tbody>' +
      (shopRows || '<tr><td colspan="6" style="color:var(--muted)">今日暂无店铺数据，请先同步</td></tr>') +
      '</tbody></table></div></div>';
    var block = function (title, field, placeholder) {
      var val = draft[field] !== undefined ? draft[field] : "";
      return '<div class="wb-report-card"><h3>' + title + '</h3>' +
        '<textarea class="wb-report-textarea" data-draft-field="' + field + '" placeholder="' + placeholder + '">' + esc(val) + '</textarea></div>';
    };
    var html = tableHtml +
      block("二、当日配置总结", "summary", "简要说明当天做了哪些配置：话术调优、知识库更新、打标规则等") +
      block("三、问题反馈", "feedback", "记录前置接待或调优时遇到的问题") +
      block("四、本周重点（可选）", "weekFocus", "填写本周重点工作：目标、进展、成果等") +
      block("五、明日待办 · 调优重点", "tomorrow", "明日计划");
    content.innerHTML = html;
    // 草稿自动保存
    Array.prototype.forEach.call(content.querySelectorAll("[data-draft-field]"), function (ta) {
      ta.addEventListener("input", function () {
        var d = reportDraft()[key] || {};
        d[ta.dataset.draftField] = ta.value;
        saveReportDraft(key, d);
      });
    });
  }

  function collectReportText() {
    var key = lastReportKey();
    var draft = reportDraft()[key] || {};
    var lines = [];
    lines.push("【" + key + " 日报】");
    lines.push("一、重点店铺核心指标");
    var shops = shopLibrary.slice().sort(function (a, b) {
      var ka = a && a.key === true ? 1 : 0;
      var kb = b && b.key === true ? 1 : 0;
      return kb - ka;
    }).filter(shopKey);
    var metrics4 = [
      { key: "adoptionRate", label: "采纳率" },
      { key: "generationRate", label: "生成率" },
      { key: "riskRate", label: "风控率" },
      { key: "conversionRate", label: "转化率" },
      { key: "pureAgentRatio", label: "纯智能体占比" }
    ];
    shops.forEach(function (shop) {
      var cells = metrics4.map(function (m) { return pct(shopMetricVal(key, shop.id, m.key)); });
      lines.push(shop.name + "：" + cells.join(" / "));
    });
    lines.push("二、当日配置总结：" + (draft.summary || ""));
    lines.push("三、问题反馈：" + (draft.feedback || ""));
    lines.push("四、本周重点：" + (draft.weekFocus || ""));
    lines.push("五、明日待办：" + (draft.tomorrow || ""));
    return lines.join("\n");
  }

  function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { toast("已复制"); }, function () { fallbackCopy(text); });
    }
    fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("已复制"); } catch (e) { toast("复制失败"); }
    document.body.removeChild(ta);
  }

  function exportCsv() {
    var key = lastReportKey();
    var rows = [["店铺", "采纳率%", "生成率%", "风控率%", "转化率%", "纯智能体占比%"]];
    shopLibrary.slice().sort(function (a, b) {
      var ka = a && a.key === true ? 1 : 0;
      var kb = b && b.key === true ? 1 : 0;
      return kb - ka;
    }).filter(shopKey).forEach(function (shop) {
      rows.push([
        shop.name,
        shopMetricVal(key, shop.id, "adoptionRate") === null ? "" : shopMetricVal(key, shop.id, "adoptionRate"),
        shopMetricVal(key, shop.id, "generationRate") === null ? "" : shopMetricVal(key, shop.id, "generationRate"),
        shopMetricVal(key, shop.id, "riskRate") === null ? "" : shopMetricVal(key, shop.id, "riskRate"),
        shopMetricVal(key, shop.id, "conversionRate") === null ? "" : shopMetricVal(key, shop.id, "conversionRate"),
        shopMetricVal(key, shop.id, "pureAgentRatio") === null ? "" : shopMetricVal(key, shop.id, "pureAgentRatio")
      ]);
    });
    var csv = "\ufeff" + rows.map(function (r) { return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(","); }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "日报-" + key + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("CSV 已导出");
  }

  function reportImage(fn) {
    if (!wbReady) { wbLoad().then(function () { renderShotImage(fn); }); return; }
    renderShotImage(fn);
  }
  function renderShotImage(fn) {
    toast("正在生成图片…");
    var holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-10000px";
    holder.style.top = "0";
    holder.style.width = "1000px";
    holder.innerHTML = buildReportShotHtml();
    document.body.appendChild(holder);
    try {
      var html2canvas = window.html2canvas;
      if (!html2canvas) { toast("图片库未加载，请刷新重试"); document.body.removeChild(holder); return; }
      html2canvas(holder, { backgroundColor: "#ffffff", scale: 2, useCORS: true }).then(function (canvas) {
        document.body.removeChild(holder);
        fn(canvas);
      }).catch(function () { document.body.removeChild(holder); toast("生成图片失败"); });
    } catch (e) { document.body.removeChild(holder); toast("生成图片失败"); }
  }

  function wbRenderReport() {
    if (!wbReady) { wbLoad().then(function () { renderDailyReport(); }); return; }
    renderDailyReport();
  }

  /* ---------- 日报弹窗（参考老版日报绿色主题）---------- */
  // 生成老版日报示意图 HTML（弹窗 + 复制/下载图片共用）
  // 日报长文本排版: 优先按用户换行分段 → 再按句末标点(。；!?！？) → 最后按逗号(长流水账)
  // 切出多条且长度合理才渲染为带圆点的列表(缓解整段文字堆积感), 否则原样输出
  // plain=true: 强制按「一整段」输出(不分点), 只保留用户自己的换行(pre-wrap)
  function fmtShotText(txt, plain) {
    var t = String(txt == null ? "" : txt).trim();
    if (!t) { return "（无）"; }
    if (plain) { return esc(t); }
    var splitBy = function (str, re) {
      return (str.match(re) || []).map(function (s) { return s.trim(); }).filter(Boolean);
    };
    var render = function (parts) {
      return '<ul class="shot-text-list">' + parts.map(function (p) {
        return "<li>" + esc(p.replace(/[，,、]+$/, "").trim()) + "</li>";
      }).join("") + "</ul>";
    };
    // 1) 用户换行
    var parts = t.split(/\r?\n+/).map(function (s) {
      return s.replace(/^[\s·•\-\u2013\u2014]+/, "").trim();
    }).filter(Boolean);
    // 2) 句末标点
    if (parts.length <= 1) { parts = splitBy(t, /[^。；;!?！？]+[。；;!?！？]?/g); }
    if (parts.length >= 2 && t.length / parts.length >= 6) { return render(parts); }
    // 3) 逗号/顿号(整段既无换行也无句末标点时, 把长流水账拆成条目; 条目过多或过短则保持原样)
    if (parts.length <= 1) {
      var p3 = splitBy(t, /[^，,、]+[，,、]?/g);
      var avg3 = p3.length ? t.length / p3.length : 0;
      if (p3.length >= 2 && p3.length <= 10 && avg3 >= 8) { return render(p3); }
    }
    return esc(t);
  }
  function buildReportShotHtml() {
    var key = lastReportKey();
    var day = state.days[key] || {};
    var draft = (reportDraft() || {})[key] || {};
    var shops = (shopLibrary || []).filter(shopKey);
    var metrics4 = [
      { key: "adoptionRate", label: "采纳率" },
      { key: "generationRate", label: "生成率" },
      { key: "riskRate", label: "风控率" },
      { key: "conversionRate", label: "转化率" },
      { key: "pureAgentRatio", label: "纯智能体占比" }
    ];
    var prevKey = null;
    if (key) {
      var prev = fromKey(key);
      prev.setDate(prev.getDate() - 1);
      prevKey = toKey(prev);
    }
    // 行渲染：店名 + 5 指标 + 环比（对齐老版 shot-table）
    var rows = "";
    var todoItems = [];
    shops.forEach(function (shop) {
      var hasDown = false;
      var downTexts = [];
      var cells = '<td>' + esc(shop.name) + '</td>';
      metrics4.forEach(function (m) {
        var v = shopMetricVal(key, shop.id, m.key);
        var pv = shopMetricVal(prevKey, shop.id, m.key);
        var valStr = v === null ? "—" : (Math.round(v * 100) / 100) + "%";
        var deltaCls = "shot-delta-flat", deltaTxt = "—";
        if (v !== null && pv !== null) {
          var diff = Math.round((v - pv) * 100) / 100;
          if (diff < 0) {
            hasDown = true;
            downTexts.push({ label: m.label, diff: Math.abs(diff) });
            deltaCls = "shot-delta-down";
            deltaTxt = "↓ " + Math.abs(diff);
          } else if (diff > 0) {
            deltaCls = "shot-delta-up";
            deltaTxt = "↑ " + diff;
          } else {
            deltaTxt = "— 持平";
          }
        } else {
          deltaTxt = v === null ? "无数据" : "首次";
        }
        cells += '<td><div class="shot-val">' + valStr + '</div><div class="' + deltaCls + '">' + deltaTxt + '</div></td>';
      });
      rows += '<tr class="' + (hasDown ? "shot-row-down" : "") + '">' + cells + '</tr>';
      if (hasDown) {
        var worst = downTexts.reduce(function (a, b) { return b.diff > a.diff ? b : a; }, downTexts[0]);
        todoItems.push({ name: shop.name, detail: downTexts.map(function (d) { return d.label + " ↓ " + d.diff; }).join("、"), worst: worst });
      }
    });
    var summaryTxt = (draft.summary || "").trim();
    var feedbackTxt = (draft.feedback || "").trim();
    var weekFocusTxt = (draft.weekFocus || "").trim();
    var tomorrowTxt = (draft.tomorrow || "").trim();
    // 明日待办（对齐老版 shot-todo-grid）
    var todoHtml = "";
    if (todoItems.length) {
      todoHtml = '<div class="shot-todo-grid">' + todoItems.map(function (item) {
        var worstTxt = item.worst.label === "转化率" ? "优先调优转化话术" :
          (item.worst.label === "生成率" ? "优先调优生成话术" :
          (item.worst.label === "风控率" ? "复核高风险拦截配置" : "优先调优采纳话术"));
        return '<div class="shot-todo-item"><div class="shot-todo-tag">' + esc(item.name) + '</div>' +
          '<div class="shot-todo-detail">' + esc(item.detail) + '</div>' +
          (item.worst.diff >= 3 ? '<div class="shot-todo-priority">' + worstTxt + '</div>' : '') +
          '</div>';
      }).join("") + '</div>';
    } else {
      todoHtml = '<div class="shot-todo-empty">今日重点店铺指标均未下降，无明日调优重点</div>';
    }
    // 本周重点: 仅当编辑页有填写才渲染(避免空 card 撑高布局)
    var weekFocusHtml = weekFocusTxt
      ? '<div class="shot-week-focus"><span class="shot-week-focus-label">本周重点</span>' + esc(weekFocusTxt) + '</div>'
      : '';
    // 明日待办(用户补充): 仅当编辑页有填写才追加在自动分析下方
    var tomorrowUserHtml = tomorrowTxt
      ? '<div class="shot-todo-user"><span class="shot-todo-user-label">远山补充</span>' + esc(tomorrowTxt) + '</div>'
      : '';
    return '<div class="report-paper">' +
      '<div class="shot-hero"><div class="shot-hero-top">' +
        '<div class="shot-hero-left">' +
          '<div class="shot-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></div>' +
          '<div><div class="shot-title">每日工作日报</div><div class="shot-subtitle">客服 AI 训练师 · ' + todayKey() + '（' + weekdayLabel(todayKey()) + '）</div></div>' +
        '</div>' +
        '<div class="shot-meta"><span>姓名：远山</span><span>重点店铺：' + shops.length + ' 家</span></div>' +
      '</div></div>' +
      '<div class="shot-body"><div class="shot-layout">' +
        '<div class="shot-card">' +
          '<div class="shot-card-top"><div class="shot-card-head">重点店铺核心指标</div><div class="shot-note">数据截至 ' + key + '（昨日）</div></div>' +
          '<table class="shot-table"><thead><tr><th>店铺</th><th>采纳率</th><th>生成率</th><th>风控率</th><th>转化率</th><th>纯智能体占比</th></tr></thead><tbody>' +
          (rows || '<tr><td colspan="6" style="text-align:center;color:#9aa19b">暂无数据</td></tr>') +
          '</tbody></table>' +
        '</div>' +
        '<div class="shot-layout-right">' +
          '<div class="shot-card flex1"><div class="shot-card-head">当日配置总结</div>' +
            '<div class="shot-text">' + fmtShotText(summaryTxt) + '</div></div>' +
          '<div class="shot-card flex1"><div class="shot-card-head">问题反馈</div>' +
            '<div class="shot-text shot-text-para">' + fmtShotText(feedbackTxt, true) + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="shot-todo-card"><div class="shot-card-head">明日待办 · 调优重点</div>' + todoHtml + tomorrowUserHtml + '</div>' +
      weekFocusHtml +
      '</div>' +
      '<div class="shot-footer">— 远山工作台 出品 —</div>' +
      '</div>';
  }
  function showReportModal() {
    var modal = $id("reportModal");
    var content = $id("reportModalContent");
    if (!modal || !content) { return; }
    content.innerHTML = buildReportShotHtml();
    modal.hidden = false;
  }
  function hideReportModal() {
    var modal = $id("reportModal");
    if (modal) { modal.hidden = true; }
  }

  /* ---------- 店铺库视图 ---------- */
  function shopKey(shop) { return shop && shop.key === true; }

  function renderRoster() {
    var view = $id("shopRosterView");
    if (!view) { return; }
    var shops = shopLibrary.slice().sort(function (a, b) { return (shopKey(b) ? 1 : 0) - (shopKey(a) ? 1 : 0); });
    var shown = shops;
    if (shopsSearchQuery) {
      var q = shopsSearchQuery.toLowerCase();
      shown = shown.filter(function (s) { return (s.name || "").toLowerCase().indexOf(q) >= 0 || (s.owner || "").toLowerCase().indexOf(q) >= 0; });
    }
    if (!shown.length) {
      view.innerHTML = '<div class="wb-empty-hint">' + (shopsSearchQuery ? "未找到匹配店铺" : "暂无店铺，点击右上角「添加店铺」") + '</div>';
      return;
    }
    var key = currentDateKey || todayKey();
    view.innerHTML = '<div class="shop-card-grid">' + shown.map(function (shop) {
      var isKey = shopKey(shop);
      return '<div class="shop-card' + (isKey ? " key-shop" : "") + '" data-shop-id="' + esc(shop.id) + '">' +
        '<div class="shop-card-head"><span class="wb-shop-name">' + esc(shop.name) + '</span>' +
        '<button class="shop-key-toggle' + (isKey ? " on" : "") + '" data-action="toggle-key" title="点击切换是否为重点店铺">' +
        (isKey ? "★ 重点" : "☆ 重点") + '</button></div>' +
        '<div class="shop-card-meta"><span>负责人：' + esc(shop.owner || "—") + '</span></div>' +
        '<div class="shop-card-actions">' +
        '<button class="pill-btn quiet sync-shop-btn" data-action="sync-shop" title="单独同步该店铺的探域数据(最近3天)">同步 ↻</button>' +
        '<button class="pill-btn quiet" data-action="edit-shop">编辑</button>' +
        '<button class="pill-btn quiet" data-action="daily-shop">昨日数据</button>' +
        '<button class="pill-btn quiet" data-action="remove-shop">移除</button>' +
        '</div></div>';
    }).join("") + '</div>';
  }

  function renderShopDaily() {
    var view = $id("shopDailyView");
    if (!view) { return; }
    // 数据录入：默认昨天，可通过日期选择器切换到任意一天
    var defaultKey = yesterdayKeyOf(todayKey());
    var key = /^\d{4}-\d{2}-\d{2}$/.test(shopsDailyDate) ? shopsDailyDate : defaultKey;
    var shop = null;
    if (selectedShopId) {
      shop = shopLibrary.filter(function (s) { return s.id === selectedShopId; })[0] || null;
    }
    if (!shop) { shop = shopLibrary[0] || null; }
    if (!shop) { view.innerHTML = '<div class="wb-empty-hint">暂无店铺</div>'; return; }
    selectedShopId = shop.id;
    // 只读访问, 不在打开时创建空天数记录(避免点一下历史日期就多出一条脏 day)
    var curDay = state.days[key];
    var sd = (curDay && curDay.shopData && curDay.shopData[shop.id]) || {};
    var sel = '<select class="pill-btn quiet" id="shopDailySelect" style="background:var(--panel-2);border:1px solid var(--line);color:var(--text);padding:6px 10px;border-radius:9px;font-size:12px">' +
      shopLibrary.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === shop.id ? " selected" : "") + '>' + esc(s.name) + '</option>'; }).join("") +
      '</select>';
    var dateEl = '<input type="date" id="shopDailyDate" class="wb-date-input" value="' + key + '" max="' + todayKey() + '">';
    var rows = SHOP_METRICS.map(function (m) {
      var v = sd[m.key] !== undefined ? sd[m.key] : "";
      return '<div class="shop-input-row"><label>' + m.label + '</label><input type="number" step="0.01" data-metric="' + m.key + '" value="' + esc(v) + '"></div>';
    }).join("");
    view.innerHTML = '<div class="wb-card" style="max-width:640px">' +
      '<h3>数据录入 · <span id="shopDailyDateLabel">' + key + '</span></h3>' +
      '<p class="wb-card-sub">' + esc(shop.name) + '（' + esc(shop.owner || "远山") + '）' + (key === defaultKey ? '' : ' · 补录历史日期') + '</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px">' + dateEl + sel +
      '<button class="pill-btn quiet" id="shopDailyToday" type="button">回到昨天</button></div>' + rows +
      '<div class="shop-card-actions" style="margin-top:12px">' +
      '<button class="pill-btn primary" id="shopDailySave">保存数据</button>' +
      '<button class="pill-btn quiet" id="shopDailyClear">清空</button>' +
      '</div></div>';
    var dateInput = $id("shopDailyDate");
    if (dateInput) {
      dateInput.onchange = function () {
        var v = dateInput.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { return; }
        if (v > todayKey()) { v = todayKey(); }
        shopsDailyDate = v;
        renderShopDaily();
      };
      dateInput.oninput = dateInput.onchange; // 部分浏览器拖动选择即触发
    }
    var backBtn = $id("shopDailyToday");
    if (backBtn) {
      backBtn.onclick = function () { shopsDailyDate = ""; renderShopDaily(); };
    }
    var select = $id("shopDailySelect");
    if (select) {
      select.onchange = function () { selectedShopId = select.value; renderShopDaily(); };
    }
    var saveBtn = $id("shopDailySave");
    if (saveBtn) {
      saveBtn.onclick = function () {
        var metrics = {};
        Array.prototype.forEach.call(view.querySelectorAll("[data-metric]"), function (input) {
          metrics[input.dataset.metric] = input.value.trim() === "" ? "" : parseFloat(input.value);
        });
        var d = dayData(key);
        d.shopData[shop.id] = Object.assign({}, d.shopData[shop.id] || {}, metrics);
        wbSave(true);
        renderRoster();
        toast("已保存 " + shop.name + " " + key + " 的数据");
        renderShopDaily();
      };
    }
    var clearBtn = $id("shopDailyClear");
    if (clearBtn) {
      clearBtn.onclick = function () {
        dayData(key).shopData[shop.id] = {};
        wbSave(true);
        renderShopDaily();
        toast("已清空 " + key);
      };
    }
  }

  function wbRenderShops() {
    if (!wbReady) { wbLoad().then(function () { renderShopsInternal(); }); return; }
    renderShopsInternal();
  }
  function renderShopsInternal() {
    var tabs = document.querySelectorAll(".shop-tab");
    Array.prototype.forEach.call(tabs, function (t) {
      t.classList.toggle("active", t.dataset.shopTab === shopsTab);
    });
    $id("shopRosterView").hidden = shopsTab !== "roster";
    $id("shopDailyView").hidden = shopsTab !== "daily";
    if (shopsTab === "roster") { renderRoster(); }
    else if (shopsTab === "daily") { renderShopDaily(); }
  }

  /* ---------- 数据总览视图 ---------- */
  var sumMetric = "agenticMsgCount";
  var sumRange = "month"; // 7 | 30 | month
  var sumShopId = null;
  var sumDates = [];      // 当前图表日期序列（供 hover 使用）
  var sumShopCurrent = null; // 当前图表店铺（供 hover 使用）

  // 2026-10-02 口径调整: 改为抓取/展示 4 个计数 + 纯智占比 + 3分钟人工回复率 + 消费者服务体验分
  //   type: count=计数(整数,千分位) / pct=百分比 / score=分数
  var SUMMARY_METRICS = [
    { key: "agenticMsgCount", label: "Agentic咨询消息数", type: "count" },
    { key: "genCount", label: "话术生成数", type: "count" },
    { key: "adoptCount", label: "话术采纳数", type: "count" },
    { key: "riskCount", label: "风控数", type: "count" },
    { key: "pureAgentRatio", label: "纯智能体占比", type: "pct" },
    { key: "threeMinReplyRate", label: "3分钟人工回复率", type: "pct" },
    { key: "experienceScore", label: "消费者服务体验分", type: "score" }
  ];

  function sumMetricType(key) {
    var m = SUMMARY_METRICS.filter(function (x) { return x.key === key; })[0];
    return m ? (m.type || "pct") : "pct";
  }
  function sumFmt(v, key) {
    if (v === null || v === undefined || isNaN(v)) { return "—"; }
    var t = sumMetricType(key);
    if (t === "count") { return Math.round(v).toLocaleString("en-US"); }
    if (t === "score") { return String(Math.round(v * 100) / 100); }
    return (Math.round(v * 100) / 100) + "%";
  }

  function summaryRangeDates() {
    var today = todayKey();
    var out = [];
    if (sumRange === "7") {
      var d = fromKey(today);
      for (var i = 6; i >= 0; i--) {
        var t = new Date(d); t.setDate(d.getDate() - i);
        var k = toKey(t);
        if (state.days[k] && Object.keys((state.days[k].shopData) || {}).length) { out.push(k); }
      }
    } else if (sumRange === "30") {
      var d2 = fromKey(today);
      for (var i2 = 29; i2 >= 0; i2--) {
        var t2 = new Date(d2); t2.setDate(d2.getDate() - i2);
        var k2 = toKey(t2);
        if (state.days[k2] && Object.keys((state.days[k2].shopData) || {}).length) { out.push(k2); }
      }
    } else {
      // month: 当前有数据的月份（按最新有数据的日期所在月）
      var base = today;
      var keys = Object.keys(state.days).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k) && state.days[k].shopData && Object.keys(state.days[k].shopData).length; }).sort();
      if (keys.length) { base = keys[keys.length - 1]; }
      var y = parseInt(base.slice(0, 4), 10), m = parseInt(base.slice(5, 7), 10);
      var daysIn = new Date(y, m, 0).getDate();
      for (var d3 = 1; d3 <= daysIn; d3++) {
        var k3 = y + "-" + String(m).padStart(2, "0") + "-" + String(d3).padStart(2, "0");
        if (state.days[k3] && state.days[k3].shopData && Object.keys(state.days[k3].shopData).length) { out.push(k3); }
      }
    }
    return out;
  }

  function renderSummarySeg() {
    var seg = $id("sumMetricSeg");
    if (!seg) { return; }
    seg.innerHTML = SUMMARY_METRICS.map(function (m) {
      return '<button data-sum-metric="' + m.key + '" class="' + (m.key === sumMetric ? "active" : "") + '">' + m.label + '</button>';
    }).join("");
    Array.prototype.forEach.call(seg.querySelectorAll("[data-sum-metric]"), function (b) {
      b.addEventListener("click", function () {
        sumMetric = b.dataset.sumMetric;
        renderSummary();
      });
    });
  }

  function summaryChartSvg(metricKey, dates, shop) {
    var W = 720, H = 260, padL = 48, padR = 16, padT = 18, padB = 34;
    var vals = [];
    dates.forEach(function (d) {
      var v = shopMetricVal(d, shop.id, metricKey);
      if (v !== null) { vals.push(v); }
    });
    if (!vals.length) { return '<div class="wb-empty-hint">所选范围暂无数据</div>'; }
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    var span = max - min;
    var xf = function (i) { return dates.length === 1 ? padL + (W - padL - padR) / 2 : padL + ((W - padL - padR) * i) / (dates.length - 1); };
    var yf = function (v) { return padT + (H - padT - padB) * (1 - (v - min) / span); };
    var mtype = sumMetricType(metricKey);
    var suffix = mtype === "pct" ? "%" : "";
    var axisFmt = function (v) { return mtype === "count" ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 10) / 10); };
    var points = [];
    dates.forEach(function (d, i) {
      var v = shopMetricVal(d, shop.id, metricKey);
      if (v === null) { points.push(null); } else { points.push({ x: xf(i), y: yf(v), v: v }); }
    });
    var lineD = "", dots = "";
    var started = false;
    var accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-400").trim() || "#23e2a0";
    var dotIndex = 0;
    points.forEach(function (p, i) {
      if (!p) { started = false; return; }
      if (!started) { lineD += "M" + p.x.toFixed(1) + "," + p.y.toFixed(1); started = true; }
      else { lineD += " L" + p.x.toFixed(1) + "," + p.y.toFixed(1); }
      var delay = (1.5 + dotIndex * 0.05).toFixed(2);
      dots += '<circle class="sum-dot" style="animation-delay:' + delay + 's" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="3.5" fill="' + accent + '"/>';
      dotIndex += 1;
    });
    var grid = "", labels = "";
    for (var gi = 0; gi <= 4; gi++) {
      var gv = min + (span * gi) / 4;
      var gy = yf(gv).toFixed(1);
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" stroke="var(--line)" stroke-width="1"/>';
      labels += '<text x="' + (padL - 8) + '" y="' + (Number(gy) + 4) + '" text-anchor="end" font-size="12" fill="var(--muted)">' + axisFmt(gv) + suffix + '</text>';
    }
    var step = Math.max(1, Math.ceil(dates.length / 8));
    dates.forEach(function (d, i) {
      if (i % step === 0 || i === dates.length - 1) {
        labels += '<text x="' + xf(i) + '" y="' + (H - 12) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' + d.slice(5) + '</text>';
      }
    });
    var firstPt = null, lastPt = null;
    points.forEach(function (p) { if (p) { if (!firstPt) { firstPt = p; } lastPt = p; } });
    var fontFamily = "-apple-system, BlinkMacSystemFont, 'PingFSystem SC', 'Microsoft YaHei', system-ui, sans-serif";
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="display:block;width:100%;min-height:' + H + 'px;min-width:100%" role="img" text-rendering="geometricPrecision" shape-rendering="geometricPrecision">' +
      '<defs><linearGradient id="sumFill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + accent + '" stop-opacity=".22"/>' +
      '<stop offset="100%" stop-color="' + accent + '" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<g style="font-family:' + fontFamily + '">' + grid + labels + '</g>' +
      (lineD && firstPt && lastPt ? '<path class="sum-area" d="' + lineD + ' L' + lastPt.x.toFixed(1) + ',' + (H - padB) + ' L' + firstPt.x.toFixed(1) + ',' + (H - padB) + ' Z" fill="url(#sumFill)"/>' : '') +
      (lineD ? '<path class="sum-line" pathLength="100" d="' + lineD + '" fill="none" stroke="' + accent + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
      dots +
      '</svg>';
  }

  function renderSummary() {
    if (!wbReady) { return; }
    renderSummarySeg();
    var dates = summaryRangeDates();
    if (!sumShopId) {
      var keyed = shopLibrary.filter(shopKey);
      sumShopId = (keyed[0] || shopLibrary[0] || { id: null }).id;
    }
    var shop = shopLibrary.filter(function (s) { return s.id === sumShopId; })[0] || shopLibrary[0] || null;
    if (!shop) { $id("sumShopList").innerHTML = '<div class="wb-empty-hint">暂无店铺</div>'; return; }
    sumShopId = shop.id;

    // 店铺列表
    var countEl = $id("sumShopCount");
    if (countEl) { countEl.textContent = shopLibrary.length + " 家"; }
    var list = $id("sumShopList");
    list.innerHTML = shopLibrary.slice().sort(function (a, b) { return (shopKey(b) ? 1 : 0) - (shopKey(a) ? 1 : 0); }).map(function (s) {
      return '<button type="button" class="sum-shop-item' + (s.id === shop.id ? " active" : "") + (shopKey(s) ? " key" : "") + '" data-sum-shop="' + esc(s.id) + '">' +
        '<span class="sum-shop-name">' + esc(s.name) + '</span>' +
        (shopKey(s) ? '<span class="shop-key-badge">重点</span>' : '') +
        '</button>';
    }).join("");

    // 图表
    var metric = SUMMARY_METRICS.filter(function (m) { return m.key === sumMetric; })[0] || SUMMARY_METRICS[0];
    var titleEl = $id("sumChartTitle");
    if (titleEl) { titleEl.textContent = metric.label + " · " + (sumRange === "7" ? "近7天" : sumRange === "30" ? "近30天" : "本月") + "趋势"; }
    var rangeEl = $id("sumChartRange");
    if (rangeEl) { rangeEl.textContent = dates.length ? (dates[0] + " ~ " + dates[dates.length - 1]) : "无数据"; }
    var wrap = $id("sumChartWrap");
    wrap.innerHTML = summaryChartSvg(sumMetric, dates, shop);
    sumDates = dates;
    sumShopCurrent = shop;
    bindSummaryHover();

    // 底部信息
    var footer = $id("sumChartFooter");
    var first = null, last = null;
    dates.forEach(function (d) {
      var v = shopMetricVal(d, shop.id, sumMetric);
      if (first === null && v !== null) { first = v; }
      if (v !== null) { last = v; }
    });
    var deltaHtml = "";
    if (first !== null && last !== null) {
      var diff = Math.round((last - first) * 100) / 100;
      var v0 = sumFmt(first, sumMetric), v1 = sumFmt(last, sumMetric);
      var dt = sumMetricType(sumMetric) === "count" ? Math.round(Math.abs(diff)).toLocaleString("en-US") : String(Math.abs(diff));
      deltaHtml = diff > 0
        ? '<span class="wb-delta-up">▲ ' + v0 + " → " + v1 + "（+" + dt + "）</span>"
        : diff < 0
          ? '<span class="wb-delta-down">▼ ' + v0 + " → " + v1 + "（−" + dt + "）</span>"
          : '<span>' + v0 + " → " + v1 + "（持平）</span>";
    } else {
      deltaHtml = '<span>所选范围无数据</span>';
    }
    var snap = SUMMARY_METRICS.map(function (m) {
      var v = shopMetricVal(dates[dates.length - 1] || todayKey(), shop.id, m.key);
      return '<span class="shop-mini-metric">' + m.label + ' <b>' + sumFmt(v, m.key) + '</b></span>';
    }).join("");
    footer.innerHTML = '<div class="sum-delta">' + deltaHtml + '</div><div class="shop-card-metrics">' + snap + '</div>';
  }

  /* 折线图悬停：划过日期点显示该日期的店铺数据 */
  function bindSummaryHover() {
    var wrap = $id("sumChartWrap");
    if (!wrap) { return; }
    wrap.style.position = "relative";
    // 每次重绘都重建 tooltip 浮层（renderSummary 的 innerHTML 重绘会清掉旧的）
    var tip = document.createElement("div");
    tip.className = "sum-tooltip";
    tip.style.display = "none";
    wrap.appendChild(tip);
    // 事件只绑定一次（用独立标记，避免与 tooltip 重建冲突）
    if (wrap.dataset.hoverEventsBound) { return; }
    wrap.dataset.hoverEventsBound = "1";
    wrap.addEventListener("mousemove", function (e) {
      var tip = wrap.querySelector(".sum-tooltip");
      if (!tip) { return; }
      var svg = wrap.querySelector("svg");
      if (!svg || !sumDates.length || !sumShopCurrent) { tip.style.display = "none"; return; }
      var r = svg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right) { tip.style.display = "none"; return; }
      var W = 720, padL = 48, padR = 16, padB = 34;
      var drawW = W - padL - padR;
      var ratio = (e.clientX - r.left) / r.width;
      var drawX = padL + drawW * ratio;
      // 找最近的日期索引
      var best = 0, bestDist = Infinity;
      sumDates.forEach(function (d, i) {
        var x = sumDates.length === 1 ? padL + drawW / 2 : padL + drawW * i / (sumDates.length - 1);
        var dist = Math.abs(x - drawX);
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      var dateKey = sumDates[best];
      var v = shopMetricVal(dateKey, sumShopCurrent.id, sumMetric);
      var metric = SUMMARY_METRICS.filter(function (m) { return m.key === sumMetric; })[0] || SUMMARY_METRICS[0];
      tip.innerHTML =
        '<div class="sum-tip-date">' + dateKey + ' · ' + esc(sumShopCurrent.name) + '</div>' +
        '<div class="sum-tip-val">' + esc(metric.label) + '：<b>' + sumFmt(v, sumMetric) + '</b></div>';
      // 位置跟随鼠标，限定在 wrap 内
      var tipW = 222;
      var left = e.clientX - wrap.getBoundingClientRect().left - tipW / 2;
      left = Math.max(4, Math.min(left, wrap.clientWidth - tipW - 4));
      var top = e.clientY - wrap.getBoundingClientRect().top - 62;
      top = Math.max(4, top);
      tip.style.left = left + "px";
      tip.style.top = top + "px";
      tip.style.display = "block";
    });
    wrap.addEventListener("mouseleave", function () {
      var tip = wrap.querySelector(".sum-tooltip");
      if (tip) { tip.style.display = "none"; }
    });
  }

  function wbRenderSummary() {
    if (!wbReady) { wbLoad().then(function () { renderSummary(); }); return; }
    renderSummary();
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    // 今日工作台
    var prevDay = $id("wbPrevDay"), nextDay = $id("wbNextDay"), todayBtn = $id("wbTodayBtn");
    var setDate = function (key) { currentDateKey = key; calYear = null; calMonth = null; wbRenderToday(); };
    if (prevDay) { prevDay.onclick = function () { var d = fromKey(currentDateKey || todayKey()); d.setDate(d.getDate() - 1); setDate(toKey(d)); }; }
    if (nextDay) { nextDay.onclick = function () { var d = fromKey(currentDateKey || todayKey()); d.setDate(d.getDate() + 1); setDate(toKey(d)); }; }
    if (todayBtn) { todayBtn.onclick = function () { currentDateKey = todayKey(); calYear = null; calMonth = null; wbRenderToday(); }; }
    // 日历导航
    var calPrev = $id("wbCalPrev"), calNext = $id("wbCalNext");
    if (calPrev) { calPrev.onclick = function () { calMonth -= 1; if (calMonth < 0) { calMonth = 11; calYear -= 1; } renderCalendar(); }; }
    if (calNext) { calNext.onclick = function () { calMonth += 1; if (calMonth > 11) { calMonth = 0; calYear += 1; } renderCalendar(); }; }
    // 日历点击（事件委托）
    var calGrid = $id("wbCalGrid");
    if (calGrid) {
      calGrid.addEventListener("click", function (e) {
        var btn = e.target.closest(".wb-cal-day[data-date]");
        if (!btn) { return; }
        var key = btn.dataset.date;
        var parts = key.split("-").map(Number);
        calYear = parts[0]; calMonth = parts[1] - 1;
        setDate(key);
      });
    }
    // 班次设置（事件委托）
    var shiftBar = document.querySelector(".wb-shift-toolbar");
    if (shiftBar) {
      shiftBar.addEventListener("click", function (e) {
        var btn = e.target.closest(".shift-btn");
        if (!btn) { return; }
        var key = currentDateKey || todayKey();
        state.shifts[key] = btn.dataset.shift;
        wbSave(true);
        renderCalendar();
        toast("已设置班次：" + (SHIFT_LABELS[btn.dataset.shift] || "无"));
      });
    }
    // 任务状态（事件委托）
    var taskWrap = $id("wbTaskGroups");
    if (taskWrap) {
      taskWrap.addEventListener("click", function (e) {
        var btn = e.target.closest(".wb-seg-btn");
        if (!btn) { return; }
        var key = currentDateKey || todayKey();
        taskData(key, btn.dataset.task).status = btn.dataset.status;
        wbSave(false);
        renderTasks();
      });
    }
    // 日报操作
    var genBtn = $id("reportGenBtn");
    if (genBtn) { genBtn.onclick = function () { wbRenderReport(); showReportModal(); }; }
    // 弹窗关闭（遮罩 + 关闭按钮）
    document.querySelectorAll("[data-modal-close]").forEach(function (el) {
      el.addEventListener("click", hideReportModal);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { hideReportModal(); }
    });
    var wbCopyReport = $id("wbCopyReportBtn");
    if (wbCopyReport) { wbCopyReport.onclick = function () { copyTextToClipboard(collectReportText()); }; }
    var copyBtn = $id("reportCopyBtn");
    if (copyBtn) { copyBtn.onclick = function () { copyTextToClipboard(collectReportText()); }; }
    var copyImgBtn = $id("reportCopyImgBtn");
    if (copyImgBtn) { copyImgBtn.onclick = function () { reportImage(function (canvas) { canvas.toBlob(function (blob) { copyBlob(blob); }); }); }; }
    var dlImgBtn = $id("reportDownloadImgBtn");
    if (dlImgBtn) { dlImgBtn.onclick = function () { reportImage(function (canvas) { var a = document.createElement("a"); a.href = canvas.toDataURL("image/png"); a.download = "日报-" + (currentDateKey || todayKey()) + ".png"; a.click(); }); }; }
    var csvBtn = $id("reportExportCsvBtn");
    if (csvBtn) { csvBtn.onclick = exportCsv; }
    // 店铺库
    var tabs = document.querySelectorAll(".shop-tab");
    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener("click", function () { shopsTab = t.dataset.shopTab; renderShopsInternal(); });
    });
    // ---- 新增店铺弹窗（店铺信息 + 拼多多账号密码） ----
    var SHOP_LOCAL_BASE = "http://10.10.12.157:8080";
    var pddAccountCache = []; // 本地同步服务账号列表缓存(GET /pdd-account)
    var shopModal = $id("shopModal");
    function shopModalOpen() {
      if (!shopModal) { return; }
      var nameEl = $id("shopNameInput"), ownerEl = $id("shopOwnerInput"),
          acctEl = $id("shopPddAccountInput"), pwdEl = $id("shopPddPasswordInput"),
          hintEl = $id("shopModalHint");
      [nameEl, acctEl, pwdEl].forEach(function (el) { if (el) { el.value = ""; } });
      if (ownerEl) { ownerEl.value = "远山"; }
      if (hintEl) { hintEl.hidden = true; hintEl.textContent = ""; }
      shopModal.hidden = false;
      nameEl && nameEl.focus();
      // 拉取本地同步服务的账号列表(用于已存在账号时自动填充提示), 失败静默
      try {
        fetch(SHOP_LOCAL_BASE + "/pdd-account", { method: "GET" }).then(function (r) { return r.json(); }).then(function (res) {
          pddAccountCache = (res && res.ok && Array.isArray(res.accounts)) ? res.accounts : [];
        }).catch(function () { pddAccountCache = []; });
      } catch (e) { pddAccountCache = []; }
    }
    function shopModalClose() { if (shopModal) { shopModal.hidden = true; } }
    // 店铺名输入时, 若本地已有该店账号则自动填充(供更新/沿用)
    var shopNameInput = $id("shopNameInput");
    if (shopNameInput) {
      shopNameInput.addEventListener("input", function () {
        var hintEl = $id("shopModalHint"), acctEl = $id("shopPddAccountInput"), pwdEl = $id("shopPddPasswordInput");
        if (!hintEl) { return; }
        var name = shopNameInput.value.trim();
        var norm = function (s) { return String(s || "").replace(/娟娟|运营|客服|小号/g, "").replace(/\s+/g, ""); };
        var hit = pddAccountCache.filter(function (a) { return a && norm(a.cloudName) === norm(name); })[0];
        if (hit) {
          hintEl.textContent = "该店已有拼多多账号（idx " + hit.idx + "），确认后仅更新填写的字段";
          hintEl.hidden = false;
          if (acctEl && !acctEl.value) { acctEl.value = hit.account || ""; }
          if (pwdEl && !pwdEl.value && hit.password) { pwdEl.value = hit.password; }
        } else {
          hintEl.hidden = true;
        }
      });
    }
    var addBtn = $id("addShopBtn");
    if (addBtn) { addBtn.onclick = shopModalOpen; }
    var shopModalConfirm = $id("shopModalConfirm");
    if (shopModalConfirm) {
      shopModalConfirm.onclick = function () {
        var nameEl = $id("shopNameInput"), ownerEl = $id("shopOwnerInput"),
            acctEl = $id("shopPddAccountInput"), pwdEl = $id("shopPddPasswordInput");
        var name = nameEl ? nameEl.value.trim() : "";
        if (!name) { toast("请填写店铺名称"); nameEl && nameEl.focus(); return; }
        var account = acctEl ? acctEl.value.trim() : "";
        var password = pwdEl ? pwdEl.value : "";
        var owner = ownerEl ? ownerEl.value.trim() : "";
        // 1) 有账号信息则写入本地同步服务 pdd-accounts.json（upsert; 失败不阻断店铺入库）
        var saveAcct = null;
        if (account || password) {
          var body = { cloudName: name };
          if (account) { body.account = account; }
          if (password) { body.password = password; }
          saveAcct = fetch(SHOP_LOCAL_BASE + "/pdd-account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
          }).then(function (r) { return r.json(); }).then(function (res) {
            if (res && res.ok) {
              toast(res.isNew ? "拼多多账号已登记（idx " + res.idx + "）" : "拼多多账号已更新");
              return true;
            }
            toast("账号保存失败：" + ((res && res.error) || "未知错误"));
            return false;
          }).catch(function () {
            toast("本地同步服务未连接，拼多多账号未保存");
            return false;
          });
        }
        // 2) 入库店铺库(云端)
        var id = "s" + (shopLibrary.length + 1);
        while (shopLibrary.some(function (s) { return s.id === id; })) { id += "x"; }
        shopLibrary.push({ id: id, name: name, owner: owner || "远山", adoptionRate: "", generationRate: "", conversionRate: "", pureAgentRatio: "", experienceScore: "", note: "" });
        wbSave(true);
        renderRoster();
        shopModalClose();
        if (saveAcct) {
          // 等账号保存完成后再提示主结果(避免 toast 被覆盖)
          saveAcct.then(function () { toast("已添加店铺「" + name + "」"); });
        } else {
          toast("已添加店铺「" + name + "」" + (account || password ? "" : "（未填账号，拼多多同步将跳过）"));
        }
      };
    }
    // 弹窗关闭(遮罩 + 关闭按钮 + Esc)
    document.querySelectorAll("[data-shop-modal-close]").forEach(function (el) {
      el.addEventListener("click", shopModalClose);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && shopModal && !shopModal.hidden) { shopModalClose(); }
    });
    var searchInput = $id("shopSearchInput");
    if (searchInput) {
      searchInput.oninput = function () { shopsSearchQuery = searchInput.value.trim(); renderRoster(); };
    }
    // 店铺卡片操作（事件委托）
    var roster = $id("shopRosterView");
    if (roster) {
      roster.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-action]");
        if (!btn) { return; }
        var card = btn.closest(".shop-card");
        var shopId = card && card.dataset.shopId;
        var shop = shopLibrary.filter(function (s) { return s.id === shopId; })[0];
        var action = btn.dataset.action;
        if (action === "toggle-key" && shop) {
          shop.key = shop.key === true ? false : true;
          wbSave(true);
          renderRoster();
        } else if (action === "edit-shop" && shop) {
          var name = prompt("店铺名称：", shop.name);
          if (name !== null && name.trim()) { shop.name = name.trim(); wbSave(true); renderRoster(); }
        } else if (action === "daily-shop" && shop) {
          selectedShopId = shop.id;
          shopsTab = "daily";
          renderShopsInternal();
        } else if (action === "remove-shop" && shop) {
          if (confirm("确定移除店铺「" + shop.name + "」？")) {
            shopLibrary = shopLibrary.filter(function (s) { return s.id !== shopId; });
            wbSave(true);
            renderRoster();
          }
        } else if (action === "sync-shop" && shop) {
          // 单店同步: 打开本地服务 /sync-shop?idx=店名
          toast("正在同步「" + shop.name + "」…");
          var base = "http://10.10.12.157:8080";
          try { window.open(base + "/sync-shop?idx=" + encodeURIComponent(shop.name), "_blank"); }
          catch (err) { toast("无法打开同步页(本地服务可能未启动)"); }
        }
      });
    }
    // 数据总览：店铺切换（事件委托）
    var sumList = $id("sumShopList");
    if (sumList) {
      sumList.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-sum-shop]");
        if (!btn) { return; }
        sumShopId = btn.dataset.sumShop;
        renderSummary();
      });
    }
    // 数据总览：时间范围
    Array.prototype.forEach.call(document.querySelectorAll(".sum-range"), function (b) {
      b.addEventListener("click", function () {
        sumRange = b.dataset.range;
        Array.prototype.forEach.call(document.querySelectorAll(".sum-range"), function (x) { x.classList.toggle("active", x === b); });
        renderSummary();
      });
    });
    // 同步按钮（顶部与详情面板）
    var syncBtns = document.querySelectorAll("[data-wb-sync]");
    Array.prototype.forEach.call(syncBtns, function (b) {
      b.addEventListener("click", function () {
        window.open("http://10.10.12.157:8080/sync", "_blank");
      });
    });
  }

  function copyBlob(blob) {
    try {
      navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(function () {
        toast("图片已复制");
      }, function () { toast("复制图片失败，可改用下载图片"); });
    } catch (e) { toast("复制图片失败，可改用下载图片"); }
  }

  function loadHtml2canvas() {
    if (window.html2canvas) { return; }
    var s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    document.head.appendChild(s);
  }

  /* ---------- 同步状态轮询: 同步进行中显示浮动条(可一键取消) ---------- */
  function initSyncStatusPoll() {
    if (IS_MIRROR) { return; } // 镜像模式: 无内网同步服务, 跳过轮询
    var bar = $id("syncStatusBar");
    if (!bar || window.__syncPollStarted) { return; }
    window.__syncPollStarted = true;
    var SYNC_HOST = "http://10.10.12.157:8080";
    var taskEl = $id("syncStatusTask");
    var cancelBtn = $id("syncCancelBtn");
    function poll() {
      fetch(SYNC_HOST + "/sync-status", { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (s) {
          if (s && s.busy) {
            if (taskEl) { taskEl.textContent = s.task || "同步任务"; }
            if (cancelBtn) { cancelBtn.style.display = s.cancelable ? "" : "none"; }
            bar.hidden = false;
          } else {
            bar.hidden = true;
          }
        })
        .catch(function () { bar.hidden = true; });
    }
    if (cancelBtn) {
      cancelBtn.onclick = function () {
        window.open(SYNC_HOST + "/sync-cancel", "_blank");
        toast("正在取消同步…");
      };
    }
    poll();
    setInterval(poll, 5000);
  }

  /* ---------- 初始化 ---------- */
  function wbInit() {
    if (wbReady) { return; }
    wbLoad().then(function () {
      if (!currentDateKey) { currentDateKey = todayKey(); }
      bindEvents();
      initSyncStatusPoll();
      loadHtml2canvas();
    });
  }

  window.wbInit = wbInit;
  window.wbRenderToday = wbRenderToday;
  window.wbRenderReport = wbRenderReport;
  window.wbRenderShops = wbRenderShops;
  window.wbRenderSummary = wbRenderSummary;

  /* ---------- 待绑商品视图(形态A只读) ---------- */
  var GROUPS_HOST = "http://10.10.12.157:8080";
  var groupsCache = null;        // { meta, list }
  var groupsTab = "bindable";
  var groupsQuery = "";
  var groupsBound = false;
  var groupsLoading = false;

  function groupsLoad() {
    if (groupsLoading) { return Promise.resolve(); }
    groupsLoading = true;
    var el = $id("groupsMeta");
    if (el) { el.textContent = "加载中…"; }
    return fetch(GROUPS_HOST + "/tanyu-groups?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        groupsCache = res || { meta: {}, list: [] };
        groupsLoading = false;
        if (el) {
          var m = groupsCache.meta || {};
          el.textContent = (m.generatedAt ? ("生成 " + m.generatedAt + " · ") : "") + (m.total != null ? ("共 " + m.total + " 条") : "每日巡检清单（只读）");
        }
        renderGroupsTable();
      })
      .catch(function () {
        groupsLoading = false;
        groupsCache = null;
        if (el) { el.textContent = "加载失败 · 请确认同步服务(10.10.12.157:8080)已启动"; }
        showGroupsEmpty("加载失败 · 同步服务未启动或无清单数据");
      });
  }

  function groupsSectionOf(r) {
    if (r.section) { return r.section; }
    var g = (r.suggestedGroup || r.targetGroup || "").toLowerCase();
    var nm = (r.name || r.realName || "").toLowerCase();
    if (r.bindable === true || r.zone === "green") { return "bindable"; }
    if (/dirty|脏|残括|未闭合/.test(g + " " + nm)) { return "dirty"; }
    if (r.zone === "white" || /需建|新组|无既有组|无匹配|待建/.test(g + " " + nm)) { return "newgroup"; }
    return "pending";
  }

  function groupsCounts() {
    var c = { bindable: 0, pending: 0, dirty: 0, newgroup: 0 };
    var list = (groupsCache && groupsCache.list) || [];
    list.forEach(function (r) { var s = groupsSectionOf(r); if (c[s] == null) { c[s] = 0; } c[s]++; });
    return c;
  }

  function bindGroupsEvents() {
    if (groupsBound) { return; }
    groupsBound = true;
    var tabs = document.querySelectorAll("#groupsTabs .gtab-btn");
    Array.prototype.forEach.call(tabs, function (t) {
      t.addEventListener("click", function () {
        groupsTab = t.dataset.gtab;
        Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle("active", x === t); });
        renderGroupsTable();
      });
    });
    var si = $id("groupsSearchInput");
    if (si) {
      si.addEventListener("input", function () { groupsQuery = si.value.trim().toLowerCase(); renderGroupsTable(); });
    }
    var rb = $id("groupsRefreshBtn");
    if (rb) { rb.addEventListener("click", function () { groupsLoad(); }); }
  }

  function showGroupsEmpty(msg) {
    var e = $id("groupsEmpty");
    var t = $id("groupsTable");
    if (e) { e.hidden = false; e.textContent = msg || "暂无数据"; }
    if (t) { t.hidden = true; }
    var fc = $id("groupsCount");
    if (fc) { fc.textContent = ""; }
  }

  function renderGroupsTable() {
    bindGroupsEvents();
    var empty = $id("groupsEmpty");
    var table = $id("groupsTable");
    var body = $id("groupsBody");
    var count = $id("groupsCount");
    var list = (groupsCache && groupsCache.list) || [];
    if (!list.length) {
      showGroupsEmpty("暂无数据 · 点击右上角「刷新」加载每日巡检清单");
      return;
    }
    var q = groupsQuery;
    var filtered = list.filter(function (r) {
      if (groupsSectionOf(r) !== groupsTab) { return false; }
      if (!q) { return true; }
      return ((r.title || "") + " " + (r.shop || "") + " " + (r.name || "") + " " + (r.suggestedGroup || "")).toLowerCase().indexOf(q) >= 0;
    });
    var counts = groupsCounts();
    if (empty) { empty.hidden = true; }
    if (table) { table.hidden = false; }
    if (count) {
      count.textContent = "当前区 " + filtered.length + " 条 ｜ 可直绑 " + counts.bindable + " · 待拍板 " + counts.pending + " · 脏组 " + counts.dirty + " · 需建新组 " + counts.newgroup;
    }
    if (!body) { return; }
    if (!filtered.length) {
      body.innerHTML = "";
      showGroupsEmpty(q ? "无匹配结果" : "当前区暂无商品");
      return;
    }
    body.innerHTML = filtered.map(function (r) {
      var h7 = r.heat7 != null ? r.heat7 : (r.heat7d != null ? r.heat7d : "");
      var h30 = r.heat30 != null ? r.heat30 : (r.heat30d != null ? r.heat30d : "");
      return "<tr>" +
        "<td>" + esc(r.shop || "") + "</td>" +
        '<td class="g-id">' + esc(r.id || r.spuId || "") + "</td>" +
        '<td title="' + esc(r.title || "") + '">' + esc(r.title || "") + "</td>" +
        "<td>" + esc(h7) + "</td>" +
        "<td>" + esc(h30) + "</td>" +
        "<td>" + esc(r.name || r.realName || "") + "</td>" +
        "<td>" + esc(r.suggestedGroup || r.targetGroup || "") + "</td>" +
        "</tr>";
    }).join("");
  }

  function wbRenderGroups() {
    bindGroupsEvents();
    if (!groupsCache) { groupsLoad(); return; }
    renderGroupsTable();
  }

  window.wbRenderGroups = wbRenderGroups;

  /* ============================================================
   * AI 助手（DeepSeek / OpenAI 兼容） 2026-10-26
   * 请求经本机 serve.js 代理，API Key 只存在本机 ai-config.json
   * ============================================================ */
  var AI_LOCAL = (typeof location !== "undefined" && location.protocol === "http:");
  var AI_HOST = AI_LOCAL ? "" : "http://localhost:8080";  // 本地 http 访问走同源；线上 https 只能打 localhost
  var AI_MSG_KEY = "csa-ai-chat-v1";
  var aiCfg = { configured: false, loaded: false };
  var aiMsgs = [];
  var aiBusy = false;
  var aiCfgOpen = false;
  var aiTimer = null;

  var AI_SYS = "你是拼多多多店铺客服 AI 运营助手，服务对象是客服运营负责人。\n" +
    "回答要求：\n" +
    "1. 先给结论，再给依据；数据不足就直接说不确定，禁止编造数字。\n" +
    "2. 判断达标必须严格用给定达标线，并算出差额（例：采纳率 62.10%，距 65% 差 2.90 个点）。\n" +
    "3. 少用形容词，多给可执行动作，建议最多 3 条。\n" +
    "4. 用中文回答，表格优先于长段落。\n\n" +
    "工作台当前数据快照：\n";

  function aiNum(v) {
    if (v === undefined || v === null || v === "") { return null; }
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function aiFmt(v, d) {
    if (v === null || v === undefined) { return "—"; }
    return Number(v).toFixed(d === undefined ? 2 : d);
  }

  function aiAvg(arr) {
    if (!arr.length) { return null; }
    var s = 0;
    for (var i = 0; i < arr.length; i++) { s += arr[i]; }
    return s / arr.length;
  }

  // 把工作台数据压成紧凑文本快照，作为 system 上下文
  function aiContextText() {
    var shops = shopLibrary || [];
    var allD = state.days || {};
    var keys = Object.keys(allD).filter(function (k) { return /^\d{4}-\d{2}-\d{2}$/.test(k); }).sort();
    var recent = keys.slice(-7);
    var out = [];
    out.push("今天：" + todayKey() + "；店铺库：" + shops.length + " 家（★=重点店，由用户手工标记）。");
    out.push("口径：生成率/采纳率/风控率共用分母 = Agentic咨询消息数；纯智能体占比 = auto/(auto+assisted+manual)。");
    out.push("达标线：生成率≥95%、采纳率≥65%、纯智能体占比≥35%、风控率≤15%。");
    out.push("");
    out.push("【各店近 " + recent.length + " 天均值（" + (recent[0] || "-") + " ~ " + (recent[recent.length - 1] || "-") + "）】");
    out.push("店铺|采纳率%|生成率%|纯智%|风控%|3分钟%|体验分(最近值)");
    shops.forEach(function (s) {
      var acc = { adoptionRate: [], generationRate: [], pureAgentRatio: [], riskRate: [], threeMinReplyRate: [] };
      var lastExp = null;
      recent.forEach(function (k) {
        var d = allD[k] && allD[k].shopData && allD[k].shopData[s.id];
        if (!d) { return; }
        Object.keys(acc).forEach(function (f) { var v = aiNum(d[f]); if (v !== null) { acc[f].push(v); } });
        var e = aiNum(d.experienceScore);
        if (e !== null) { lastExp = e; }
      });
      out.push([String(s.name || s.id) + (s.key ? "★" : ""),
        aiFmt(aiAvg(acc.adoptionRate)), aiFmt(aiAvg(acc.generationRate)),
        aiFmt(aiAvg(acc.pureAgentRatio)), aiFmt(aiAvg(acc.riskRate)),
        aiFmt(aiAvg(acc.threeMinReplyRate)), aiFmt(lastExp)].join("|"));
    });
    var tk = todayKey();
    var mk = allD[tk] && allD[tk].shopMarked;
    if (mk && Object.keys(mk).length) {
      out.push("");
      out.push("【今日调优工坊 · 已标记待审核数】" + Object.keys(mk).map(function (k) { return k + " " + mk[k]; }).join("，"));
    }
    return out.join("\n");
  }

  function aiReq(path, body) {
    var opt = {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store"
    };
    if (body !== undefined) { opt.body = JSON.stringify(body); }
    return fetch(AI_HOST + path, opt).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) {
          throw new Error("服务返回非 JSON（" + r.status + "）：" + String(t).slice(0, 120));
        }
        return j;
      });
    }, function (e) {
      throw new Error("连不上本地服务 " + (AI_HOST || location.origin) + "。请确认工作台的同步服务已启动（ai-config.json 所在目录的 serve.js）。原始错误：" + (e && e.message));
    });
  }

  function aiMd(src) {
    function inline(s) {
      return s.replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    }
    var blocks = esc(String(src || "")).split(/\n{2,}/);
    return blocks.map(function (b) {
      var lines = b.split("\n");
      if (/^```/.test(lines[0])) {
        return '<pre class="ai-pre">' + b.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "") + "</pre>";
      }
      if (lines.length >= 2 && /^\s*\|/.test(lines[0]) && /^\s*\|[\s:|\-]+\|?\s*$/.test(lines[1])) {
        function cells(l) {
          return l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return inline(c.trim()); });
        }
        var head = cells(lines[0]);
        var body = lines.slice(2).filter(function (l) { return /\S/.test(l); }).map(cells);
        return '<table class="ai-table"><thead><tr>' +
          head.map(function (c) { return "<th>" + c + "</th>"; }).join("") + "</tr></thead><tbody>" +
          body.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + c + "</td>"; }).join("") + "</tr>"; }).join("") +
          "</tbody></table>";
      }
      if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) {
        return "<ul>" + lines.map(function (l) { return "<li>" + inline(l.replace(/^\s*[-*]\s+/, "")) + "</li>"; }).join("") + "</ul>";
      }
      if (/^#{1,4}\s+/.test(lines[0])) {
        return "<h4>" + inline(lines[0].replace(/^#{1,4}\s+/, "")) + "</h4>" +
          (lines.length > 1 ? "<p>" + inline(lines.slice(1).join("<br>")) + "</p>" : "");
      }
      return "<p>" + inline(lines.join("<br>")) + "</p>";
    }).join("");
  }

  function aiSaveMsgs() {
    try {
      sessionStorage.setItem(AI_MSG_KEY, JSON.stringify(aiMsgs.filter(function (m) { return !m.pending; }).slice(-40)));
    } catch (e) { /* 忽略 */ }
  }

  function aiLoadMsgs() {
    try {
      var raw = sessionStorage.getItem(AI_MSG_KEY);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) { aiMsgs = arr; }
      }
    } catch (e) { /* 忽略 */ }
  }

  function renderAiMessages() {
    var box = $id("aiMessages");
    if (!box) { return; }
    if (!aiMsgs.length) {
      box.innerHTML = '<div class="ai-empty">' +
        "<p>已接入工作台数据（" + (shopLibrary || []).length + " 家店 · 近 7 天指标 · 达标线）。</p>" +
        "<p>可以直接问：某店为什么掉、哪几家没达标、这周该先处理什么。</p>" +
        "</div>";
      return;
    }
    box.innerHTML = aiMsgs.map(function (m) {
      if (m.role === "user") {
        return '<div class="ai-msg ai-msg-user"><div class="ai-bubble">' + esc(m.content).replace(/\n/g, "<br>") + "</div></div>";
      }
      if (m.pending) {
        return '<div class="ai-msg ai-msg-bot"><div class="ai-bubble ai-waiting" id="aiWaiting">正在生成… 0s</div></div>';
      }
      if (m.error) {
        return '<div class="ai-msg ai-msg-bot"><div class="ai-bubble ai-err">' + esc(m.content) + "</div></div>";
      }
      return '<div class="ai-msg ai-msg-bot"><div class="ai-bubble">' + aiMd(m.content) +
        (m.ms ? '<div class="ai-meta">' + esc(m.model || "") + " · " + (m.ms / 1000).toFixed(1) + "s</div>" : "") +
        "</div></div>";
    }).join("");
    box.scrollTop = box.scrollHeight;
  }

  var AI_QUICK = [
    { t: "重点店差距", q: "把重点店（★）按达标线逐项对比，列出没达标的店和差额，最后给 3 条最该先做的动作。" },
    { t: "异常排查", q: "近 7 天里，哪些店出现了指标为 0、缺失、或比前一日骤降 20% 以上的情况？按可能性从高到低说明原因。" },
    { t: "最弱店铺", q: "按采纳率和生成率综合排序，指出最弱的 3 家店，并说明它们各自最拖后腿的是哪个指标。" },
    { t: "今日待办", q: "基于当前数据，今天最值得我优先处理的三件事是什么？每件写清：做什么、为什么、涉及哪几家店。" }
  ];

  function renderAiQuick() {
    var box = $id("aiQuick");
    if (!box) { return; }
    box.innerHTML = AI_QUICK.map(function (q, i) {
      return '<button class="ai-chip" data-ai-q="' + i + '">' + esc(q.t) + "</button>";
    }).join("");
  }

  function aiSetBusy(on) {
    aiBusy = on;
    var btn = $id("aiSend");
    var input = $id("aiInput");
    if (btn) { btn.disabled = on; btn.textContent = on ? "生成中" : "发送"; }
    if (input) { input.disabled = on; }
    if (aiTimer) { clearInterval(aiTimer); aiTimer = null; }
    if (on) {
      var t0 = Date.now();
      aiTimer = setInterval(function () {
        var el = $id("aiWaiting");
        if (el) { el.textContent = "正在生成… " + Math.round((Date.now() - t0) / 1000) + "s"; }
      }, 500);
    }
  }

  function aiAsk(text) {
    if (aiBusy) { return; }
    text = String(text || "").trim();
    if (!text) { return; }
    if (!aiCfg.configured) {
      aiCfgOpen = true;
      renderAiConfigForm();
      toast("请先填写 API Key");
      return;
    }
    var history = aiMsgs.filter(function (m) { return !m.pending && !m.error; })
      .slice(-8).map(function (m) { return { role: m.role, content: m.content }; });
    history.push({ role: "user", content: text });

    aiMsgs.push({ role: "user", content: text });
    aiMsgs.push({ role: "assistant", content: "", pending: true });
    renderAiMessages();
    aiSetBusy(true);
    var t0 = Date.now();

    aiReq("/ai/chat", {
      messages: [{ role: "system", content: AI_SYS + aiContextText() }].concat(history)
    }).then(function (j) {
      if (!j || !j.ok) {
        aiMsgs[aiMsgs.length - 1] = { role: "assistant", content: "调用失败：" + ((j && j.error) || "未知错误"), error: true };
      } else {
        aiMsgs[aiMsgs.length - 1] = { role: "assistant", content: j.content, ms: Date.now() - t0, model: j.model || "" };
      }
      aiSaveMsgs();
      renderAiMessages();
    }).catch(function (e) {
      aiMsgs[aiMsgs.length - 1] = { role: "assistant", content: String(e && e.message || e), error: true };
      renderAiMessages();
    }).then(function () {
      aiSetBusy(false);
    });
  }

  function renderAiConfigForm() {
    var card = $id("aiConfigCard");
    if (!card) { return; }
    card.hidden = !aiCfgOpen;
    var btn = $id("aiConfigToggle");
    if (btn) { btn.textContent = aiCfgOpen ? "收起设置" : "⚙ 接口设置"; }
    if (aiCfg.loaded) {
      if (aiCfg.name) { $id("aiCfgName").value = aiCfg.name; }
      if (aiCfg.baseUrl) { $id("aiCfgBase").value = aiCfg.baseUrl; }
      if (aiCfg.model) { $id("aiCfgModel").value = aiCfg.model; }
      var kEl = $id("aiCfgKey");
      if (kEl && aiCfg.keyMask) { kEl.placeholder = "已保存 " + aiCfg.keyMask + "（留空则沿用）"; }
    }
    var hint = $id("aiCfgHint");
    if (hint) {
      hint.textContent = aiCfg.configured
        ? "已配置：" + (aiCfg.name || "AI") + " · " + (aiCfg.model || "") + " · " + (aiCfg.keyMask || "")
        : "尚未配置。Key 只保存在本机 ai-config.json，不会上传云端。";
    }
    var st = $id("aiStatusText");
    if (st) {
      st.textContent = aiCfg.configured
        ? (aiCfg.name || "AI") + " · " + (aiCfg.model || "") + " · 已读取工作台数据"
        : "未配置接口 · 点右上角「接口设置」填写 Key";
    }
  }

  function loadAiConfig() {
    if (aiCfg.loaded) { return; }
    aiReq("/ai/config").then(function (j) {
      aiCfg = Object.assign({ loaded: true }, j || {});
      aiCfgOpen = !aiCfg.configured;
      renderAiConfigForm();
    }).catch(function (e) {
      aiCfg.loaded = true;
      aiCfgOpen = true;
      renderAiConfigForm();
      var hint = $id("aiCfgHint");
      if (hint) { hint.textContent = e.message; }
    });
  }

  function saveAiConfig() {
    var name = ($id("aiCfgName").value || "").trim() || "DeepSeek";
    var baseUrl = ($id("aiCfgBase").value || "").trim() || "https://api.deepseek.com";
    var model = ($id("aiCfgModel").value || "").trim() || "deepseek-chat";
    var apiKey = ($id("aiCfgKey").value || "").trim();
    var btn = $id("aiCfgSave");
    var old = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "保存中…"; }
    aiReq("/ai/config", { name: name, baseUrl: baseUrl, model: model, apiKey: apiKey })
      .then(function (j) {
        if (!j || !j.ok) { throw new Error((j && j.error) || "保存失败"); }
        aiCfg = Object.assign({ loaded: true }, j);
        var kEl = $id("aiCfgKey");
        if (kEl) { kEl.value = ""; }
        renderAiConfigForm();
        if (btn) { btn.textContent = "测试中…"; }
        return aiReq("/ai/test", {}).then(function (t) {
          if (t && t.ok) {
            aiCfgOpen = false;
            renderAiConfigForm();
            toast("已保存，连接正常（" + (t.reply || "可用") + "）");
          } else {
            toast("已保存，但测试失败：" + ((t && t.error) || "未知"));
          }
        });
      })
      .catch(function (e) { toast(String(e && e.message || e)); })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = old || "保存并测试"; }
      });
  }

  function bindAiEvents() {
    var view = $id("aiView");
    if (!view || view.dataset.aiBound === "1") { return; }
    view.dataset.aiBound = "1";
    $id("aiConfigToggle").onclick = function () { aiCfgOpen = !aiCfgOpen; renderAiConfigForm(); };
    $id("aiCfgSave").onclick = saveAiConfig;
    $id("aiClearBtn").onclick = function () {
      aiMsgs = [];
      aiSaveMsgs();
      renderAiMessages();
      toast("对话已清空");
    };
    $id("aiSend").onclick = function () {
      var input = $id("aiInput");
      aiAsk(input.value);
      input.value = "";
    };
    $id("aiInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        var input = $id("aiInput");
        aiAsk(input.value);
        input.value = "";
      }
    });
    $id("aiQuick").addEventListener("click", function (e) {
      var b = e.target.closest("[data-ai-q]");
      if (!b) { return; }
      var q = AI_QUICK[Number(b.dataset.aiQ)];
      if (q) { aiAsk(q.q); }
    });
  }

  function wbRenderAi() {
    bindAiEvents();
    aiLoadMsgs();
    renderAiMessages();
    renderAiQuick();
    loadAiConfig();
    renderAiConfigForm();
  }

  window.wbRenderAi = wbRenderAi;
  window.wbAiAsk = aiAsk;

  window.wbRefresh = function () { wbReady = false; wbInit(); };
  window.addEventListener("DOMContentLoaded", wbInit);
  if (document.readyState !== "loading") { wbInit(); }
})();
