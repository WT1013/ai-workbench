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

  /* ------------------------------------------------------------------
   * 本机同步服务基址（2026-10-26）
   * 页面本身由 serve.js 提供（:8080）时用同源，这样本机 / 局域网 IP 访问都对；
   * 页面来自 GitHub Pages 等其它来源时，回落到 127.0.0.1:8080。
   * 旧实现硬编码 10.10.12.157:8080 → 线上点同步按钮必然失败。
   * ------------------------------------------------------------------ */
  var LOCAL_HOST = (typeof location !== "undefined" && (location.port === "8080" || location.protocol === "file:"))
    ? "" : "http://127.0.0.1:8080";
  if (typeof window !== "undefined") { window.__LOCAL_HOST = LOCAL_HOST; }

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

  /* 体验分回填（2026-10-31）
     体验分在拼多多侧是滚动周期分，日间极少变化，逐天手填很浪费。
     保存某天体验分时，把「该店上一次有值的日期」→「当前日期」之间，
     已有店铺记录但体验分为空的日期，自动补成同一个值。
     边界：只填空、不覆盖已有值；不新建店铺记录（没同步过的日期保持原样）；
           找不到「上一次有值」时不回填，避免无锚点地大批量写库。 */
  function backfillExperienceScore(shopId, key, value) {
    if (value === "" || value === null || value === undefined) { return 0; }
    var score = Number(value);
    if (!isFinite(score)) { return 0; }
    var days = (state && state.days) || {};
    var isDate = function (d) { return /^\d{4}-\d{2}-\d{2}$/.test(d); };
    var last = "";
    Object.keys(days).forEach(function (d) {
      if (!isDate(d) || d >= key) { return; }
      var rec = days[d] && days[d].shopData && days[d].shopData[shopId];
      if (!rec) { return; }
      var v = rec.experienceScore;
      if (v !== "" && v !== null && v !== undefined && isFinite(Number(v))) {
        if (d > last) { last = d; }
      }
    });
    if (!last) { return 0; }
    var filled = 0;
    Object.keys(days).forEach(function (d) {
      if (!isDate(d) || d <= last || d >= key) { return; }
      var rec = days[d] && days[d].shopData && days[d].shopData[shopId];
      if (!rec) { return; }
      var v = rec.experienceScore;
      if (v === "" || v === null || v === undefined) { rec.experienceScore = score; filled += 1; }
    });
    return filled;
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
        if (hydrateReportDraft().needPush) { try { wbSave(); } catch (e) {} }
        wbReady = true;
      }).catch(function () {
        try {
          var raw = localStorage.getItem(STORAGE_KEY);
          if (raw) { var parsed = JSON.parse(raw); state.days = parsed.days || {}; state.shifts = parsed.shifts || {}; }
        } catch (e) { state.days = {}; state.shifts = {}; }
        if (!state.shifts || Object.keys(state.shifts).length === 0) { seedDefaultShifts(); }
        ensureShopLibrary(false);
        if (hydrateReportDraft().needPush) { try { wbSave(); } catch (e) {} }
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
      if (hydrateReportDraft().needPush) { try { wbSave(); } catch (e) {} }
      wbReady = true;
    }).catch(function () {
      // 云端不可达时回退本地
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) { var parsed = JSON.parse(raw); state.days = parsed.days || {}; state.shifts = parsed.shifts || {}; }
      } catch (e) { state.days = {}; state.shifts = {}; }
      if (!state.shifts || Object.keys(state.shifts).length === 0) { seedDefaultShifts(); }
      ensureShopLibrary(false);
      if (hydrateReportDraft().needPush) { try { wbSave(); } catch (e) {} }
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
        if (showTip) { toast(typeof showTip === "string" ? showTip : "已保存到本地（镜像只读模式）"); }
        return;
      }
      if (saveTimer) { clearTimeout(saveTimer); }
      saveTimer = setTimeout(function () {
        fetch(CLOUD_URL + "/rest/v1/state", {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: CLOUD_KEY, Authorization: "Bearer " + CLOUD_KEY, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify({ id: 1, days: state.days, shifts: state.shifts })
        }).then(function (r) {
          // showTip 传字符串时用它作为同步成功的文案（如「已保存…并回填 N 天」）
          if (showTip) { toast(r.ok ? (typeof showTip === "string" ? showTip : "已同步到云端") : "云端同步失败"); }
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
  /* ---------- 日报正文云端同步（state.days[YYYY-MM-DD].report） ----------
     形态：{ summary, feedback, weekFocus, tomorrow, updatedAt }
     本机 localStorage 仍作主读源（渲染/周度复盘都读它），云端作跨设备备份与补齐。 */
  function cloudReportOf(key) {
    var day = state.days && state.days[key];
    var r = day && day.report;
    return (r && typeof r === "object") ? r : null;
  }
  function reportFilled(d) {
    if (!d) { return false; }
    return ["summary", "feedback", "weekFocus", "tomorrow"].some(function (f) {
      return String(d[f] == null ? "" : d[f]).trim();
    });
  }
  // 云端 → 本机：补齐缺失日期，冲突时取 updatedAt 较新者
  function hydrateReportDraft() {
    var local = reportDraft(), changed = false, needPush = false, pulled = 0;
    Object.keys(state.days || {}).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) { return; }
      var cr = cloudReportOf(k);
      if (!cr || !reportFilled(cr)) { return; }
      var lr = local[k];
      var cts = Number(cr.updatedAt || 0);
      var lts = Number((lr && lr.updatedAt) || 0);
      if (!lr || !reportFilled(lr)) {
        local[k] = Object.assign({}, cr);
        changed = true; pulled += 1;
      } else if (!lts) {
        // 本机是加时间戳之前的旧草稿：保留本机内容，补时间戳并推一次云端
        local[k] = Object.assign({}, lr, { updatedAt: Date.now() });
        changed = true; needPush = true;
      } else if (cts > lts) {
        local[k] = Object.assign({}, cr);
        changed = true; pulled += 1;
      }
    });
    if (changed) {
      try { localStorage.setItem("csa-report-draft", JSON.stringify(local)); } catch (e) {}
    }
    return { pulled: pulled, needPush: needPush };
  }
  function saveReportDraft(key, obj, opts) {
    obj.updatedAt = Date.now();
    var d = reportDraft();
    d[key] = obj;
    try { localStorage.setItem("csa-report-draft", JSON.stringify(d)); } catch (e) {}
    // 写进云端 state.days[key].report；wbSave 内部自带 500ms 防抖并整列 POST（已保留 __library__）
    state.days[key] = Object.assign({}, state.days[key] || {}, { report: Object.assign({}, obj) });
    if (!(opts && opts.skipCloud)) { try { wbSave(); } catch (e) {} }
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
        clearTimeout(renderDailyReport._logT);
        renderDailyReport._logT = setTimeout(renderReportLog, 600);
      });
    });
    renderReportLog();
  }

  /* ---------- 历史日报记录（数据源：本机 localStorage ∪ 云端 state.days[*].report，按日期累积） ---------- */
  var REPORT_LOG_FIELDS = [
    { key: "summary", label: "配置总结" },
    { key: "feedback", label: "问题反馈" },
    { key: "weekFocus", label: "本周重点" },
    { key: "tomorrow", label: "明日待办" }
  ];
  function reportLogEntries() {
    var all = reportDraft(), out = [], touched = false;
    // 云端可能已有本机还没的日期（另一台设备填写），渲染前再对齐一次
    Object.keys(state.days || {}).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) { return; }
      var cr = cloudReportOf(k);
      if (!cr || !reportFilled(cr)) { return; }
      var lr = all[k];
      if (!lr || !reportFilled(lr) || Number(cr.updatedAt || 0) > Number(lr.updatedAt || 0)) {
        all[k] = Object.assign({}, lr || {}, cr);
        touched = true;
      }
    });
    if (touched) { try { localStorage.setItem("csa-report-draft", JSON.stringify(all)); } catch (e) {} }
    Object.keys(all || {}).forEach(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) { return; }
      var d = all[k] || {};
      var filled = REPORT_LOG_FIELDS.filter(function (f) { return String(d[f.key] == null ? "" : d[f.key]).trim(); });
      if (!filled.length) { return; }
      out.push({ key: k, data: d, filled: filled.length });
    });
    out.sort(function (a, b) { return a.key < b.key ? 1 : (a.key > b.key ? -1 : 0); });
    return out;
  }
  function renderReportLog() {
    var list = $id("reportLogList");
    var counter = $id("reportLogCount");
    if (!list) { return; }
    var items = reportLogEntries();
    if (counter) { counter.textContent = items.length ? "共 " + items.length + " 天 · 本机 + 云端" : ""; }
    if (!items.length) {
      list.innerHTML = '<div class="wb-log-empty">暂无历史日报。上面四个输入框填写后会自动留存并按日期累积，同时同步到云端（换设备也能看到）。</div>';
      return;
    }
    list.innerHTML = items.slice(0, 60).map(function (it) {
      var d = it.data;
      var head = String(d.summary || d.feedback || d.weekFocus || d.tomorrow || "").replace(/\s+/g, " ").trim();
      if (head.length > 42) { head = head.slice(0, 42) + "…"; }
      var rows = REPORT_LOG_FIELDS.map(function (f) {
        var v = String(d[f.key] == null ? "" : d[f.key]).trim();
        return v ? '<div class="wb-log-row"><b>' + f.label + '</b><span>' + esc(v) + '</span></div>' : "";
      }).join("");
      return '<div class="wb-report-log-item" data-log="' + it.key + '">' +
        '<div class="wb-log-head">' +
          '<span class="wb-log-date">' + it.key + '（' + weekdayLabel(it.key) + '）</span>' +
          '<span class="wb-log-preview">' + esc(head) + '</span>' +
        '</div>' +
        '<div class="wb-log-side">' +
          '<span class="wb-log-tag">' + it.filled + '/4 段</span>' +
          '<button class="wb-log-copy" type="button" data-log-copy="' + it.key + '">复制</button>' +
        '</div>' +
        '<div class="wb-log-detail" hidden>' + rows + '</div>' +
      '</div>';
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll("[data-log]"), function (row) {
      row.addEventListener("click", function (ev) {
        if (ev.target.closest("[data-log-copy]")) { return; }
        var d = row.querySelector(".wb-log-detail");
        if (!d) { return; }
        d.hidden = !d.hidden;
        row.classList.toggle("open", !d.hidden);
      });
    });
    Array.prototype.forEach.call(list.querySelectorAll("[data-log-copy]"), function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var k = btn.getAttribute("data-log-copy");
        var d = reportDraft()[k] || {};
        var txt = ["【" + k + " 日报】"].concat(REPORT_LOG_FIELDS.map(function (f) {
          return f.label + "：" + String(d[f.key] == null ? "" : d[f.key]).trim();
        })).join("\n");
        copyTextToClipboard(txt);
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
        // 体验分：把「上一次有值」到当前之间空着的日期自动补上（只填空、不覆盖）
        var filledDays = backfillExperienceScore(shop.id, key, metrics.experienceScore);
        var saveMsg = "已保存 " + shop.name + " " + key + " 的数据" + (filledDays ? "，并回填前 " + filledDays + " 天空缺体验分" : "");
        toast(saveMsg);
        // 回填过就沿用这条文案，避免 500ms 后「已同步到云端」把它冲掉、用户看不到补了几天
        wbSave(filledDays ? saveMsg : true);
        renderRoster();
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
    var SHOP_LOCAL_BASE = LOCAL_HOST;
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
          var base = LOCAL_HOST;
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
        window.open(LOCAL_HOST + "/sync", "_blank");
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
    var SYNC_HOST = LOCAL_HOST;
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

  /* ============================================================
   * 商品分组（2026-10-26 升级：左分组 / 右商品 / 一键绑定）
   * 经本机服务 /tg/* 代理直连探域 REST（纯 cookie，不起浏览器）
   * 页面在本机 8080 打开时用同源；其它来源回落到 127.0.0.1:8080
   * ============================================================ */
  var TG_HOST = LOCAL_HOST;

  var groupsCache = null;        // 待绑清单 { meta, list }
  var groupsQuery = "";
  var groupsBound = false;
  var groupsLoading = false;

  var tgGroups = [];             // [{id,name,productNum}]
  var tgGroupsLoading = false;
  var tgGroupQ = "";
  var tgMode = "pending";        // pending | group
  var tgGid = "";
  var tgGname = "";
  var tgPage = 1;
  var tgSize = 20;
  var tgProdQ = "";
  var tgStatus = "all";
  var tgRows = [];
  var tgTotal = 0;
  var tgSel = {};
  var tgBusy = false;
  var tgConf = "all";        // all | high | mid | low
  var tgPending = null;      // 巡检缓存 { meta, counts }
  var tgScanTimer = null;

  function tgJson(url, opt) {
    var o = { cache: "no-store" };
    if (opt) { for (var k in opt) { o[k] = opt[k]; } }
    return fetch(TG_HOST + url, o).then(function (r) { return r.json(); });
  }

  function tgNote(msg) {
    var el = $id("groupsMeta");
    if (el) { el.textContent = msg; }
  }

  function groupsLoad() {
    if (groupsLoading) { return Promise.resolve(); }
    groupsLoading = true;
    return tgJson("/tg/pending?page=1&size=1")
      .then(function (res) {
        groupsLoading = false;
        if (res && res.ok) {
          tgPending = { meta: res.meta || {}, counts: res.counts || {} };
          groupsCache = { meta: res.meta || {}, list: [] };
        } else {
          tgPending = null;
          groupsCache = null;
        }
        renderTgGroupList();
        updateTgMeta();
      })
      .catch(function () {
        groupsLoading = false;
        tgPending = null;
        groupsCache = null;
        renderTgGroupList();
        updateTgMeta();
      });
  }

  function updateTgMeta() {
    var c = (tgPending && tgPending.counts) || null;
    if (!c) {
      tgNote("待绑清单未生成 · 点「↻ 重新巡检」生成（约 5~8 分钟）");
      return;
    }
    var m = tgPending.meta || {};
    tgNote("在售未绑 " + (c.total || 0) + " 条 · 高置信可直绑 " + (c.bindable || 0) +
      " · 待确认 " + (c.mid || 0) + " · 无匹配 " + (c.low || 0) +
      " ｜ 巡检 " + (m.generatedAt || "-"));
  }

  function tgLoadGroups(force) {
    if (tgGroupsLoading) { return; }
    tgGroupsLoading = true;
    tgNote("分组加载中…");
    tgJson("/tg/groups" + (force ? "?refresh=1" : ""))
      .then(function (res) {
        tgGroupsLoading = false;
        if (!res || !res.ok) {
          tgGroups = [];
          tgNote("分组加载失败：" + ((res && res.error) || "未知错误"));
        } else {
          tgGroups = res.groups || [];
          updateTgMeta();
        }
        renderTgGroupList();
        renderTgPickerList("");
      })
      .catch(function () {
        tgGroupsLoading = false;
        tgGroups = [];
        tgNote("分组加载失败 · 本机服务(8080)未启动");
        renderTgGroupList();
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

    var rb = $id("groupsRefreshBtn");
    if (rb) {
      rb.addEventListener("click", function () {
        tgPage = 1; tgSel = {};
        groupsLoad(); tgLoadGroups(true); tgLoadProducts();
      });
    }

    var gq = $id("tgGroupSearch");
    if (gq) {
      gq.addEventListener("input", function () {
        tgGroupQ = gq.value.trim().toLowerCase();
        renderTgGroupList();
      });
    }

    var list = $id("tgGroupList");
    if (list) {
      list.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest(".tg-gitem") : null;
        if (!b) { return; }
        tgPage = 1; tgSel = {}; tgProdQ = "";
        var ps = $id("tgProductSearch");
        if (ps) { ps.value = ""; }
        if (b.getAttribute("data-mode") === "pending") {
          tgMode = "pending"; tgGid = ""; tgGname = "待绑商品";
        } else {
          tgMode = "group"; tgGid = b.getAttribute("data-gid"); tgGname = b.getAttribute("data-gname");
        }
        var ca = $id("tgCheckAll");
        if (ca) { ca.checked = false; }
        renderTgGroupList();
        tgLoadProducts();
      });
    }

    var ps = $id("tgProductSearch");
    if (ps) {
      ps.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { tgProdQ = ps.value.trim(); tgPage = 1; tgSel = {}; tgLoadProducts(); }
      });
    }

    var st = $id("tgStatus");
    if (st) {
      st.addEventListener("change", function () { tgStatus = st.value; tgPage = 1; tgRenderRows(); });
    }

    var ca = $id("tgCheckAll");
    if (ca) { ca.addEventListener("change", function () { tgToggleAll(ca.checked); }); }

    var body = $id("groupsBody");
    if (body) {
      body.addEventListener("change", function (e) {
        var cb = e.target;
        if (!cb || cb.type !== "checkbox") { return; }
        var spu = cb.getAttribute("data-spu");
        if (cb.checked) {
          for (var i = 0; i < tgRows.length; i++) {
            if (tgRows[i].spuId === spu) { tgSel[spu] = tgRows[i]; break; }
          }
        } else {
          delete tgSel[spu];
        }
        var tr = cb.parentNode && cb.parentNode.parentNode;
        if (tr && tr.classList) { tr.classList.toggle("tg-row-sel", !!cb.checked); }
        updateTgSelBar();
      });
    }

    var bb = $id("tgBindBtn");
    if (bb) { bb.addEventListener("click", openTgPicker); }

    var ab = $id("tgAutoBindBtn");
    if (ab) { ab.addEventListener("click", tgAutoBind); }

    var rsb = $id("tgRescanBtn");
    if (rsb) { rsb.addEventListener("click", tgRescan); }

    var cft = $id("tgConf");
    if (cft) {
      cft.addEventListener("change", function () {
        tgConf = cft.value; tgPage = 1; tgSel = {};
        tgLoadProducts();
      });
    }

    var ub = $id("tgUnbindBtn");
    if (ub) { ub.addEventListener("click", tgUnbind); }

    var pc = $id("tgPickerClose");
    if (pc) { pc.addEventListener("click", closeTgPicker); }

    var mk = $id("tgMask");
    if (mk) {
      // 放到 body 下，避免被视图容器的层叠/裁剪影响
      if (mk.parentNode !== document.body) { document.body.appendChild(mk); }
      mk.addEventListener("click", closeTgPicker);
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var p = $id("tgPicker");
        if (p && !p.hidden) { closeTgPicker(); }
      }
    });

    var psr = $id("tgPickerSearch");
    if (psr) { psr.addEventListener("input", function () { renderTgPickerList(psr.value.trim().toLowerCase()); }); }

    var pl = $id("tgPickerList");
    if (pl) {
      pl.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest(".tg-pitem") : null;
        if (!b) { return; }
        tgDoBind(b.getAttribute("data-gid"), b.getAttribute("data-gname"));
      });
    }

    var pager = $id("tgPager");
    if (pager) {
      pager.addEventListener("click", function (e) {
        var b = e.target.closest ? e.target.closest(".tg-pbtn") : null;
        if (!b || b.disabled) { return; }
        var p = parseInt(b.getAttribute("data-p"), 10);
        if (!p || p === tgPage) { return; }
        tgPage = p; tgSel = {}; tgLoadProducts();
      });
    }

    var ng = $id("tgNewGroupBtn");
    if (ng) {
      ng.addEventListener("click", function () {
        window.open("https://agent.tanyuai.com/v2/groupAndStore/product-management/group", "_blank");
      });
    }
  }

  function showGroupsEmpty(msg) {
    var e = $id("groupsEmpty");
    var t = $id("groupsTable");
    if (e) { e.hidden = false; e.textContent = msg || "暂无数据"; }
    if (t) { t.hidden = true; }
    var fc = $id("groupsCount");
    if (fc) { fc.textContent = ""; }
  }

  /* ---------- 左栏：分组列表 ---------- */
  function renderTgGroupList() {
    var el = $id("tgGroupList");
    if (!el) { return; }
    var q = tgGroupQ;
    var pendN = (tgPending && tgPending.counts && tgPending.counts.total) || 0;
    var hiN = (tgPending && tgPending.counts && tgPending.counts.bindable) || 0;
    var html = '<button class="tg-gitem tg-gitem-pend' + (tgMode === "pending" ? " active" : "") + '" data-mode="pending">' +
      '<span class="tg-gname">📋 待绑商品' + (hiN ? ' <b class="tg-hi">' + hiN + ' 可直绑</b>' : '') + '</span>' +
      '<span class="tg-gnum">' + pendN + "</span></button>";

    var gs = tgGroups.filter(function (g) {
      if (!q) { return true; }
      return (g.name || "").toLowerCase().indexOf(q) >= 0 || String(g.id).indexOf(q) >= 0;
    });
    if (!gs.length) {
      html += '<div class="tg-group-hint">' + (tgGroupsLoading ? "加载中…" : (q ? "无匹配分组" : "暂无分组 · 请确认本机服务已启动")) + "</div>";
    } else {
      html += gs.map(function (g) {
        var act = (tgMode === "group" && tgGid === g.id) ? " active" : "";
        return '<button class="tg-gitem' + act + '" data-gid="' + esc(g.id) + '" data-gname="' + esc(g.name) + '">' +
          '<span class="tg-gname" title="' + esc(g.name) + '">' + esc(g.name) + "</span>" +
          '<span class="tg-gnum">' + g.productNum + "</span></button>";
      }).join("");
    }
    el.innerHTML = html;
  }

  /* ---------- 右栏：商品加载 ---------- */
  function tgLoadProducts() {
    var empty = $id("groupsEmpty");
    var table = $id("groupsTable");
    var ca = $id("tgCheckAll");
    if (ca) { ca.checked = false; }
    if (empty) { empty.hidden = false; empty.textContent = "加载中…"; }
    if (table) { table.hidden = true; }
    updateTgSelBar();

    if (tgMode === "pending") {
      var purl = "/tg/pending?page=" + tgPage + "&size=" + tgSize +
        "&q=" + encodeURIComponent(tgProdQ) + "&conf=" + encodeURIComponent(tgConf) + "&sort=conf";
      tgJson(purl).then(function (res) {
        if (!res || !res.ok) {
          tgRows = []; tgTotal = 0;
          showGroupsEmpty(res && res.needScan
            ? "待绑清单还没生成 · 点右侧「↻ 重新巡检」跑一次（约 5~8 分钟）"
            : ("加载失败：" + ((res && res.error) || "未知错误")));
          updateTgSelBar(); renderTgPager();
          return;
        }
        tgPending = { meta: res.meta || {}, counts: res.counts || {} };
        tgTotal = res.total || 0;
        tgRows = (res.rows || []).map(function (r) {
          return {
            spuId: String(r.spuId),
            title: r.title || "",
            image: r.image || "",
            shopName: r.shop || r.shopName || "",
            thirdShopId: r.thirdShopId || "",
            onSale: true,
            price: r.price || "",
            heat7: r.heat7, heat30: r.heat30,
            groups: [],
            suggest: r.groupName || "",
            realName: r.outerId || "",
            confidence: r.confidence || "low",
            verdict: r.verdict || "",
            reason: r.reason || "",
            groupId: r.groupId || "",
            name: r.name || "",
            createdTime: r.createdTime || ""
          };
        });
        tgRenderRows();
        updateTgMeta();
        renderTgGroupList();
      }).catch(function (e) {
        if (window.console) { console.error("[tg/pending] render failed", e); }
        tgRows = []; tgTotal = 0;
        showGroupsEmpty("连不上本机服务(8080) · 待绑巡检需在 http://127.0.0.1:8080/dashboard/ 打开");
        updateTgSelBar(); renderTgPager();
      });
      return;
    }

    var url = "/tg/products?gid=" + encodeURIComponent(tgGid) + "&page=" + tgPage + "&size=" + tgSize +
      "&q=" + encodeURIComponent(tgProdQ);
    tgJson(url).then(function (res) {
      if (!res || !res.ok) {
        tgRows = []; tgTotal = 0;
        showGroupsEmpty("加载失败：" + ((res && res.error) || "未知错误"));
        updateTgSelBar(); renderTgPager();
        return;
      }
      tgTotal = res.total || 0;
      tgRows = (res.rows || []).map(function (r) {
        return {
          spuId: String(r.spuId),
          title: r.title || "",
          image: r.image || "",
          shopName: r.shopName || "",
          thirdShopId: r.thirdShopId || "",
          onSale: r.onSale === true,
          price: r.price || "",
          heat7: null, heat30: null,
          groups: [], suggest: "", realName: ""
        };
      });
      tgRenderRows();
    }).catch(function () {
      tgRows = []; tgTotal = 0;
      showGroupsEmpty("加载失败 · 本机服务(8080)未启动");
      updateTgSelBar(); renderTgPager();
    });
  }

  /* ---------- 右栏：表格渲染 ---------- */
  function tgRenderRows() {
    var empty = $id("groupsEmpty");
    var table = $id("groupsTable");
    var body = $id("groupsBody");
    var count = $id("groupsCount");
    var crumb = $id("tgCrumb");
    var colG = $id("tgColGroup");

    if (crumb) {
      crumb.innerHTML = tgMode === "pending"
        ? '<b>待绑商品</b> · 在售未绑分组巡检清单'
        : '<b>' + esc(tgGname) + '</b> <span class="tg-crumb-id">' + esc(tgGid) + "</span>";
    }
    if (colG) { colG.textContent = tgMode === "pending" ? "建议归属" : "所属分组"; }

    var shown = tgRows.filter(function (r) {
      if (tgMode === "pending") { return true; }
      if (tgStatus === "on") { return r.onSale; }
      if (tgStatus === "off") { return !r.onSale; }
      return true;
    });

    if (!body) { return; }
    if (!shown.length) {
      body.innerHTML = "";
      showGroupsEmpty(tgProdQ ? "无匹配商品" : "当前分组暂无商品");
      renderTgPager();
      return;
    }
    if (empty) { empty.hidden = true; }
    if (table) { table.hidden = false; }

    body.innerHTML = shown.map(function (r) {
      var img = r.image
        ? '<img class="tg-thumb" src="' + esc(r.image) + '" loading="lazy" alt="">'
        : '<span class="tg-thumb tg-thumb-ph"></span>';
      var st = r.onSale ? '<span class="tg-on">在售</span>' : '<span class="tg-off">下架</span>';
      var heat = (r.heat7 == null && r.heat30 == null)
        ? '<span class="tg-dim">—</span>'
        : esc(String(r.heat7 == null ? "-" : r.heat7)) + ' <span class="tg-dim">/</span> ' + esc(String(r.heat30 == null ? "-" : r.heat30));
      var grp;
      if (tgMode === "pending") {
        var cf = r.confidence || "low";
        var cfLabel = cf === "high" ? "高置信" : (cf === "mid" ? "待确认" : "无匹配");
        var tip = esc(r.reason || "");
        if (r.suggest) {
          grp = '<span class="tg-conf tg-conf-' + cf + '">' + cfLabel + "</span>" +
            '<span class="tg-tag tg-tag-sug" title="' + tip + '">' + esc(r.suggest) + "</span>";
        } else {
          grp = '<span class="tg-conf tg-conf-' + cf + '">' + cfLabel + "</span>" +
            '<span class="tg-dim" title="' + tip + '">' + esc(r.reason || "无既有组") + "</span>";
        }
      } else if (r.groups && r.groups.length) {
        grp = r.groups.map(function (g) { return '<span class="tg-tag">' + esc(g.name) + "</span>"; }).join("");
      } else if (tgMode === "group") {
        grp = '<span class="tg-tag tg-tag-cur">' + esc(tgGname) + "</span>";
      } else if (r.suggest) {
        grp = '<span class="tg-tag tg-tag-sug">建议 ' + esc(r.suggest) + "</span>";
      } else if (r.realName) {
        grp = '<span class="tg-dim">' + esc(r.realName) + "</span>";
      } else {
        grp = '<span class="tg-dim">未分组</span>';
      }
      var checked = tgSel[r.spuId] ? " checked" : "";
      return '<tr class="' + (tgSel[r.spuId] ? "tg-row-sel" : "") + '">' +
        '<td class="tg-chk"><input type="checkbox" data-spu="' + esc(r.spuId) + '"' + checked + "></td>" +
        '<td class="tg-cell-prod">' + img +
        '<div class="tg-prod-text"><div class="tg-prod-title" title="' + esc(r.title) + '">' + esc(r.title) + "</div>" +
        (r.price ? '<div class="tg-prod-sub">¥' + esc(r.price) + "</div>" : "") + "</div></td>" +
        '<td class="g-id">' + esc(r.spuId) + "</td>" +
        "<td>" + esc(r.shopName) + "</td>" +
        "<td>" + st + "</td>" +
        "<td>" + heat + "</td>" +
        "<td>" + grp + "</td>" +
        "</tr>";
    }).join("");

    if (count) { count.textContent = "共 " + tgTotal + " 条 ｜ 本页 " + shown.length + " 条"; }
    updateTgSelBar();
    renderTgPager();
  }

  function renderTgPager() {
    var el = $id("tgPager");
    if (!el) { return; }
    var pages = Math.max(1, Math.ceil(tgTotal / tgSize));
    if (pages <= 1) { el.innerHTML = ""; return; }
    var html = '<button class="tg-pbtn" data-p="' + Math.max(1, tgPage - 1) + '"' + (tgPage <= 1 ? " disabled" : "") + ">‹</button>";
    var from = Math.max(1, tgPage - 2);
    var to = Math.min(pages, from + 4);
    from = Math.max(1, to - 4);
    for (var i = from; i <= to; i++) {
      html += '<button class="tg-pbtn' + (i === tgPage ? " active" : "") + '" data-p="' + i + '">' + i + "</button>";
    }
    html += '<button class="tg-pbtn" data-p="' + Math.min(pages, tgPage + 1) + '"' + (tgPage >= pages ? " disabled" : "") + ">›</button>";
    html += '<span class="tg-ptotal">共 ' + pages + " 页</span>";
    el.innerHTML = html;
  }

  function updateTgSelBar() {
    var n = Object.keys(tgSel).length;
    var si = $id("tgSelInfo");
    if (si) { si.textContent = n ? ("已选 " + n + " 个") : "未选择商品"; }
    var bb = $id("tgBindBtn");
    if (bb) { bb.disabled = (n === 0 || tgBusy); }
    var ab = $id("tgAutoBindBtn");
    if (ab) { ab.disabled = !!tgBusy; }
    var ub = $id("tgUnbindBtn");
    if (ub) { ub.disabled = (n === 0 || tgBusy || tgMode !== "group"); }
  }

  function tgToggleAll(checked) {
    for (var i = 0; i < tgRows.length; i++) {
      if (checked) { tgSel[tgRows[i].spuId] = tgRows[i]; } else { delete tgSel[tgRows[i].spuId]; }
    }
    tgRenderRows();
  }

  /* ---------- 目标分组选择器 ---------- */
  function renderTgPickerList(q) {
    var el = $id("tgPickerList");
    if (!el) { return; }
    q = q || "";
    var gs = tgGroups.filter(function (g) {
      if (!q) { return true; }
      return (g.name || "").toLowerCase().indexOf(q) >= 0;
    }).slice(0, 300);
    if (!gs.length) {
      el.innerHTML = '<div class="tg-group-hint">' + (tgGroups.length ? "无匹配分组" : "分组未加载") + "</div>";
      return;
    }
    el.innerHTML = gs.map(function (g) {
      return '<button class="tg-pitem" data-gid="' + esc(g.id) + '" data-gname="' + esc(g.name) + '">' +
        '<span class="tg-pname">' + esc(g.name) + '</span><span class="tg-pnum">' + g.productNum + "</span></button>";
    }).join("");
  }

  function openTgPicker() {
    if (!Object.keys(tgSel).length) { return; }
    var p = $id("tgPicker");
    if (!p) { return; }
    var m = $id("tgMask");
    if (m) { m.hidden = false; }
    p.hidden = false;
    var s = $id("tgPickerSearch");
    if (s) { s.value = ""; s.focus(); }
    renderTgPickerList("");
  }

  function closeTgPicker() {
    var p = $id("tgPicker");
    if (p) { p.hidden = true; }
    var m = $id("tgMask");
    if (m) { m.hidden = true; }
  }

  /* ---------- 执行绑定 / 解绑 ---------- */
  function tgSelItems() {
    return Object.keys(tgSel).map(function (k) {
      var r = tgSel[k];
      return { spuId: r.spuId, thirdShopId: r.thirdShopId || "", shopName: r.shopName || "" };
    });
  }

  function tgDoBind(gid, gname) {
    var items = tgSelItems();
    if (!items.length) { return; }
    closeTgPicker();
    if (!confirm("把已选 " + items.length + " 个商品绑定到分组「" + gname + "」？\n\n（会保留商品原有其它分组）")) { return; }
    tgRunBind("/tg/bind", { groupId: gid, items: items }, "绑定", gname);
  }

  function tgUnbind() {
    var items = tgSelItems();
    if (!items.length || tgMode !== "group") { return; }
    if (!confirm("把已选 " + items.length + " 个商品移出分组「" + tgGname + "」？\n\n（其它分组会保留）")) { return; }
    tgRunBind("/tg/unbind", { groupId: tgGid, items: items }, "移出", tgGname);
  }

  function tgRunBind(path, payload, verb, gname) {
    if (tgBusy) { return; }
    tgBusy = true;
    updateTgSelBar();
    var n = payload.items.length;
    tgNote(verb + "中… 每条约 0.5 秒，共 " + n + " 条");
    var tick = 0;
    var timer = setInterval(function () {
      tick = Math.min(n, tick + 1);
      tgNote(verb + "中… 约 " + tick + "/" + n);
    }, 600);

    tgJson(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      clearInterval(timer);
      tgBusy = false;
      if (!res || !res.ok) {
        tgNote(verb + "失败：" + ((res && res.error) || "未知错误"));
        alert(verb + "失败：" + ((res && res.error) || "未知错误"));
        updateTgSelBar();
        return;
      }
      var fail = (res.results || []).filter(function (x) { return !x.ok; });
      tgNote(verb + "完成 · 成功 " + res.okCount + " / 失败 " + res.failCount + " · 分组「" + gname + "」");
      tgSel = {};
      tgLoadGroups(true);
      tgLoadProducts();
      if (fail.length) {
        alert(verb + "结果：成功 " + res.okCount + " 个，失败 " + res.failCount + " 个\n\n失败明细（前 10 条）：\n" +
          fail.slice(0, 10).map(function (x) {
            return x.spuId + " " + String(x.title || "").slice(0, 18) + " — " + x.msg;
          }).join("\n"));
      }
    }).catch(function (e) {
      clearInterval(timer);
      tgBusy = false;
      tgNote(verb + "异常：" + (e.message || e));
      updateTgSelBar();
    });
  }

  /* ---------- 高置信批量绑定（2026-11-08） ---------- */
  function tgFetchAllHigh() {
    var all = [], page = 1, size = 200;
    function step() {
      return tgJson("/tg/pending?bindable=1&page=" + page + "&size=" + size + "&sort=conf")
        .then(function (res) {
          if (!res || !res.ok) { return all; }
          var rows = res.rows || [];
          all = all.concat(rows);
          if (all.length < (res.total || 0) && rows.length === size) { page++; return step(); }
          return all;
        });
    }
    return step();
  }

  function tgAutoBind() {
    if (tgBusy) { return; }
    tgNote("正在统计高置信商品…");
    tgFetchAllHigh().then(function (rows) {
      var items = rows.filter(function (r) { return r.groupId && r.spuId; })
        .map(function (r) {
          return { spuId: r.spuId, thirdShopId: r.thirdShopId, shopName: r.shop, groupId: r.groupId, groupName: r.groupName };
        });
      if (!items.length) {
        updateTgMeta();
        alert("当前没有「高置信 + 可直绑」的商品。\n\n可以先用「仅待确认」筛选，逐条人工拍板。");
        return;
      }
      var byGroup = {};
      items.forEach(function (r) { byGroup[r.groupName] = (byGroup[r.groupName] || 0) + 1; });
      var gnames = Object.keys(byGroup).sort(function (a, b) { return byGroup[b] - byGroup[a]; });
      var lines = gnames.slice(0, 12).map(function (k) { return "  " + k + "  ← " + byGroup[k] + " 条"; }).join("\n");
      var more = gnames.length > 12 ? "\n  …共 " + gnames.length + " 个分组" : "";
      var msg = "将把 " + items.length + " 个商品绑定到 " + gnames.length + " 个分组：\n\n" + lines + more +
        "\n\n范围：在售 + 未绑任何分组 + 高置信（商品编码命中主组名）。\n" +
        "逐条「读现有组 → 追加 → 回读校验」，不覆盖原有分组。\n\n确定执行？";
      if (!confirm(msg)) { updateTgMeta(); return; }

      var chunks = [];
      for (var i = 0; i < items.length; i += 200) { chunks.push(items.slice(i, i + 200)); }
      var okN = 0, failN = 0, fails = [], ci = 0;
      tgBusy = true;
      updateTgSelBar();

      function next() {
        if (ci >= chunks.length) { return Promise.resolve(); }
        tgNote("批量绑定中… 第 " + (ci + 1) + "/" + chunks.length + " 批 ｜ 成功 " + okN + " · 失败 " + failN);
        return tgJson("/tg/bind-auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: chunks[ci] })
        }).then(function (res) {
          if (res && res.ok) {
            okN += res.okCount || 0;
            failN += res.failCount || 0;
            (res.results || []).forEach(function (x) { if (!x.ok) { fails.push(x); } });
          } else {
            failN += chunks[ci].length;
            fails.push({ spuId: "(整批)", msg: (res && res.error) || "批次失败" });
          }
          ci++;
          return next();
        }).catch(function (e) {
          failN += chunks[ci].length;
          fails.push({ spuId: "(整批)", msg: e.message || String(e) });
          ci++;
          return next();
        });
      }

      next().then(function () {
        tgBusy = false;
        tgNote("批量绑定完成 · 成功 " + okN + " · 失败 " + failN);
        tgSel = {};
        updateTgSelBar();
        groupsLoad();
        tgLoadProducts();
        if (fails.length) {
          alert("批量绑定结果：成功 " + okN + " 个，失败 " + failN + " 个\n\n失败明细（前 10 条）：\n" +
            fails.slice(0, 10).map(function (x) {
              return x.spuId + " " + String(x.title || x.groupName || "").slice(0, 18) + " — " + x.msg;
            }).join("\n"));
        } else {
          alert("批量绑定完成：成功 " + okN + " 个，全部回读校验通过。");
        }
      });
    });
  }

  /* ---------- 重新巡检 ---------- */
  function tgPollScan() {
    if (tgScanTimer) { return; }
    tgScanTimer = setInterval(function () {
      tgJson("/tg/pending/status").then(function (st) {
        if (!st) { return; }
        if (st.running) {
          var tail = (st.tail && st.tail.length) ? st.tail[st.tail.length - 1] : "扫描中…";
          tgNote("巡检中 " + (st.elapsedSec || 0) + "s ｜ " + tail);
          return;
        }
        clearInterval(tgScanTimer);
        tgScanTimer = null;
        if (st.error) {
          tgNote("巡检失败：" + st.error);
          alert("巡检失败：" + st.error);
          return;
        }
        tgNote("巡检完成 · 在售未绑 " + (st.total || 0) + " 条 ｜ " + (st.generatedAt || ""));
        tgPage = 1; tgSel = {};
        groupsLoad();
        tgLoadProducts();
      }).catch(function () {});
    }, 3000);
  }

  function tgRescan() {
    if (!confirm("重新巡检会扫描 21 家店的在售未绑商品。\n\n首次约 5~8 分钟（探域约 4.1 万条 SKU），期间页签可继续用，完成后自动刷新。\n\n确定开始？")) { return; }
    tgNote("正在启动巡检…");
    tgJson("/tg/pending/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    }).then(function (res) {
      if (!res || !res.started) {
        tgNote("巡检未能启动：" + ((res && (res.reason || res.error)) || "未知错误"));
        return;
      }
      tgNote("巡检已启动，后台扫描中…");
      tgPollScan();
    }).catch(function (e) {
      tgNote("巡检启动异常：" + (e.message || e));
    });
  }

  function wbRenderGroups() {
    bindGroupsEvents();
    if (!groupsCache) {
      groupsLoad().then(function () { if (!tgGroups.length) { tgLoadGroups(false); } tgLoadProducts(); });
      return;
    }
    if (!tgGroups.length) { tgLoadGroups(false); }
    renderTgGroupList();
    tgLoadProducts();
  }

  window.wbRenderGroups = wbRenderGroups;

  /* ============================================================
   * AI 助手（DeepSeek / OpenAI 兼容） 2026-10-26
   * 浏览器直连 API（DeepSeek 回显 Origin，支持跨域）
   * API Key 只存本机 localStorage，不上传云端、不进代码
   * ============================================================ */
  var AI_CFG_KEY = "csa-ai-cfg-v1";
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
    "4. 用中文回答，表格优先于长段落。\n" +
    "5. 若下文带有【当前页面】数据，优先围绕该页面回答；没有的部分才用全局快照补充。\n\n" +
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
    var pc = aiPageCtxText();
    if (pc) { out.push(""); out.push(pc); }
    return out.join("\n");
  }

  /* ============================================================
   * 页面级 AI 上下文（2026-10-26）
   * 每个视图带自己的数据快照，点「✦ AI」直接把本页数据一起发过去
   * ============================================================ */
  var aiPage = null;

  function ctxDashboard() {
    var ids = ["stdNoticeBar", "gapNoticeBar", "downNoticeBar", "riskNoticeBar"];
    var lines = [];
    ids.forEach(function (id) {
      var el = $id(id);
      if (!el || el.hidden) { return; }
      var t = String(el.textContent || "").replace(/\s+/g, " ").trim();
      if (t) { lines.push("- " + t.slice(0, 260)); }
    });
    return "【当前页面：数据驾驶舱 · 数据体检】\n" +
      (lines.length ? "页面当前告警：\n" + lines.join("\n") : "页面当前没有告警条。") +
      "\n注意：告警只是现象，需要判断是「探域当日未出数」「采集失败」还是「真实下跌」。";
  }

  function ctxMonthly() {
    var tk = todayKey(), ym = tk.slice(0, 7);
    var days = Object.keys(state.days || {}).filter(function (k) { return k.indexOf(ym) === 0; }).sort();
    var out = ["【当前页面：月度汇总 · " + ym + "（已同步 " + days.length + " 天）】",
      "店铺|消息数|生成数|采纳数|风控数|采纳率%|生成率%|风控率%|纯智日均%|3分钟日均%"];
    (shopLibrary || []).forEach(function (s) {
      var a = 0, g = 0, ad = 0, rk = 0, pure = [], tm = [];
      days.forEach(function (k) {
        var d = (state.days[k] && state.days[k].shopData && state.days[k].shopData[s.id]) || {};
        a += aiNum(d.agenticMsgCount) || 0;
        g += aiNum(d.genCount) || 0;
        ad += aiNum(d.adoptCount) || 0;
        rk += aiNum(d.riskCount) || 0;
        var p = aiNum(d.pureAgentRatio); if (p !== null) { pure.push(p); }
        var t = aiNum(d.threeMinReplyRate); if (t !== null) { tm.push(t); }
      });
      if (!a && !g && !ad && !rk && !pure.length && !tm.length) { return; }
      out.push([String(s.name || s.id) + (s.key ? "★" : ""), a, g, ad, rk,
        a ? (ad / a * 100).toFixed(2) : "—",
        a ? (g / a * 100).toFixed(2) : "—",
        a ? (rk / a * 100).toFixed(2) : "—",
        aiFmt(aiAvg(pure)), aiFmt(aiAvg(tm))].join("|"));
    });
    out.push("说明：三个比率按整月累计计数计算（分母=Agentic消息数）；纯智与3分钟为有效日均值。");
    return out.join("\n");
  }

  function ctxToday() {
    var k = currentDateKey || yesterdayKeyOf(todayKey());
    var sd = (state.days[k] && state.days[k].shopData) || {};
    var out = ["【当前页面：今日工作台 · " + k + "】",
      "店铺|消息数|生成数|采纳数|风控数|采纳率%|生成率%|纯智%|3分钟%|体验分"];
    var miss = [];
    (shopLibrary || []).forEach(function (s) {
      var d = sd[s.id];
      if (!d || (d.agenticMsgCount === undefined && d.adoptionRate === undefined)) { miss.push(String(s.name || s.id)); return; }
      out.push([String(s.name || s.id) + (s.key ? "★" : ""),
        d.agenticMsgCount, d.genCount, d.adoptCount, d.riskCount,
        aiFmt(aiNum(d.adoptionRate)), aiFmt(aiNum(d.generationRate)),
        aiFmt(aiNum(d.pureAgentRatio)), aiFmt(aiNum(d.threeMinReplyRate)),
        aiFmt(aiNum(d.experienceScore))].join("|"));
    });
    if (miss.length) { out.push("该日无数据的店（" + miss.length + " 家）：" + miss.join("、")); }
    var mk = state.days[k] && state.days[k].shopMarked;
    if (mk && Object.keys(mk).length) {
      out.push("打标待审核：" + Object.keys(mk).map(function (n) { return n + " " + mk[n]; }).join("，"));
    }
    return out.join("\n");
  }

  function ctxShops() {
    var tk = todayKey(), ym = tk.slice(0, 7), todayD = Number(tk.slice(8, 10)) || 1;
    var out = ["【当前页面：店铺库 · " + ym + " 数据完整度（1~" + todayD + " 号）】",
      "店铺|负责|重点|有数据天数|缺席日期（前3个）"];
    (shopLibrary || []).forEach(function (s) {
      var have = 0, gaps = [];
      for (var d = 1; d <= todayD; d++) {
        var k = ym + "-" + (d < 10 ? "0" : "") + d;
        var v = (state.days[k] && state.days[k].shopData && state.days[k].shopData[s.id]) || null;
        if (v && (v.adoptionRate !== undefined || v.agenticMsgCount !== undefined)) { have++; }
        else { gaps.push(d); }
      }
      out.push([String(s.name || s.id), s.owner || "—", s.key ? "是" : "",
        have + "/" + todayD,
        gaps.length ? gaps.slice(0, 3).join("、") + (gaps.length > 3 ? "…" : "") : "无"].join("|"));
    });
    out.push("说明：只统计探域侧指标是否写入；体验分为手工录入，不计入完整度。");
    return out.join("\n");
  }

  function ctxSummary() {
    var shop = sumShopCurrent || (shopLibrary || []).filter(function (s) { return s.id === sumShopId; })[0] || null;
    var m = SUMMARY_METRICS.filter(function (x) { return x.key === sumMetric; })[0];
    var dates = sumDates || [];
    if (!shop) { return "【当前页面：数据总览】尚未选择店铺。"; }
    var series = dates.map(function (k) {
      var d = (state.days[k] && state.days[k].shopData && state.days[k].shopData[shop.id]) || {};
      return k.slice(5) + ":" + (d[sumMetric] === undefined ? "—" : d[sumMetric]);
    });
    return "【当前页面：数据总览 · " + String(shop.name || shop.id) + " · " + (m ? m.label : sumMetric) +
      " · " + (sumRange === "7" ? "近7天" : sumRange === "30" ? "近30天" : "本月") + "】\n" +
      "逐日数值：" + (series.length ? series.join("  ") : "无数据");
  }

  function ctxReport() {
    var el = $id("reportContent");
    var txt = el ? String(el.innerText || el.textContent || "").replace(/\n{3,}/g, "\n\n").trim() : "";
    var dk = ($id("reportDateLabel") || {}).textContent || "";
    return "【当前页面：日报表格 · " + String(dk).trim() + "】\n" +
      (txt ? "当前日报原文（节选）：\n" + txt.slice(0, 1800) : "当前还没有生成日报内容。");
  }

  function ctxWeekly() {
    var W = window.WeeklyReview;
    if (!W || typeof W.collect !== "function") {
      return "【当前页面：周度复盘】复盘模块未加载，没有数据。";
    }
    var start = (($id("weeklyStart") || {}).value || "").trim();
    var end = (($id("weeklyEnd") || {}).value || "").trim();
    try {
      var data = W.collect(W.getWorkbenchData(), start, end);
      var an = W.analyze(data);
      var note = (typeof W.readNote === "function") ? W.readNote(W.rangeKeyOf(start, end)) : null;
      var txt = W.buildText(data, an, start + " ~ " + end, note);
      return txt.length > 6000 ? txt.slice(0, 6000) + "\n（内容较长已截断）" : txt;
    } catch (e) {
      return "【当前页面：周度复盘】上下文读取失败：" + (e && e.message ? e.message : e);
    }
  }

  function ctxGroups() {
    var c = (tgPending && tgPending.counts) || null;
    if (!c) {
      return "【当前页面：待绑商品】巡检清单未生成。需在 http://127.0.0.1:8080/dashboard/ 打开后点「↻ 重新巡检」生成。";
    }
    var m = tgPending.meta || {};
    var out = ["【当前页面：待绑商品 · 巡检 " + (m.generatedAt || "-") + "】",
      "在售未绑 " + (c.total || 0) + " 条：高置信可直绑 " + (c.bindable || 0) +
      " / 待确认 " + (c.mid || 0) + " / 无匹配 " + (c.low || 0) + "。",
      "口径：高置信=商品编码(outerId)命中既有分组名，可整批直绑；待确认=仅标题或渠道版/脏组命中，须人工拍板；无匹配=无既有组可归，需建组。",
      "边界：只统计在售且未绑任何分组的商品，下架款不在清单内。",
      "",
      "当前页 " + tgRows.length + " 条：",
      "店铺|商品编码/名称|建议归属|置信度|判定理由"];
    tgRows.slice(0, 40).forEach(function (r) {
      out.push([String(r.shopName || "").slice(0, 12),
        String(r.realName || r.name || r.title || "").slice(0, 42),
        String(r.suggest || "（无）").slice(0, 30),
        r.confidence || "-",
        String(r.reason || "").slice(0, 24)].join("|"));
    });
    return out.join("\n");
  }

  var AI_PAGE = {
    dashboard: {
      name: "数据驾驶舱",
      ctx: ctxDashboard,
      qs: [
        { t: "异常归因", q: "页面这些告警里，哪些是探域未出数、哪些是采集失败、哪些是真实下跌？逐条判断并给出验证方法。" },
        { t: "最该先看哪家", q: "按影响程度排序，今天最该先处理的三家店是哪三家？各自先做什么？" }
      ]
    },
    monthly: {
      name: "月度汇总",
      ctx: ctxMonthly,
      qs: [
        { t: "本月达标盘点", q: "按达标线（生成率≥95%、采纳率≥65%、纯智≥35%、风控≤15%）逐店判断本月累计是否达标，列出未达标项和差额。" },
        { t: "本月最差三家", q: "本月累计看，哪三家最需要干预？分别说明卡在哪个指标、可能的原因。" },
        { t: "费用/效率判断", q: "从消息量和纯智占比看，哪些店对人工依赖最重？哪些店的AI已经基本接管？" }
      ]
    },
    today: {
      name: "今日工作台",
      ctx: ctxToday,
      qs: [
        { t: "当天异常店", q: "看这一天各店数据，哪些店的指标明显异常（为0、缺失、比例不合理）？逐个说明是数据问题还是经营问题。" },
        { t: "今天先做什么", q: "基于这一天的数据，今天最该处理的三件事是什么？写清做什么、涉及哪几家店。" }
      ]
    },
    report: {
      name: "日报",
      ctx: ctxReport,
      qs: [
        { t: "精简成三句话", q: "把这份日报压缩成三句话，保留最关键的数字和异常，去掉过程描述。" },
        { t: "找出没说清的地方", q: "这份日报哪里写得含糊、缺依据、或者老板会追问？指出并给出改法。" }
      ]
    },
    shops: {
      name: "店铺库",
      ctx: ctxShops,
      qs: [
        { t: "谁缺数据", q: "按数据完整度排序，哪些店缺得最多？缺口集中在哪些日期？建议怎么补。" },
        { t: "数据质量体检", q: "从完整度看，哪些店的数据不足以支撑月度汇报？需要提醒我什么。" }
      ]
    },
    weekly: {
      name: "周度复盘",
      ctx: ctxWeekly,
      qs: [
        { t: "一键复盘", q: "基于上面的周度复盘数据，直接输出完整分析，不要反问、不要复述原始数据。结构如下：\n" +
            "1) 结论：一句话说清本周整体变好还是变差，最关键的那一个变化是什么；\n" +
            "2) 下滑清单（表格）：店铺 | 指标 | 首日→末日 | 跌幅 | 判定（数据缺失 / 真实下跌 / 口径差异），只列真实下滑项，没有就写无；\n" +
            "3) 归因（表格）：逐项先判是否在 AI 能力边界内，再落到四层（口径 / 历史配置 / 可修 / 合规）、三层（瞬时检索失败 / 合规拦截 / 未覆盖场景）、四类（答非所问 / 笼统 / 生硬 / 超纲），写清依据；\n" +
            "4) 方案三段式：止血（本周已做或可做）、治本（针对归因）、防复发（监控项 + 阈值）；\n" +
            "5) 下周先做三件事：每件写清店铺、指标、目标值、责任角色。\n" +
            "数据不足处直接写「数据不足」，禁止编造。" },
        { t: "写成周报", q: "把这份周度复盘改写成给主管看的一页周报：本周结论先行、关键数字、两三个问题及对应动作、下周计划。去掉过程叙述。" },
        { t: "下周盯什么", q: "按本周数据走势，下周最该盯的三个指标是哪三个（含具体店铺和目标值）？如果继续不动会有什么后果。" }
      ]
    },
    summary: {
      name: "数据总览",
      ctx: ctxSummary,
      qs: [
        { t: "解读趋势", q: "这家店这个指标的趋势怎么读？有没有拐点、异常段或明显下滑？给出判断依据。" },
        { t: "下一步查什么", q: "按当前走势，接下来最该盯的是什么？如果继续这样会有什么后果。" }
      ]
    },
    groups: {
      name: "待绑商品",
      ctx: ctxGroups,
      qs: [
        { t: "帮我绑高置信的", q: "先用 query_pending 查全部高置信（conf=high）且建议归属非空的商品，按建议分组统计条数，然后为每组调用 bind_products 生成待确认卡片。不要一次性输出几百条明细，只给汇总表和需要我拍板的部分。" },
        { t: "复核建议归属", q: "逐条看这些商品的建议归属，哪些明显归错了？说明理由并给出应归的组（用 list_groups 查真实分组名和 ID）。" },
        { t: "挑出可直绑的", q: "这些商品里，哪些可以确定直接绑、哪些必须我拍板？给出两份清单和判断依据。" }
      ]
    }
  };

  function aiPageCtxText() {
    var p = aiPage && AI_PAGE[aiPage];
    if (!p) { return ""; }
    try { return p.ctx(); } catch (e) { return "【当前页面：" + p.name + "】上下文读取失败"; }
  }

  function renderAiCtxBar() {
    var bar = $id("aiCtxBar");
    var txt = $id("aiCtxText");
    if (!bar || !txt) { return; }
    var p = aiPage && AI_PAGE[aiPage];
    if (!p) { bar.hidden = true; return; }
    bar.hidden = false;
    txt.innerHTML = "当前上下文：<b>" + esc(p.name) + "</b> · 本页数据会随提问一起发送";
  }

  function aiClearPage() {
    aiPage = null;
    renderAiCtxBar();
    renderAiQuick();
    renderAiMessages();
    toast("已退出页面上下文，改回全局数据");
  }

  function aiOpenPage(key) {
    var p = AI_PAGE[key];
    if (!p) { return; }
    aiPage = key;
    var nav = document.querySelector('.primary-nav .nav-item[data-view="ai"]');
    if (nav) { nav.click(); }
    renderAiCtxBar();
    renderAiQuick();
    renderAiMessages();
    var q = p.qs[0];
    if (!q) { return; }
    if (!aiCfg.configured) {
      toast("先在下方「⚙ 接口设置」填 API Key，保存后点一次就会自动分析");
      return;
    }
    // 等 AI 视图就绪、上一轮请求结束后再自动提问
    // （否则切视图未完成 / aiBusy 为真时 aiAsk 会静默 return，看起来就是"点了没反应"）
    var tries = 0;
    (function fire() {
      var view = $id("aiView");
      var ready = view && !view.hidden && view.offsetHeight > 0;
      if (!ready || aiBusy) {
        if (++tries > 20) {
          if (aiBusy) { toast("上一轮还在回答，稍等再点"); }
          return;
        }
        setTimeout(fire, 150);
        return;
      }
      aiAsk(q.q);
    })();
  }

  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-ai-page]") : null;
    if (!b) { return; }
    e.preventDefault();
    aiOpenPage(b.dataset.aiPage);
  });

  function aiReadCfg() {
    try {
      var c = JSON.parse(localStorage.getItem(AI_CFG_KEY) || "null");
      if (c && c.apiKey) { return c; }
    } catch (e) { /* 忽略 */ }
    return null;
  }

  function aiMask(k) {
    var s = String(k || "");
    if (!s) { return ""; }
    if (s.length <= 10) { return "****"; }
    return s.slice(0, 4) + "****" + s.slice(-4);
  }

  // 直连 OpenAI 兼容接口（DeepSeek 已实测支持浏览器跨域 + tools）
  function aiRaw(messages, maxTokens, temperature, tools) {
    var c = aiReadCfg();
    if (!c) { return Promise.reject(new Error("尚未配置 API Key")); }
    var url = String(c.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "") + "/chat/completions";
    var payload = {
      model: c.model || "deepseek-chat",
      messages: messages,
      temperature: temperature === undefined ? 0.3 : temperature,
      max_tokens: maxTokens || 4096,
      stream: false
    };
    if (tools && tools.length) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + c.apiKey
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { throw new Error("接口返回非 JSON（HTTP " + r.status + "）"); }
        if (!r.ok) {
          var msg = (j && j.error && (j.error.message || j.error)) || ("HTTP " + r.status);
          throw new Error(msg);
        }
        var ch = (j && j.choices && j.choices[0]) || {};
        var msg = ch.message || {};
        var content = msg.content || "";
        var tcs = (msg.tool_calls && msg.tool_calls.length) ? msg.tool_calls : null;
        if (!content && !tcs) { throw new Error("接口返回内容为空"); }
        return { content: content, model: (j && j.model) || c.model, message: msg, finish: ch.finish_reason, toolCalls: tcs };
      });
    }, function (e) {
      throw new Error("网络请求失败：" + ((e && e.message) || e) + "（检查网络或接口地址）");
    });
  }

  /* ============ AI 工具调用：能查分组/待绑清单，能发起绑定（写操作必须人工确认） ============ */

  var AI_TOOL_MAX_ROUNDS = 5;
  var aiActSeq = 0;
  var aiActions = {};               // actionId -> 待确认动作
  var aiPendCache = { ts: 0, rows: null, counts: null, meta: null };
  var aiGroupCache = null;

  var AI_TOOLS = [
    {
      type: "function",
      function: {
        name: "list_groups",
        description: "列出探域全部商品分组（分组名、groupId、组内商品数、覆盖店铺数），可按名称关键词过滤。要绑定前必须先查真实 groupId，不要猜。",
        parameters: {
          type: "object",
          properties: {
            q: { type: "string", description: "分组名关键词，留空=全部" },
            limit: { type: "integer", description: "最多返回条数，默认 40，上限 200" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "query_pending",
        description: "查询「在售且未绑任何分组」的商品清单（每日巡检结果，含 spuId/thirdShopId/建议归属/置信度/判定理由）。可按店铺、置信度、关键词筛选。",
        parameters: {
          type: "object",
          properties: {
            shop: { type: "string", description: "店铺名关键词（模糊），留空=全部" },
            conf: { type: "string", enum: ["high", "mid", "low", "all"], description: "置信度，默认 all。high=编码命中既有组名可直接绑，mid=待拍板，low=无既有组" },
            q: { type: "string", description: "商品名 / 编码 / spuId 关键词" },
            limit: { type: "integer", description: "最多返回条数，默认 30，上限 100" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "query_group_products",
        description: "查看某个商品分组下已绑定的商品明细。",
        parameters: {
          type: "object",
          properties: {
            groupId: { type: "string", description: "分组 ID（先 list_groups 查）" },
            q: { type: "string", description: "商品名关键词，留空=全部" },
            limit: { type: "integer", description: "最多返回条数，默认 20，上限 60" }
          },
          required: ["groupId"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "bind_products",
        description: "把商品绑定到指定分组（写操作）。调用后不会立即执行，只会生成一张待确认卡片，由用户在界面上点「确认执行」后才真正写入探域。单次最多 300 条。",
        parameters: {
          type: "object",
          properties: {
            groupId: { type: "string", description: "目标分组 ID（必须来自 list_groups 或 query_pending 返回的真实 ID）" },
            items: {
              type: "array",
              description: "要绑定的商品（spuId 必填）",
              items: {
                type: "object",
                properties: {
                  spuId: { type: "string" },
                  thirdShopId: { type: "string", description: "店铺 ID，可从 query_pending 结果带出，留空则自动匹配" }
                },
                required: ["spuId"]
              }
            },
            note: { type: "string", description: "一句话说明为什么绑这些（会显示在确认卡片上）" }
          },
          required: ["groupId", "items"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "unbind_products",
        description: "把商品移出指定分组（写操作）。同样只生成待确认卡片，需用户点「确认执行」。",
        parameters: {
          type: "object",
          properties: {
            groupId: { type: "string", description: "分组 ID" },
            spuIds: { type: "array", items: { type: "string" }, description: "要移出的 spuId 列表，最多 300 条" },
            note: { type: "string", description: "一句话说明原因" }
          },
          required: ["groupId", "spuIds"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "get_weekly_facts",
        description: "读取周度复盘的事实底稿：指标下滑明细、每日均值、日报问题反馈（基于真实驾驶舱数据）。写周度复盘前必须先调用它拿数据，禁止编造数字。",
        parameters: {
          type: "object",
          properties: {
            start: { type: "string", description: "开始日期 YYYY-MM-DD，留空=当前周度复盘区间" },
            end: { type: "string", description: "结束日期 YYYY-MM-DD，留空=当前周度复盘区间" }
          }
        }
      }
    },
    {
      type: "function",
      function: {
        name: "save_weekly_note",
        description: "把周度复盘写入「周度复盘」板块的五栏（④分析与思考 / 止血 / 治本 / 防复发 / 下周计划），本地+云端持久化。用户让你写周度复盘、保存复盘、把复盘放进周度复盘时，必须调用本工具，不要只在聊天里输出文字。",
        parameters: {
          type: "object",
          properties: {
            start: { type: "string", description: "开始日期 YYYY-MM-DD，留空=当前区间" },
            end: { type: "string", description: "结束日期 YYYY-MM-DD，留空=当前区间" },
            think: { type: "string", description: "④ 分析与思考：根因判断和依据（数据说话）" },
            stop: { type: "string", description: "⑤ 止血：本周立即做的止损动作" },
            fix: { type: "string", description: "⑤ 治本：针对根因的永久修复" },
            prevent: { type: "string", description: "⑤ 防复发：巡检/校验机制" },
            plan: { type: "string", description: "下周计划：一行一条，带可验证目标和数字" }
          }
        }
      }
    }
  ];

  var AI_TOOL_HINT = "\n\n【工具】你可以调用工具读取真实数据（list_groups / query_pending / query_group_products）" +
    "以及发起写操作（bind_products / unbind_products）。\n" +
    "- 需要分组名、groupId、待绑商品时先调用工具，禁止凭记忆或猜测编造 groupId 和商品。\n" +
    "- 写操作只会生成待确认卡片，不会立即执行；在用户点确认前，不要说「已经绑定成功」，要说「已生成待确认」。\n" +
    "- 只有 bind_products / unbind_products 的返回结果里出现 actionId，才算真的生成了卡片；没调用就不要描述卡片，也不要说已生成。\n" +
    "- 写入必须严格按用户这次的要求限定范围：用户说「前 3 个」就只生成 3 个，不要顺手把整店高置信全绑了。\n" +
    "- 只有用户明确要求绑定/移出时才调用写工具；分析类问题（如「今天先做什么」「谁最该干预」）只回答，不生成卡片。\n" +
    "- 用户说「帮我绑」时，先 query_pending 取真实 spuId + groupId，再 bind_products；超过 300 条要分批并说明。\n" +
    "- 用户让你写/生成/保存周度复盘（或「把复盘写进周度复盘」）时：先调 get_weekly_facts 拿本周真实事实，" +
    "再按五栏（think 分析与思考 / stop 止血 / fix 治本 / prevent 防复发 / plan 下周计划）组织内容，" +
    "最后必须调 save_weekly_note 写入板块；写入成功后只简短确认已写入哪几栏，不要在聊天里重复全文。\n" +
    "- save_weekly_note 只覆盖你传入的栏，没传的栏保持原样；不要把寒暄、原始表格数据塞进复盘。\n" +
    "- 工具失败（例如本机服务未启动）时，如实说明原因，不要伪造结果。\n";

  function aiTg(path, body) {
    var opt = { cache: "no-store" };
    if (body) {
      opt.method = "POST";
      opt.headers = { "Content-Type": "application/json" };
      opt.body = JSON.stringify(body);
    }
    var hint = "连不上本机服务(8080)：请从 http://127.0.0.1:8080/dashboard/ 打开工作台再问";
    return fetch(TG_HOST + path, opt).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = JSON.parse(t); } catch (e) { /* 非 JSON */ }
        if (!j) { throw new Error(hint); }
        return j;
      });
    }, function () { throw new Error(hint); });
  }

  function aiPendAll() {
    if (aiPendCache.rows && Date.now() - aiPendCache.ts < 120000) {
      return Promise.resolve(aiPendCache);
    }
    var acc = [];
    function step(n) {
      return aiTg("/tg/pending?page=" + n + "&size=200&sort=conf").then(function (res) {
        if (!res || !res.ok) {
          throw new Error((res && res.error) || "待绑清单未生成，先在「待绑商品」页点「↻ 重新巡检」");
        }
        acc = acc.concat(res.rows || []);
        var total = Number(res.total || 0);
        if (acc.length < total && n < 8) { return step(n + 1); }
        aiPendCache = { ts: Date.now(), rows: acc, counts: res.counts || {}, meta: res.meta || {} };
        return aiPendCache;
      });
    }
    return step(1);
  }

  function aiGroupList(force) {
    if (aiGroupCache && !force && Date.now() - aiGroupCache.ts < 120000) {
      return Promise.resolve(aiGroupCache.rows);
    }
    return aiTg("/tg/groups").then(function (res) {
      if (!res || !res.ok) { throw new Error("读取分组失败：" + ((res && res.error) || "本机服务异常")); }
      var rows = res.groups || [];
      aiGroupCache = { ts: Date.now(), rows: rows };
      return rows;
    });
  }

  function aiMakeBind(a) {
    var gid = String(a.groupId || "").trim();
    var raw = a.items || [];
    if (!gid) { return Promise.reject(new Error("缺少 groupId，请先调用 list_groups 查真实分组 ID")); }
    if (!raw.length) { return Promise.reject(new Error("items 为空")); }
    if (raw.length > 300) { return Promise.reject(new Error("单次最多 300 条，当前 " + raw.length + " 条，请分批")); }
    return Promise.all([aiGroupList(), aiPendAll().catch(function () { return { rows: [] }; })]).then(function (rs) {
      var gs = rs[0];
      var pend = rs[1];
      var target = gs.filter(function (g) { return g.id === gid; })[0];
      if (!target) {
        var hintWord = String(a.groupName || "").slice(0, 6);
        var near = hintWord ? gs.filter(function (g) { return String(g.name || "").indexOf(hintWord) >= 0; }).slice(0, 5)
          .map(function (g) { return g.name + "（" + g.id + "）"; }) : [];
        throw new Error("分组 ID 不存在：" + gid + (near.length ? "；相近的有：" + near.join("、") : "；请先 list_groups"));
      }
      var bySpu = {};
      (pend.rows || []).forEach(function (x) { bySpu[String(x.spuId)] = x; });
      var items = [];
      var seen = {};
      raw.forEach(function (it) {
        var spu = String((it && it.spuId) || it || "");
        if (!spu || seen[spu]) { return; }
        seen[spu] = 1;
        var src = bySpu[spu] || {};
        items.push({
          spuId: spu,
          thirdShopId: String((it && it.thirdShopId) || src.thirdShopId || ""),
          shopName: src.shop || "",
          name: src.name || ""
        });
      });
      var id = "act" + (++aiActSeq);
      // 去重：同一分组 + 同一批商品已有未执行的卡片，直接复用，避免重复生成
      var sig = items.map(function (x) { return x.spuId; }).sort().join(",");
      var existId = null;
      Object.keys(aiActions).forEach(function (k) {
        var ex = aiActions[k];
        if (existId || ex.type !== "bind" || ex.state !== "pending" || ex.groupId !== gid) { return; }
        var exSig = ex.items.map(function (x) { return x.spuId; }).sort().join(",");
        if (exSig === sig) { existId = k; }
      });
      if (existId) {
        return {
          payload: {
            ok: true, status: "already_pending", actionId: existId,
            groupId: gid, groupName: target.name, itemCount: items.length,
            hint: "这批商品此前已生成过待确认卡片（" + existId + "），没有重复生成；等用户确认即可。"
          },
          step: { title: "复用待确认卡片", detail: items.length + " 条 → " + target.name, ok: true, actionId: existId }
        };
      }
      aiActions[id] = {
        type: "bind", groupId: gid, groupName: target.name, items: items,
        note: String(a.note || ""), state: "pending"
      };
      return {
        payload: {
          ok: true, status: "awaiting_user_confirmation", actionId: id,
          groupId: gid, groupName: target.name, itemCount: items.length,
          hint: "已生成待确认卡片，用户点「确认执行」才会真正写入探域；在此之前不要声称已绑定成功。"
        },
        step: { title: "准备绑定", detail: items.length + " 条 → " + target.name, ok: true, actionId: id }
      };
    });
  }

  function aiMakeUnbind(a) {
    var gid = String(a.groupId || "").trim();
    var ids = (a.spuIds || []).map(function (x) { return String(x || "").trim(); }).filter(Boolean);
    if (!gid) { return Promise.reject(new Error("缺少 groupId")); }
    if (!ids.length) { return Promise.reject(new Error("spuIds 为空")); }
    if (ids.length > 300) { return Promise.reject(new Error("单次最多 300 条，当前 " + ids.length + " 条")); }
    return aiGroupList().then(function (gs) {
      var target = gs.filter(function (g) { return g.id === gid; })[0];
      if (!target) { throw new Error("分组 ID 不存在：" + gid + "；请先 list_groups"); }
      var items = ids.map(function (spu) { return { spuId: spu }; });
      var id = "act" + (++aiActSeq);
      aiActions[id] = {
        type: "unbind", groupId: gid, groupName: target.name, items: items,
        note: String(a.note || ""), state: "pending"
      };
      return {
        payload: {
          ok: true, status: "awaiting_user_confirmation", actionId: id,
          groupId: gid, groupName: target.name, itemCount: items.length,
          hint: "已生成待确认卡片，用户点「确认执行」才会真正移出。"
        },
        step: { title: "准备移出", detail: items.length + " 条 ← " + target.name, ok: true, actionId: id }
      };
    });
  }

  var AI_TOOL_IMPL = {
    list_groups: function (a) {
      var q = String(a.q || "").trim().toLowerCase();
      var lim = Math.min(200, Math.max(1, Number(a.limit) || 40));
      return aiGroupList().then(function (all) {
        var hit = q ? all.filter(function (g) { return String(g.name || "").toLowerCase().indexOf(q) >= 0; }) : all;
        var rows = hit.slice(0, lim).map(function (g) {
          return { groupId: g.id, name: g.name, products: g.productNum, shops: g.shops };
        });
        return {
          payload: { ok: true, totalGroups: all.length, matched: hit.length, returned: rows.length, groups: rows },
          step: { title: "查商品分组", detail: (q ? "「" + q + "」" : "全部") + " · 共 " + all.length + " 个，命中 " + hit.length, ok: true }
        };
      });
    },

    query_pending: function (a) {
      var shop = String(a.shop || "").trim();
      var kw = String(a.q || "").trim().toLowerCase();
      var conf = String(a.conf || "all");
      var lim = Math.min(100, Math.max(1, Number(a.limit) || 30));
      return aiPendAll().then(function (c) {
        var list = (c.rows || []).filter(function (x) {
          if (conf !== "all" && x.confidence !== conf) { return false; }
          if (shop && String(x.shop || "").indexOf(shop) < 0) { return false; }
          if (kw) {
            var hay = (x.name || "") + " " + (x.title || "") + " " + (x.outerId || "") + " " + x.spuId + " " + (x.groupName || "");
            if (hay.toLowerCase().indexOf(kw) < 0) { return false; }
          }
          return true;
        });
        var rows = list.slice(0, lim).map(function (x) {
          return {
            spuId: x.spuId,
            thirdShopId: x.thirdShopId,
            shop: x.shop,
            name: String(x.name || x.title || "").slice(0, 60),
            suggestion: x.groupName || "",
            groupId: x.groupId || "",
            confidence: x.confidence,
            verdict: x.verdict,
            reason: x.reason,
            heat7: x.heat7 || 0
          };
        });
        var bits = [shop || "全部店铺", conf === "all" ? "全部置信度" : conf];
        if (kw) { bits.push("关键词 " + kw); }
        return {
          payload: {
            ok: true, scanAt: (c.meta && c.meta.generatedAt) || "",
            matched: list.length, returned: rows.length, countsAll: c.counts || {}, rows: rows
          },
          step: { title: "查在售未绑清单", detail: bits.join(" · ") + " → " + list.length + " 条", ok: true }
        };
      });
    },

    query_group_products: function (a) {
      var gid = String(a.groupId || "").trim();
      if (!gid) { return Promise.reject(new Error("缺少 groupId")); }
      var lim = Math.min(60, Math.max(1, Number(a.limit) || 20));
      return aiTg("/tg/products?gid=" + encodeURIComponent(gid) + "&page=1&size=" + lim +
        "&q=" + encodeURIComponent(String(a.q || ""))).then(function (res) {
          if (!res || !res.ok) { throw new Error((res && res.error) || "读取分组商品失败"); }
          var rows = (res.rows || []).map(function (r) {
            return { spuId: r.spuId, name: String(r.title || "").slice(0, 56), shop: r.shopName, onSale: r.onSale, price: r.price };
          });
          return {
            payload: { ok: true, groupId: gid, total: res.total || 0, returned: rows.length, rows: rows },
            step: { title: "查分组内商品", detail: "组内 " + (res.total || 0) + " 条，返回 " + rows.length, ok: true }
          };
        });
    },

    bind_products: aiMakeBind,
    unbind_products: aiMakeUnbind,

    get_weekly_facts: function (a) {
      var W = window.WeeklyReview;
      if (!W || !W.collect || !W.factsTextOf) { return Promise.reject(new Error("周度复盘模块未加载")); }
      var r = W.defaultNoteRangeKey ? W.defaultNoteRangeKey() : null;
      var start = /^\d{4}-\d{2}-\d{2}$/.test(String(a.start || "")) ? a.start : (r && r.start) || "";
      var end = /^\d{4}-\d{2}-\d{2}$/.test(String(a.end || "")) ? a.end : (r && r.end) || "";
      var data = W.collect(W.getWorkbenchData(), start, end);
      var an = W.analyze(data);
      return Promise.resolve({
        payload: {
          ok: true, start: start, end: end,
          days: data.dayKeys.length, keyShops: data.keyShops.length,
          dropCount: an.drops.length, facts: W.factsTextOf(data, an)
        },
        step: { title: "读周度事实底稿", detail: start + " ~ " + end + " · " + data.dayKeys.length + " 天 · 下滑 " + an.drops.length + " 项", ok: true }
      });
    },

    save_weekly_note: function (a) {
      var W = window.WeeklyReview;
      if (!W || !W.saveNote || !W.NOTE_FIELDS) { return Promise.reject(new Error("周度复盘模块未加载")); }
      var r = W.defaultNoteRangeKey ? W.defaultNoteRangeKey() : null;
      var start = /^\d{4}-\d{2}-\d{2}$/.test(String(a.start || "")) ? a.start : (r && r.start) || "";
      var end = /^\d{4}-\d{2}-\d{2}$/.test(String(a.end || "")) ? a.end : (r && r.end) || "";
      var rk = W.rangeKeyOf(start, end);
      // 只覆盖 AI 传入的栏，没传的保持原样
      var merged = W.readNote(rk);
      var saved = [], overwritten = [];
      W.NOTE_FIELDS.forEach(function (k) {
        if (typeof a[k] === "string" && a[k].trim()) {
          saved.push(k);
          var old = String(merged[k] || "").trim();
          if (old && old !== a[k].trim()) { overwritten.push(k); }
          merged[k] = a[k].trim();
        }
      });
      if (!saved.length) { return Promise.reject(new Error("没有可写入的内容（五栏都为空）")); }
      merged.updatedAt = Date.now();
      W.saveNote(rk, merged, true);
      W.applyNote(rk, merged);
      return Promise.resolve({
        payload: { ok: true, rangeKey: rk, savedFields: saved, overwrittenFields: overwritten },
        step: { title: "写入周度复盘", detail: rk + " · " + saved.length + " 栏" + (overwritten.length ? "（覆盖 " + overwritten.length + " 栏）" : ""), ok: true }
      });
    }
  };

  function aiToolExec(tc) {
    var name = (tc.function && tc.function.name) || "";
    var args = {};
    try { args = JSON.parse((tc.function && tc.function.arguments) || "{}"); } catch (e) { /* 忽略 */ }
    var fn = AI_TOOL_IMPL[name];
    if (!fn) {
      return Promise.resolve({
        payload: { ok: false, error: "未知工具：" + name },
        step: { title: name || "工具", detail: "未实现", ok: false }
      });
    }
    return fn(args).then(function (r) { return r; }, function (e) {
      var msg = String((e && e.message) || e);
      return {
        payload: { ok: false, error: msg },
        step: { title: AI_TOOL_LABEL[name] || name, detail: msg.slice(0, 60), ok: false }
      };
    });
  }

  var AI_TOOL_LABEL = {
    list_groups: "查商品分组",
    query_pending: "查在售未绑清单",
    query_group_products: "查分组内商品",
    bind_products: "准备绑定",
    unbind_products: "准备移出",
    get_weekly_facts: "读周度事实底稿",
    save_weekly_note: "写入周度复盘"
  };

  function aiActionCardHtml(id) {
    var a = aiActions[id];
    if (!a) { return ""; }
    var verb = a.type === "bind" ? "绑定到分组" : "移出分组";
    var head = '<div class="ai-act-head"><b>' + esc(verb) + "</b> · " + esc(a.groupName) +
      ' · <span class="ai-act-n">' + a.items.length + " 条</span></div>";
    var note = a.note ? '<div class="ai-act-note">' + esc(a.note) + "</div>" : "";
    if (a.state === "done") {
      var r = a.result || {};
      var bad = (r.ok === false) || r.failCount > 0;
      var txt = r.ok === false
        ? ("失败：" + esc(r.error || "未知错误"))
        : ("成功 " + (r.okCount || 0) + " 条" + (r.failCount ? " · 失败 " + r.failCount + " 条" : ""));
      return '<div class="ai-act ai-act-done' + (bad ? " ai-act-warn" : "") + '">' + head + note +
        '<div class="ai-act-res">' + txt + "</div></div>";
    }
    if (a.state === "running") {
      return '<div class="ai-act ai-act-running">' + head + note + '<div class="ai-act-res">正在写入探域…</div></div>';
    }
    if (a.state === "skipped") {
      return '<div class="ai-act ai-act-skip">' + head + note + '<div class="ai-act-res">已取消 · 未写入探域</div></div>';
    }
    return '<div class="ai-act">' + head + note +
      '<div class="ai-act-btns"><button class="ai-act-run" data-ai-act="' + esc(id) + '">确认执行</button>' +
      '<button class="ai-act-cancel" data-ai-act-skip="' + esc(id) + '">取消</button></div></div>';
  }

  function aiRunAction(id) {
    var a = aiActions[id];
    if (!a || a.state === "running" || a.state === "done") { return Promise.resolve(); }
    a.state = "running";
    renderAiMessages();
    var body = a.type === "bind"
      ? { items: a.items.map(function (x) { return { spuId: x.spuId, thirdShopId: x.thirdShopId, shopName: x.shopName, groupId: a.groupId }; }) }
      : { groupId: a.groupId, items: a.items };
    return aiTg(a.type === "bind" ? "/tg/bind-auto" : "/tg/unbind", body).then(function (res) {
      a.state = "done";
      a.result = {
        ok: !!(res && res.ok),
        okCount: (res && res.okCount) || 0,
        failCount: (res && res.failCount) || 0,
        error: (res && res.error) || ""
      };
      return a.result;
    }, function (e) {
      a.state = "done";
      a.result = { ok: false, okCount: 0, failCount: a.items.length, error: String((e && e.message) || e) };
      return a.result;
    }).then(function (r) {
      aiPendCache = { ts: 0, rows: null, counts: null, meta: null };
      aiGroupCache = null;
      try { groupsLoad(); } catch (e) { /* 忽略 */ }
      try { if (typeof tgLoadProducts === "function") { tgLoadProducts(); } } catch (e) { /* 忽略 */ }
      renderAiMessages();
      toast(r.ok ? ("已执行 · 成功 " + (r.okCount || 0) + " 条" + (r.failCount ? " / 失败 " + r.failCount + " 条" : ""))
        : ("执行失败：" + (r.error || "")));
      return r;
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) { return; }
    var run = t.closest("[data-ai-act]");
    if (run) { e.preventDefault(); aiRunAction(run.dataset.aiAct); return; }
    var skip = t.closest("[data-ai-act-skip]");
    if (skip) {
      e.preventDefault();
      var a = aiActions[skip.dataset.aiActSkip];
      if (a && a.state === "pending") { a.state = "skipped"; renderAiMessages(); toast("已取消，未写入探域"); }
    }
  });

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

  function aiStepsHtml(m) {
    var st = m && m.steps;
    if (!st || !st.length) { return ""; }
    return '<div class="ai-steps">' + st.map(function (s) {
      return '<div class="ai-step' + (s.ok === false ? " ai-step-bad" : "") + '">' +
        '<span class="ai-step-ico">' + (s.ok === false ? "!" : "✓") + "</span>" +
        '<span class="ai-step-t">' + esc(s.title || "工具") + "</span>" +
        '<span class="ai-step-d">' + esc(s.detail || "") + "</span></div>";
    }).join("") + "</div>";
  }

  function aiActsHtml(m) {
    var ids = (m && m.actions) || [];
    if (!ids.length) { return ""; }
    return '<div class="ai-acts">' + ids.map(aiActionCardHtml).join("") + "</div>";
  }

  function renderAiMessages() {
    var box = $id("aiMessages");
    if (!box) { return; }
    if (!aiMsgs.length) {
      var pn = aiPage && AI_PAGE[aiPage] ? AI_PAGE[aiPage].name : "";
      box.innerHTML = '<div class="ai-empty">' +
        "<p>已接入工作台数据（" + (shopLibrary || []).length + " 家店 · 近 7 天指标 · 达标线）。</p>" +
        "<p>也能直接操作「商品分组」：查分组、查在售未绑、按建议批量绑定（绑定前会生成确认卡片，你点确认才执行）。</p>" +
        (pn ? "<p>当前带上「" + esc(pn) + "」这一页的数据。</p>" : "") +
        "<p>也可以在各页面点右上角 <b>✦ AI</b>，自动带上那一页的数据提问。</p>" +
        "</div>";
      return;
    }
    box.innerHTML = aiMsgs.map(function (m) {
      if (m.role === "user") {
        return '<div class="ai-msg ai-msg-user"><div class="ai-bubble">' + esc(m.content).replace(/\n/g, "<br>") + "</div></div>";
      }
      var stepsHtml = aiStepsHtml(m);
      var actsHtml = aiActsHtml(m);
      if (m.pending) {
        return '<div class="ai-msg ai-msg-bot"><div class="ai-bubble">' + stepsHtml +
          '<div class="ai-waiting" id="aiWaiting">' + (stepsHtml ? "继续处理… 0s" : "正在生成… 0s") + "</div></div></div>";
      }
      if (m.error) {
        return '<div class="ai-msg ai-msg-bot"><div class="ai-bubble ai-err">' + esc(m.content) + "</div></div>";
      }
      return '<div class="ai-msg ai-msg-bot"><div class="ai-bubble">' + stepsHtml +
        (m.content ? aiMd(m.content) : "") +
        actsHtml +
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

  var aiChipList = [];

  function renderAiQuick() {
    var box = $id("aiQuick");
    if (!box) { return; }
    var chips = [];
    var p = aiPage && AI_PAGE[aiPage];
    if (p) {
      p.qs.forEach(function (q) { chips.push({ t: q.t, q: q.q, page: true }); });
    }
    AI_QUICK.forEach(function (q) { chips.push({ t: q.t, q: q.q, page: false }); });
    aiChipList = chips;
    box.innerHTML = chips.map(function (c, i) {
      return '<button class="ai-chip' + (c.page ? " ai-chip-page" : "") + '" data-ai-q="' + i + '">' +
        (c.page ? "· " : "") + esc(c.t) + "</button>";
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
    aiMsgs.push({ role: "assistant", content: "", pending: true, steps: [] });
    renderAiMessages();
    aiSetBusy(true);
    var t0 = Date.now();
    var idx = aiMsgs.length - 1;
    var steps = [];
    var nudged = false;
    var convo = [{ role: "system", content: AI_SYS + aiContextText() + AI_TOOL_HINT }].concat(history);

    function hasAction() {
      for (var i = 0; i < steps.length; i++) { if (steps[i].actionId) { return true; } }
      return false;
    }

    function runRound(n, last) {
      return aiRaw(convo, 4096, 0.3, AI_TOOLS).then(function (r) {
        if (r.toolCalls && n < AI_TOOL_MAX_ROUNDS) {
          convo.push({ role: "assistant", content: r.content || "", tool_calls: r.toolCalls });
          aiMsgs[idx] = { role: "assistant", content: "", pending: true, steps: steps.slice() };
          renderAiMessages();
          return Promise.all(r.toolCalls.map(function (tc) {
            return aiToolExec(tc).then(function (o) {
              return { id: tc.id, out: o };
            });
          })).then(function (outs) {
            outs.forEach(function (x) {
              convo.push({ role: "tool", tool_call_id: x.id, content: JSON.stringify(x.out.payload) });
              steps.push({
                title: x.out.step.title || "工具",
                detail: x.out.step.detail || "",
                ok: x.out.step.ok !== false,
                actionId: x.out.step.actionId || ""
              });
            });
            aiMsgs[idx] = { role: "assistant", content: "", pending: true, steps: steps.slice() };
            renderAiMessages();
            return runRound(n + 1, r);
          });
        }
        // 防幻觉：声称生成了卡片但实际没调用写工具 → 回推一次强制纠正
        var txt = String(r.content || "");
        var claims = /待确认卡片|已生成卡片|已绑定|已经绑/.test(txt);
        if (claims && !hasAction() && !nudged && n < AI_TOOL_MAX_ROUNDS) {
          nudged = true;
          convo.push({ role: "assistant", content: txt });
          convo.push({
            role: "user",
            content: "[系统提示] 用户这次的要求是：" + text + "。你上一条回复里描述了绑定的结果，但你并没有调用 bind_products，" +
              "界面上不存在任何待确认卡片。请严格按用户这次要求的范围，用工具完成：先 query_pending 拿真实 spuId 与 groupId，" +
              "再调用 bind_products 生成卡片；如果数据不足，就直接说明缺什么，不要描述不存在的卡片，也不要把范围扩大到用户没要求的商品。"
          });
          aiMsgs[idx] = { role: "assistant", content: "", pending: true, steps: steps.slice() };
          renderAiMessages();
          return runRound(n + 1, r);
        }
        return r;
      });
    }

    runRound(0, null).then(function (r) {
      var content = String(r.content || "").trim();
      if (!content) {
        content = steps.length ? "（工具已执行，但我没有补充说明。可以追问具体某一项。）" : "（模型没有返回文字内容）";
      }
      var actions = steps.map(function (s) { return s.actionId; }).filter(Boolean);
      aiMsgs[idx] = {
        role: "assistant", content: content, ms: Date.now() - t0,
        model: r.model || "", steps: steps.slice(), actions: actions
      };
      aiSaveMsgs();
      renderAiMessages();
    }).catch(function (e) {
      aiMsgs[idx] = {
        role: "assistant", content: "调用失败：" + String((e && e.message) || e),
        error: true, steps: steps.slice()
      };
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
        : "尚未配置。Key 只保存在本机浏览器（localStorage），不上传云端、不写入代码。";
    }
    var st = $id("aiStatusText");
    if (st) {
      st.textContent = aiCfg.configured
        ? (aiCfg.name || "AI") + " · " + (aiCfg.model || "") + " · 已读取工作台数据 · 可操作商品分组"
        : "未配置接口 · 点右上角「接口设置」填写 Key";
    }
  }

  function loadAiConfig() {
    var c = aiReadCfg();
    aiCfg = c
      ? { loaded: true, configured: true, name: c.name, baseUrl: c.baseUrl, model: c.model, keyMask: aiMask(c.apiKey) }
      : { loaded: true, configured: false };
    aiCfgOpen = !aiCfg.configured;
    renderAiConfigForm();
  }

  function saveAiConfig() {
    var name = ($id("aiCfgName").value || "").trim() || "DeepSeek";
    var baseUrl = ($id("aiCfgBase").value || "").trim() || "https://api.deepseek.com";
    var model = ($id("aiCfgModel").value || "").trim() || "deepseek-chat";
    var apiKey = ($id("aiCfgKey").value || "").trim();
    var old = aiReadCfg();
    if (!apiKey && old) { apiKey = old.apiKey; }   // 留空 = 沿用原 Key
    if (!apiKey) { toast("请填写 API Key"); return; }
    if (!/^https?:\/\//i.test(baseUrl)) { toast("接口地址需以 http(s):// 开头"); return; }

    try {
      localStorage.setItem(AI_CFG_KEY, JSON.stringify({
        name: name, baseUrl: baseUrl.replace(/\/+$/, ""), model: model, apiKey: apiKey
      }));
    } catch (e) {
      toast("浏览器禁止本地存储，无法保存 Key");
      return;
    }
    aiCfg = { loaded: true, configured: true, name: name, baseUrl: baseUrl, model: model, keyMask: aiMask(apiKey) };
    var kEl = $id("aiCfgKey");
    if (kEl) { kEl.value = ""; }
    renderAiConfigForm();

    var btn = $id("aiCfgSave");
    if (btn) { btn.disabled = true; btn.textContent = "测试中…"; }
    aiRaw([{ role: "user", content: "回复两个字：可用" }], 16, 0).then(function (r) {
      aiCfgOpen = false;
      renderAiConfigForm();
      toast("已保存，连接正常（" + String(r.content).trim().slice(0, 20) + "）");
    }).catch(function (e) {
      toast("已保存，但连接失败：" + String((e && e.message) || e));
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = "保存并测试"; }
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
      var q = aiChipList[Number(b.dataset.aiQ)];
      if (q) { aiAsk(q.q); }
    });
    var cc = $id("aiCtxClear");
    if (cc) { cc.onclick = aiClearPage; }
  }

  function wbRenderAi() {
    bindAiEvents();
    aiLoadMsgs();
    renderAiMessages();
    renderAiCtxBar();
    renderAiQuick();
    loadAiConfig();
    renderAiConfigForm();
  }

  window.wbRenderAi = wbRenderAi;
  window.wbAiAsk = aiAsk;
  // 供周度复盘(weekly-review.js)读取实时数据，避免走 localStorage 兜底拿到旧快照
  window.__wbState = state;

  // 周度复盘笔记（分析与思考 / 止血 / 治本 / 防复发 / 下周计划）写云端：
  // 存 state.days.__library__.weekly[区间键]，Object.assign 保留 monthly / shops 等其它键
  window.wbSaveWeeklyNote = function (rk, note) {
    if (!rk || !note) { return; }
    var lib = state.days["__library__"] || {};
    var weekly = Object.assign({}, lib.weekly || {});
    weekly[rk] = note;
    state.days["__library__"] = Object.assign({}, lib, { weekly: weekly });
    try { wbSave(); } catch (e) { /* 云端不可用时本地已存 */ }
  };

  window.wbRefresh = function () { wbReady = false; wbInit(); };
  window.addEventListener("DOMContentLoaded", wbInit);
  if (document.readyState !== "loading") { wbInit(); }
})();
