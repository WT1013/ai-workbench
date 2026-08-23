/* ============================================================
 * workbench.js — 旧工作台功能迁移（今日任务/排班日历/数据指标/日报/店铺库）
 * 贴合新驾驶舱设计：卡片式布局、CSS 变量主题、云端数据同源
 * ============================================================ */
(function () {
  "use strict";

  var CLOUD_URL = "https://kocuowtqklojxkhzlwpe.supabase.co";
  var CLOUD_KEY = "sb_publishable_EinGWbe2S8hHl0kqngnmIg_uyZ5xRnp";
  var STORAGE_KEY = "csa-workbench-v1";

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

  var KEY_SHOPS = [
    "松迅医疗器械专营店", "祥佳健康企业店", "PANAPOPO居家官方旗舰店", "PANAPOPO旗舰店（众创）"
  ];

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
      state.days["__library__"] = { shops: shopLibrary };
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
      state.days["__library__"] = { shops: shopLibrary };
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, days: state.days, shifts: state.shifts }));
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
      var ka = KEY_SHOPS.indexOf(a.name) >= 0 ? 1 : 0;
      var kb = KEY_SHOPS.indexOf(b.name) >= 0 ? 1 : 0;
      return kb - ka;
    }).filter(shopKey);
    var metrics4 = [
      { key: "adoptionRate", label: "采纳率" },
      { key: "generationRate", label: "生成率" },
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
      shopRows += '<tr><td>' + esc(shop.name) + (KEY_SHOPS.indexOf(shop.name) >= 0 ? ' <span class="shop-key-badge">重点</span>' : '') + '</td>' + cells + '</tr>';
    });
    var tableHtml =
      '<div class="wb-report-card">' +
      '<h3>一、重点店铺核心指标（数据截止 ' + key + '）</h3>' +
      '<div class="wb-table-wrap"><table class="wb-report-table"><thead><tr><th>店铺</th><th>采纳率</th><th>生成率</th><th>转化率</th><th>纯智能体占比</th></tr></thead><tbody>' +
      (shopRows || '<tr><td colspan="5" style="color:var(--muted)">今日暂无店铺数据，请先同步</td></tr>') +
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
      var ka = KEY_SHOPS.indexOf(a.name) >= 0 ? 1 : 0;
      var kb = KEY_SHOPS.indexOf(b.name) >= 0 ? 1 : 0;
      return kb - ka;
    }).filter(shopKey);
    var metrics4 = [
      { key: "adoptionRate", label: "采纳率" },
      { key: "generationRate", label: "生成率" },
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
    var rows = [["店铺", "采纳率%", "生成率%", "转化率%", "纯智能体占比%"]];
    shopLibrary.slice().sort(function (a, b) {
      var ka = KEY_SHOPS.indexOf(a.name) >= 0 ? 1 : 0;
      var kb = KEY_SHOPS.indexOf(b.name) >= 0 ? 1 : 0;
      return kb - ka;
    }).filter(shopKey).forEach(function (shop) {
      rows.push([
        shop.name,
        shopMetricVal(key, shop.id, "adoptionRate") === null ? "" : shopMetricVal(key, shop.id, "adoptionRate"),
        shopMetricVal(key, shop.id, "generationRate") === null ? "" : shopMetricVal(key, shop.id, "generationRate"),
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
  function buildReportShotHtml() {
    var key = lastReportKey();
    var day = state.days[key] || {};
    var draft = (reportDraft() || {})[key] || {};
    var shops = (shopLibrary || []).filter(shopKey);
    var metrics4 = [
      { key: "adoptionRate", label: "采纳率" },
      { key: "generationRate", label: "生成率" },
      { key: "conversionRate", label: "转化率" },
      { key: "pureAgentRatio", label: "纯智能体占比" }
    ];
    var prevKey = null;
    if (key) {
      var prev = fromKey(key);
      prev.setDate(prev.getDate() - 1);
      prevKey = toKey(prev);
    }
    // 行渲染：店名 + 4 指标 + 环比（对齐老版 shot-table）
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
    var problemTxt = (draft.problem || "").trim();
    // 明日待办（对齐老版 shot-todo-grid）
    var todoHtml = "";
    if (todoItems.length) {
      todoHtml = '<div class="shot-todo-grid">' + todoItems.map(function (item) {
        var worstTxt = item.worst.label === "转化率" ? "优先调优转化话术" :
          (item.worst.label === "生成率" ? "优先调优生成话术" : "优先调优采纳话术");
        return '<div class="shot-todo-item"><div class="shot-todo-tag">' + esc(item.name) + '</div>' +
          '<div class="shot-todo-detail">' + esc(item.detail) + '</div>' +
          (item.worst.diff >= 3 ? '<div class="shot-todo-priority">' + worstTxt + '</div>' : '') +
          '</div>';
      }).join("") + '</div>';
    } else {
      todoHtml = '<div class="shot-todo-empty">今日重点店铺指标均未下降，无明日调优重点</div>';
    }
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
          '<table class="shot-table"><thead><tr><th>店铺</th><th>采纳率</th><th>生成率</th><th>转化率</th><th>纯智能体占比</th></tr></thead><tbody>' +
          (rows || '<tr><td colspan="5" style="text-align:center;color:#9aa19b">暂无数据</td></tr>') +
          '</tbody></table>' +
        '</div>' +
        '<div class="shot-layout-right">' +
          '<div class="shot-card flex1"><div class="shot-card-head">当日配置总结</div>' +
            '<div class="shot-text">' + (summaryTxt ? esc(summaryTxt) : "（无）") + '</div></div>' +
          '<div class="shot-card flex1"><div class="shot-card-head">问题反馈</div>' +
            '<div class="shot-text">' + (problemTxt ? esc(problemTxt) : "（无）") + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="shot-todo-card"><div class="shot-card-head">明日待办 · 调优重点</div>' + todoHtml + '</div>' +
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
  function shopKey(shop) { return KEY_SHOPS.indexOf(shop.name) >= 0; }

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
      return '<div class="shop-card' + (shopKey(shop) ? " key-shop" : "") + '" data-shop-id="' + esc(shop.id) + '">' +
        '<div class="shop-card-head"><span class="wb-shop-name">' + esc(shop.name) + '</span>' +
        (shopKey(shop) ? '<span class="shop-key-badge">重点</span>' : '') + '</div>' +
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
    // 昨日数据：默认编辑昨天的数据（业务上同步/录入的是昨日数据）
    var key = yesterdayKeyOf(todayKey());
    var shop = null;
    if (selectedShopId) {
      shop = shopLibrary.filter(function (s) { return s.id === selectedShopId; })[0] || null;
    }
    if (!shop) { shop = shopLibrary[0] || null; }
    if (!shop) { view.innerHTML = '<div class="wb-empty-hint">暂无店铺</div>'; return; }
    selectedShopId = shop.id;
    var sd = dayData(key).shopData[shop.id] = dayData(key).shopData[shop.id] || {};
    var sel = '<select class="pill-btn quiet" id="shopDailySelect" style="background:var(--panel-2);border:1px solid var(--line);color:var(--text);padding:6px 10px;border-radius:9px;font-size:12px;margin-bottom:14px">' +
      shopLibrary.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === shop.id ? " selected" : "") + '>' + esc(s.name) + '</option>'; }).join("") +
      '</select>';
    var rows = SHOP_METRICS.map(function (m) {
      var v = sd[m.key] !== undefined ? sd[m.key] : "";
      return '<div class="shop-input-row"><label>' + m.label + '</label><input type="number" step="0.01" data-metric="' + m.key + '" value="' + esc(v) + '"></div>';
    }).join("");
    view.innerHTML = '<div class="wb-card" style="max-width:640px">' +
      '<h3>昨日数据录入 · ' + key + '</h3>' +
      '<p class="wb-card-sub">' + esc(shop.name) + '（' + esc(shop.owner || "远山") + '）</p>' +
      sel + rows +
      '<div class="shop-card-actions" style="margin-top:12px">' +
      '<button class="pill-btn primary" id="shopDailySave">保存数据</button>' +
      '<button class="pill-btn quiet" id="shopDailyClear">清空</button>' +
      '</div></div>';
    var select = $id("shopDailySelect");
    if (select) {
      select.onchange = function () { selectedShopId = select.value; renderShopDaily(); };
    }
    var saveBtn = $id("shopDailySave");
    if (saveBtn) {
      saveBtn.onclick = function () {
        Array.prototype.forEach.call(view.querySelectorAll("[data-metric]"), function (input) {
          sd[input.dataset.metric] = input.value.trim() === "" ? "" : parseFloat(input.value);
        });
        wbSave(true);
        renderRoster();
        toast("已保存 " + shop.name + " 的当日数据");
      };
    }
    var clearBtn = $id("shopDailyClear");
    if (clearBtn) {
      clearBtn.onclick = function () {
        dayData(key).shopData[shop.id] = {};
        wbSave(true);
        renderShopDaily();
        toast("已清空");
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
  var sumMetric = "adoptionRate";
  var sumRange = "month"; // 7 | 30 | month
  var sumShopId = null;
  var sumDates = [];      // 当前图表日期序列（供 hover 使用）
  var sumShopCurrent = null; // 当前图表店铺（供 hover 使用）

  var SUMMARY_METRICS = [
    { key: "adoptionRate", label: "采纳率" },
    { key: "generationRate", label: "生成率" },
    { key: "conversionRate", label: "转化率" },
    { key: "pureAgentRatio", label: "纯智能体" },
    { key: "experienceScore", label: "体验分" },
    { key: "threeMinReplyRate", label: "3分钟回复率" }
  ];

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
    var isPct = metricKey !== "experienceScore";
    var suffix = isPct ? "%" : "";
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
      labels += '<text x="' + (padL - 8) + '" y="' + (Number(gy) + 4) + '" text-anchor="end" font-size="12" fill="var(--muted)">' + (Math.round(gv * 10) / 10) + suffix + '</text>';
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
    var isPct2 = sumMetric !== "experienceScore";
    var suff2 = isPct2 ? "%" : "";
    var deltaHtml = "";
    if (first !== null && last !== null) {
      var diff = Math.round((last - first) * 100) / 100;
      deltaHtml = diff > 0
        ? '<span class="wb-delta-up">▲ ' + first + suff2 + " → " + last + suff2 + "（+" + diff + "）</span>"
        : diff < 0
          ? '<span class="wb-delta-down">▼ ' + first + suff2 + " → " + last + suff2 + "（" + diff + "）</span>"
          : '<span>' + first + suff2 + " → " + last + suff2 + "（持平）</span>";
    } else {
      deltaHtml = '<span>所选范围无数据</span>';
    }
    var snap = SUMMARY_METRICS.map(function (m) {
      var v = shopMetricVal(dates[dates.length - 1] || todayKey(), shop.id, m.key);
      return '<span class="shop-mini-metric">' + m.label + ' <b>' + (v === null ? "—" : (Math.round(v * 100) / 100) + (m.key === "experienceScore" ? "" : "%")) + '</b></span>';
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
      var isPct = sumMetric !== "experienceScore";
      var metric = SUMMARY_METRICS.filter(function (m) { return m.key === sumMetric; })[0] || SUMMARY_METRICS[0];
      tip.innerHTML =
        '<div class="sum-tip-date">' + dateKey + ' · ' + esc(sumShopCurrent.name) + '</div>' +
        '<div class="sum-tip-val">' + esc(metric.label) + '：<b>' + (v === null ? "无数据" : (Math.round(v * 100) / 100) + (isPct ? "%" : "")) + '</b></div>';
      // 位置跟随鼠标，限定在 wrap 内
      var tipW = 190;
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
    var addBtn = $id("addShopBtn");
    if (addBtn) {
      addBtn.onclick = function () {
        var name = prompt("新店铺名称：");
        if (!name || !name.trim()) { return; }
        var owner = prompt("负责人（默认远山）：", "远山");
        var id = "s" + (shopLibrary.length + 1);
        while (shopLibrary.some(function (s) { return s.id === id; })) { id += "x"; }
        shopLibrary.push({ id: id, name: name.trim(), owner: owner || "远山", adoptionRate: "", generationRate: "", conversionRate: "", pureAgentRatio: "", experienceScore: "", note: "" });
        wbSave(true);
        renderRoster();
        toast("已添加店铺");
      };
    }
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
        if (action === "edit-shop" && shop) {
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
  window.wbRefresh = function () { wbReady = false; wbInit(); };
  window.addEventListener("DOMContentLoaded", wbInit);
  if (document.readyState !== "loading") { wbInit(); }
})();
