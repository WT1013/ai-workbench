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
    var key = currentDateKey || todayKey();
    if (dateLabel) { dateLabel.textContent = key + " · " + weekdayLabel(key); }
    var day = state.days[key];
    var draft = reportDraft()[key] || {};
    var shopRows = "";
    var shops = shopLibrary.slice().sort(function (a, b) {
      var ka = KEY_SHOPS.indexOf(a.name) >= 0 ? 1 : 0;
      var kb = KEY_SHOPS.indexOf(b.name) >= 0 ? 1 : 0;
      return kb - ka;
    });
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
      '<h3>一、重点店铺核心指标（' + key + '）</h3>' +
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
    var key = currentDateKey || todayKey();
    var draft = reportDraft()[key] || {};
    var lines = [];
    lines.push("【" + key + " 日报】");
    lines.push("一、重点店铺核心指标");
    var shops = shopLibrary.slice().sort(function (a, b) {
      var ka = KEY_SHOPS.indexOf(a.name) >= 0 ? 1 : 0;
      var kb = KEY_SHOPS.indexOf(b.name) >= 0 ? 1 : 0;
      return kb - ka;
    });
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
    var key = currentDateKey || todayKey();
    var rows = [["店铺", "采纳率%", "生成率%", "转化率%", "纯智能体占比%"]];
    shopLibrary.slice().sort(function (a, b) {
      var ka = KEY_SHOPS.indexOf(a.name) >= 0 ? 1 : 0;
      var kb = KEY_SHOPS.indexOf(b.name) >= 0 ? 1 : 0;
      return kb - ka;
    }).forEach(function (shop) {
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
    var content = $id("reportContent");
    if (!content) { return; }
    toast("正在生成图片…");
    var target = content.cloneNode(true);
    Array.prototype.forEach.call(target.querySelectorAll("textarea"), function (ta) {
      var p = document.createElement("div");
      p.className = "wb-report-textarea";
      p.style.minHeight = "40px";
      p.textContent = ta.value || "—";
      ta.parentNode.replaceChild(p, ta);
    });
    var holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-9999px";
    holder.style.top = "0";
    holder.style.width = "860px";
    holder.style.background = "var(--panel)";
    holder.style.padding = "20px";
    holder.appendChild(target);
    document.body.appendChild(holder);
    try {
      var html2canvas = window.html2canvas;
      if (!html2canvas) { toast("图片库未加载，请刷新重试"); document.body.removeChild(holder); return; }
      html2canvas(holder, { backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0c1210", scale: 2 }).then(function (canvas) {
        document.body.removeChild(holder);
        fn(canvas);
      }).catch(function () { document.body.removeChild(holder); toast("生成图片失败"); });
    } catch (e) { document.body.removeChild(holder); toast("生成图片失败"); }
  }

  function wbRenderReport() {
    if (!wbReady) { wbLoad().then(function () { renderDailyReport(); }); return; }
    renderDailyReport();
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
      var sd = state.days[key] && state.days[key].shopData && state.days[key].shopData[shop.id] || {};
      var adopt = sd.adoptionRate !== undefined && sd.adoptionRate !== "" ? sd.adoptionRate : "—";
      var exp = sd.experienceScore !== undefined && sd.experienceScore !== "" ? sd.experienceScore : "—";
      return '<div class="shop-card' + (shopKey(shop) ? " key-shop" : "") + '" data-shop-id="' + esc(shop.id) + '">' +
        '<div class="shop-card-head"><span class="wb-shop-name">' + esc(shop.name) + '</span>' +
        (shopKey(shop) ? '<span class="shop-key-badge">重点</span>' : '') + '</div>' +
        '<div class="shop-card-meta"><span>负责人：' + esc(shop.owner || "—") + '</span></div>' +
        '<div class="shop-card-metrics">' +
        '<span class="shop-mini-metric">采纳 <b>' + esc(adopt) + '%</b></span>' +
        '<span class="shop-mini-metric">体验分 <b>' + esc(exp) + '</b></span>' +
        '</div>' +
        '<div class="shop-card-actions">' +
        '<button class="pill-btn quiet" data-action="edit-shop">编辑</button>' +
        '<button class="pill-btn quiet" data-action="daily-shop">每日数据</button>' +
        '<button class="pill-btn quiet" data-action="remove-shop">移除</button>' +
        '</div></div>';
    }).join("") + '</div>';
  }

  function renderShopDaily() {
    var view = $id("shopDailyView");
    if (!view) { return; }
    var key = currentDateKey || todayKey();
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
      '<h3>每日数据录入 · ' + key + '</h3>' +
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

  function renderShopMonth() {
    var view = $id("shopMonthView");
    if (!view) { return; }
    var key = currentDateKey || todayKey();
    var month = key.slice(0, 7);
    var fields = [
      { key: "adoptionRate", label: "采纳率" },
      { key: "generationRate", label: "生成率" },
      { key: "conversionRate", label: "转化率" },
      { key: "pureAgentRatio", label: "纯智能体" },
      { key: "experienceScore", label: "体验分" }
    ];
    var head = "<tr><th>店铺</th>" + fields.map(function (f) { return "<th>" + f.label + "</th>"; }).join("") + "</tr>";
    var body = shopLibrary.map(function (shop) {
      var cells = fields.map(function (f) {
        var sum = 0, n = 0;
        Object.keys(state.days).forEach(function (k) {
          if (k.slice(0, 7) !== month) { return; }
          var sd = state.days[k] && state.days[k].shopData && state.days[k].shopData[shop.id];
          var v = sd && sd[f.key];
          if (v !== undefined && v !== null && String(v) !== "") { sum += parseFloat(v); n += 1; }
        });
        return "<td>" + (n ? (Math.round((sum / n) * 100) / 100) : "—") + "</td>";
      }).join("");
      return "<tr><td>" + esc(shop.name) + "</td>" + cells + "</tr>";
    }).join("");
    view.innerHTML = '<div class="wb-table-wrap"><table class="wb-month-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
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
    $id("shopMonthView").hidden = shopsTab !== "month";
    if (shopsTab === "roster") { renderRoster(); }
    else if (shopsTab === "daily") { renderShopDaily(); }
    else { renderShopMonth(); }
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
    if (genBtn) { genBtn.onclick = function () { wbRenderReport(); toast("日报已生成"); }; }
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
        }
      });
    }
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

  /* ---------- 初始化 ---------- */
  function wbInit() {
    if (wbReady) { return; }
    wbLoad().then(function () {
      if (!currentDateKey) { currentDateKey = todayKey(); }
      bindEvents();
      loadHtml2canvas();
    });
  }

  window.wbInit = wbInit;
  window.wbRenderToday = wbRenderToday;
  window.wbRenderReport = wbRenderReport;
  window.wbRenderShops = wbRenderShops;
  window.wbRefresh = function () { wbReady = false; wbInit(); };
  window.addEventListener("DOMContentLoaded", wbInit);
  if (document.readyState !== "loading") { wbInit(); }
})();
