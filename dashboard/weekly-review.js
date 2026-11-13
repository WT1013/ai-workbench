/* ============================================================
 * weekly-review.js — 周度复盘模块（接入远山数据驾驶舱）
 * 输入：工作台「每日工作日报」数据（指标 shopData + 任务 tasks + 日报文本 csa-report-draft）
 * 输出：套用《问题分析与解决》方法论的六段式复盘 + 每日日报原文速览
 * 数据源优先级：window.__wbState（实时） → localStorage csa-workbench-v1（兜底）
 * ============================================================ */
(function () {
  "use strict";

  var METRICS = [
    { key: "adoptionRate",      label: "采纳率",       unit: "%", target: 65, higher: true },
    { key: "generationRate",    label: "生成率",       unit: "%", target: 95, higher: true },
    { key: "conversionRate",    label: "转化率",       unit: "%", target: null, higher: true },
    { key: "pureAgentRatio",    label: "纯智能体占比", unit: "%", target: 35, higher: true },
    { key: "riskRate",          label: "风控率",       unit: "%", target: 15, higher: false },
    { key: "experienceScore",   label: "体验分",       unit: "",  target: null, higher: true },
    { key: "threeMinReplyRate", label: "3分钟回复率",  unit: "%", target: 95, higher: true }
  ];
  var TASKS = [
    { id: "data-update",    name: "数据更新" },
    { id: "pre-reception",  name: "前置接待监控" },
    { id: "label-scene",    name: "调优工坊-打标场景" },
    { id: "script-missing", name: "调优工坊-未生成话术" },
    { id: "tuling-qa",      name: "探域-图灵问答" },
    { id: "appeal",         name: "申诉处理" },
    { id: "others",         name: "其他事项" },
    { id: "kb-update",      name: "知识库更新" },
    { id: "rpa",            name: "售后RPA维护" }
  ];

  /* ---------- 内联图标（SVG，无外链，离线/打印均可用） ---------- */
  var ICON = {
    calendar: '<rect x="3.2" y="4.8" width="17.6" height="15.4" rx="2.6"/><path d="M8 2.8v3.6M16 2.8v3.6M3.2 9.6h17.6"/>',
    shop:     '<path d="M3.4 9.4h17.2M4.9 9.4V20h14.2V9.4"/><path d="M3.4 9.4 5.4 4h13.2l2 5.4"/><path d="M9.6 20v-5.2h4.8V20"/>',
    alert:    '<path d="M12 3.9 21.2 20H2.8z"/><path d="M12 9.6v4.4M12 16.9v.3"/>',
    chat:     '<path d="M20.2 15.1a2.7 2.7 0 0 1-2.7 2.7H8.2L4 21V6.9a2.7 2.7 0 0 1 2.7-2.7h10.8a2.7 2.7 0 0 1 2.7 2.7z"/>',
    chart:    '<path d="M4 4v16h16"/><path d="M7.4 15.2 11 10.6l3 2.9 5.4-6.2"/>',
    check:    '<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="3.4"/><path d="M8.2 12.3l2.7 2.7 5-5.6"/>',
    doc:      '<path d="M13.4 3.4H6.6A1.6 1.6 0 0 0 5 5v14a1.6 1.6 0 0 0 1.6 1.6h10.8A1.6 1.6 0 0 0 19 19V9z"/><path d="M13.4 3.4V9H19"/>',
    target:   '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.6"/>',
    bolt:     '<path d="M13.2 3 5.8 13.4h5.4L10.8 21l7.4-10.4h-5.4z"/>'
  };
  function ico(name, cls, size) {
    var d = ICON[name];
    if (!d) { return ""; }
    var s = size || 14;
    return '<svg class="ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }
  // 迷你走势线：一眼看出这一周是涨、是跌、还是平
  function sparkSvg(vals) {
    var idx = [], min = Infinity, max = -Infinity;
    (vals || []).forEach(function (v, i) {
      if (v === null || v === undefined || !isFinite(v)) { return; }
      idx.push([i, v]);
      if (v < min) { min = v; }
      if (v > max) { max = v; }
    });
    if (idx.length < 2) { return ""; }
    var W = 58, H = 16, P = 3;
    var span = (max - min) || 1;
    var step = (W - P * 2) / Math.max(1, (vals.length - 1));
    var pts = idx.map(function (p) {
      return [Math.round((P + p[0] * step) * 10) / 10, Math.round((H - P - ((p[1] - min) / span) * (H - P * 2)) * 10) / 10];
    });
    var d = pts.map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join(" ");
    var f = idx[0][1], l = idx[idx.length - 1][1];
    var cls = (l > f + 1e-9) ? "up" : ((l < f - 1e-9) ? "down" : "flat");
    var lp = pts[pts.length - 1];
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" aria-hidden="true">' +
      '<path class="ln" d="' + d + '"/>' +
      '<circle class="spark-dot ' + cls + '" cx="' + lp[0] + '" cy="' + lp[1] + '" r="2.3"/></svg>';
  }

  function isKeyShop(s) { return !!(s && s.key === true); }
  function num(v) {
    if (v === undefined || v === null || v === "") { return null; }
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }
  function fmt(v, unit) {
    if (v === null || v === undefined) { return "—"; }
    var s = String(Math.round(v * 100) / 100);
    return unit === "%" ? s + "%" : s + (unit || "");
  }
  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function weekday(k) {
    var p = String(k).split("-").map(Number);
    if (p.length !== 3) { return ""; }
    return "周" + "日一二三四五六"[new Date(p[0], p[1] - 1, p[2]).getDay()];
  }
  function shiftKey(k, delta) {
    var p = String(k).split("-").map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function readDraft() {
    try { return JSON.parse(localStorage.getItem("csa-report-draft") || "{}") || {}; } catch (e) { return {}; }
  }

  /* ---------- 周度笔记：分析与思考 / 止血 / 治本 / 防复发 / 下周计划 ----------
   * 存 localStorage(csa-weekly-note-v1) + 云端 state.days.__library__.weekly[区间键]
   * 两端按 updatedAt 取新，换设备能看到 */
  var NOTE_KEY = "csa-weekly-note-v1";
  var NOTE_FIELDS = ["think", "stop", "fix", "prevent", "plan"];

  function rangeKeyOf(start, end) { return String(start || "") + "_" + String(end || ""); }

  function readNotes() {
    try { return JSON.parse(localStorage.getItem(NOTE_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function emptyNote() {
    return { think: "", stop: "", fix: "", prevent: "", plan: "", updatedAt: 0 };
  }
  function normNote(n) {
    var o = emptyNote();
    if (n && typeof n === "object") {
      NOTE_FIELDS.forEach(function (k) { if (n[k] != null) { o[k] = String(n[k]); } });
      o.updatedAt = Number(n.updatedAt) || 0;
    }
    return o;
  }
  // 云端更晚的覆盖本机，返回合并后的全量
  function hydrateNotes(ctx) {
    var all = readNotes();
    var lib = ((ctx && ctx.days && ctx.days["__library__"]) || {});
    var cloud = lib.weekly || {};
    var changed = false;
    Object.keys(cloud).forEach(function (rk) {
      var c = normNote(cloud[rk]);
      var l = normNote(all[rk]);
      if (c.updatedAt > l.updatedAt) { all[rk] = c; changed = true; }
    });
    if (changed) { try { localStorage.setItem(NOTE_KEY, JSON.stringify(all)); } catch (e) {} }
    return all;
  }
  function readNote(rk) { return normNote(readNotes()[rk]); }

  function saveNote(rk, obj, pushCloud) {
    var all = readNotes();
    var n = emptyNote();
    NOTE_FIELDS.forEach(function (k) { n[k] = obj && obj[k] != null ? String(obj[k]) : ""; });
    n.updatedAt = Date.now();
    all[rk] = n;
    try { localStorage.setItem(NOTE_KEY, JSON.stringify(all)); } catch (e) {}
    if (pushCloud !== false && typeof window.wbSaveWeeklyNote === "function") {
      try { window.wbSaveWeeklyNote(rk, n); } catch (e) {}
    }
    return n;
  }
  function noteFilled(n) {
    return NOTE_FIELDS.filter(function (k) { return String((n && n[k]) || "").trim(); }).length;
  }
  function tsLabel(ms) {
    if (!ms) { return ""; }
    var d = new Date(Number(ms));
    if (isNaN(d.getTime())) { return ""; }
    var today = todayKey();
    var k = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    var hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    return k === today ? hm : (k.slice(5) + " " + hm);
  }

  /* ---------- AI 拟稿（读 workbench 同一份 Key 配置，浏览器直连） ---------- */
  function aiCfg() {
    try {
      var c = JSON.parse(localStorage.getItem("csa-ai-cfg-v1") || "null");
      return (c && c.apiKey) ? c : null;
    } catch (e) { return null; }
  }
  var DRAFT_SYS = "你是拼多多客服 AI 运营的数据分析助手。只依据给定事实写周复盘结论，禁止编造店铺名、数字或未发生的事。" +
    "下面五个标签必须全部输出，缺一不可；每个标签下写 1~3 句具体、可执行的中文，不要空话套话，不要照抄事实原文。\n" +
    "严格按此格式输出，标签独占一行，标签后直接写内容，不要任何额外说明：\n" +
    "【思考】根因判断与依据\n" +
    "【止血】本周已做或立即要做的止损动作\n" +
    "【治本】针对根因的永久修复（改哪一处配置/补哪个场景）\n" +
    "【防复发】巡检或校验机制，让同类问题下次能被提前发现\n" +
    "【下周计划】2~4 条，每条一行，写清做什么、做到什么程度";

  function parseDraft(text) {
    var out = { think: "", stop: "", fix: "", prevent: "", plan: "" };
    var map = { "思考": "think", "止血": "stop", "治本": "fix", "防复发": "prevent", "下周计划": "plan" };
    var re = /【(思考|止血|治本|防复发|下周计划)】/g;
    var marks = [], m;
    while ((m = re.exec(text))) { marks.push({ key: map[m[1]], at: m.index, after: re.lastIndex }); }
    if (!marks.length) { out.think = String(text || "").trim(); return out; }
    marks.forEach(function (x, i) {
      var seg = text.slice(x.after, i + 1 < marks.length ? marks[i + 1].at : text.length);
      out[x.key] = String(seg).replace(/^[\s:：]+/, "").trim();
    });
    return out;
  }

  function aiDraft(factsText, cb) {
    var c = aiCfg();
    if (!c) { cb(new Error("尚未配置 AI 接口 · 在工作台右上角「接口设置」填 Key")); return; }
    var url = String(c.baseUrl || "https://api.deepseek.com").replace(/\/+$/, "") + "/chat/completions";
    // 模型偶发返回空内容，自动重试一次
    function attempt(left) {
      return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + c.apiKey },
        body: JSON.stringify({
          model: c.model || "deepseek-chat",
          messages: [
            { role: "system", content: DRAFT_SYS },
            { role: "user", content: "以下是本周真实数据与日报记录：\n" + factsText }
          ],
          temperature: 0.35,
          max_tokens: 2400,
          stream: false
        })
      }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) { throw new Error((j && j.error && j.error.message) || ("HTTP " + r.status)); }
          var t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
          var parsed = parseDraft(t || "");
          if (!(parsed.think || parsed.stop || parsed.fix || parsed.prevent || parsed.plan)) {
            throw new Error("接口返回内容为空");
          }
          return parsed;
        });
      }).catch(function (e) {
        if (left > 1) { return attempt(left - 1); }
        throw e;
      });
    }
    attempt(2).then(function (p) { cb(null, p); }, function (e) {
      cb(new Error((e && e.message) || String(e)));
    });
  }

  // 实时优先：workbench.js 已挂 window.__wbState
  function getWorkbenchData() {
    var days = {}, shops = [];
    var live = typeof window !== "undefined" ? window.__wbState : null;
    if (live && live.days) {
      days = live.days;
    } else {
      try {
        var wb = JSON.parse(localStorage.getItem("csa-workbench-v1") || "{}");
        days = (wb && wb.days) || {};
      } catch (e) {}
    }
    if (days["__library__"] && days["__library__"].shops) { shops = days["__library__"].shops; }
    return { days: days, draft: readDraft(), shops: shops };
  }

  // 最近一天有店铺指标的日期（跳过空壳日）
  function latestDayKey(ctx) {
    var keys = Object.keys(ctx.days || {}).filter(function (k) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) { return false; }
      var sd = (ctx.days[k] || {}).shopData || {};
      return Object.keys(sd).length > 0;
    }).sort();
    return keys.length ? keys[keys.length - 1] : todayKey();
  }

  function collect(ctx, start, end) {
    var dayKeys = Object.keys(ctx.days || {}).filter(function (k) {
      return /^\d{4}-\d{2}-\d{2}$/.test(k) && (!start || k >= start) && (!end || k <= end);
    }).sort();
    var keyShops = (ctx.shops || []).filter(isKeyShop);
    if (!keyShops.length) { keyShops = (ctx.shops || []).slice(); }

    var series = {};
    keyShops.forEach(function (s) {
      var m = {};
      METRICS.forEach(function (mt) { m[mt.key] = []; });
      dayKeys.forEach(function (dk) {
        var sd = ((ctx.days[dk] || {}).shopData || {})[s.id] || {};
        METRICS.forEach(function (mt) {
          var v = num(sd[mt.key]);
          if (v !== null) { m[mt.key].push({ date: dk, val: v }); }
        });
      });
      series[s.id] = { name: s.name, metrics: m };
    });

    var taskDone = {};
    TASKS.forEach(function (t) { taskDone[t.id] = 0; });
    var taskStatus = { done: 0, doing: 0, todo: 0 };
    var taskDays = 0;
    dayKeys.forEach(function (dk) {
      var tk = (ctx.days[dk] || {}).tasks || {};
      var any = false;
      TASKS.forEach(function (t) {
        var st = tk[t.id];
        if (st && typeof st === "object") { st = st.status; }
        if (!st) { return; }
        any = true;
        if (st === "done") { taskDone[t.id]++; taskStatus.done++; }
        else if (st === "doing") { taskStatus.doing++; }
        else { taskStatus.todo++; }
      });
      if (any) { taskDays++; }
    });

    var texts = dayKeys.map(function (dk) {
      var d = ctx.draft[dk] || {};
      return {
        date: dk,
        summary: String(d.summary || "").trim(),
        feedback: String(d.feedback || "").trim(),
        weekFocus: String(d.weekFocus || "").trim(),
        tomorrow: String(d.tomorrow || "").trim()
      };
    });

    // 每日指标速览（重点店均值）
    var dailyAvg = dayKeys.map(function (dk) {
      var sd = (ctx.days[dk] || {}).shopData || {};
      var row = { date: dk, vals: {} };
      METRICS.forEach(function (mt) {
        var arr = keyShops.map(function (s) { return num((sd[s.id] || {})[mt.key]); }).filter(function (v) { return v !== null; });
        row.vals[mt.key] = arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null;
      });
      return row;
    });

    return { dayKeys: dayKeys, keyShops: keyShops, series: series, taskDone: taskDone, taskDays: taskDays, taskStatus: taskStatus, texts: texts, dailyAvg: dailyAvg };
  }

  function analyze(data) {
    var metricStatus = [];
    data.keyShops.forEach(function (s) {
      var ser = data.series[s.id];
      METRICS.forEach(function (mt) {
        var arr = ser.metrics[mt.key];
        if (!arr.length) { return; }
        var first = arr[0].val, last = arr[arr.length - 1].val;
        var avg = arr.reduce(function (a, b) { return a + b.val; }, 0) / arr.length;
        var drop = mt.higher === true ? (last < first) : (mt.higher === false ? (last > first) : false);
        metricStatus.push({
          shop: s.name, key: mt.key, label: mt.label, unit: mt.unit,
          target: mt.target, higher: mt.higher,
          first: first, last: last, avg: avg, delta: last - first, drop: drop, n: arr.length
        });
      });
    });
    var drops = metricStatus.filter(function (x) { return x.drop; });
    var feedbackDays = data.texts.filter(function (t) { return t.feedback; }).length;
    var summDays = data.texts.filter(function (t) { return t.summary; }).length;
    return { metricStatus: metricStatus, drops: drops, feedbackDays: feedbackDays, summDays: summDays };
  }

  function buildText(data, an, rangeLabel, note) {
    var n = normNote(note);
    var L = [];
    var doneTotal = TASKS.reduce(function (a, t) { return a + data.taskDone[t.id]; }, 0);
    L.push("【周度复盘】" + rangeLabel);
    L.push("覆盖 " + data.dayKeys.length + " 天 ｜ 重点店 " + data.keyShops.length + " 家 ｜ 下滑 " + an.drops.length +
      " 项 ｜ 问题反馈 " + an.feedbackDays + " 天 ｜ 任务 " + doneTotal + "/" + (TASKS.length * Math.max(1, data.taskDays)));
    L.push("");
    L.push("一、需要关注");
    if (an.drops.length) {
      an.drops.forEach(function (x) {
        L.push("· " + x.shop + " " + x.label + "：" + fmt(x.first, x.unit) + " → " + fmt(x.last, x.unit) +
          "（" + (x.delta > 0 ? "+" : "") + (Math.round(x.delta * 100) / 100) + (x.unit === "%" ? "pct" : "") +
          "），周均 " + fmt(x.avg, x.unit) + (x.target != null ? "，目标 " + x.target + (x.unit === "%" ? "%" : "") : ""));
      });
    } else {
      L.push("· 本周重点店铺核心指标整体平稳，无显著下滑项。");
    }
    data.texts.forEach(function (t) { if (t.feedback) { L.push("· " + t.date + " 问题反馈：" + t.feedback); } });
    L.push("");
    L.push("二、分析与思考");
    L.push(n.think ? n.think : "（待补充：根因判断与依据）");
    L.push("");
    L.push("三、解决方案与下周计划");
    var summJoined = data.texts.map(function (t) { return t.summary; }).filter(Boolean).join("；");
    var toms = data.texts.map(function (t) { return t.tomorrow; }).filter(Boolean);
    L.push("· 止血：" + (n.stop || summJoined || "（待补充）"));
    L.push("· 治本：" + (n.fix || "（待补充）"));
    L.push("· 防复发：" + (n.prevent || "（待补充）"));
    L.push("· 下周计划：" + (n.plan || (toms.length ? toms.join("；") : "（待补充）")));
    L.push("· 验证：下周同区间复查，回到目标线或环比改善即通过（T-3 / T-1 观察）。");
    return L.join("\n");
  }

  /* ---------- 笔记交互：输入即存、AI 拟稿 ---------- */
  function curRangeKey(container) {
    var el = container.querySelector("[data-wk-note]");
    return el ? el.getAttribute("data-wk-note") : "";
  }
  function setSaveTip(container, text, key) {
    var els = container.querySelectorAll("[data-save-tip]");
    for (var i = 0; i < els.length; i++) {
      if (key && els[i].getAttribute("data-save-tip") !== key) { continue; }
      els[i].textContent = text;
    }
  }
  function factsTextOf(data, an) {
    var L = [];
    L.push("区间 " + (data.dayKeys[0] || "") + " ~ " + (data.dayKeys[data.dayKeys.length - 1] || "") +
      "，覆盖 " + data.dayKeys.length + " 天，重点店 " + data.keyShops.length + " 家。");
    L.push("");
    L.push("【重点店指标下滑】共 " + an.drops.length + " 项");
    an.drops.slice(0, 20).forEach(function (x) {
      L.push("- " + x.shop + " " + x.label + "：" + fmt(x.first, x.unit) + " → " + fmt(x.last, x.unit) +
        "，周均 " + fmt(x.avg, x.unit) + (x.target != null ? "，目标 " + x.target + x.unit : ""));
    });
    if (!an.drops.length) { L.push("- 无显著下滑"); }
    L.push("");
    L.push("【每日重点店均值】");
    data.dailyAvg.forEach(function (row) {
      L.push("- " + row.date + "：" + METRICS.map(function (mt) {
        return mt.label + " " + fmt(row.vals[mt.key], mt.unit);
      }).join(" / "));
    });
    L.push("");
    L.push("【日报记录】");
    var anyText = false;
    data.texts.forEach(function (t) {
      var seg = [];
      if (t.summary) { seg.push("配置总结:" + t.summary); }
      if (t.feedback) { seg.push("问题反馈:" + t.feedback); }
      if (t.weekFocus) { seg.push("本周重点:" + t.weekFocus); }
      if (t.tomorrow) { seg.push("明日待办:" + t.tomorrow); }
      if (seg.length) { L.push("- " + t.date + " " + seg.join(" | ")); anyText = true; }
    });
    if (!anyText) { L.push("- 本周日报未填写"); }
    return L.join("\n");
  }

  function bindNoteEvents(container) {
    if (container._wkNoteBound) { return; }
    container._wkNoteBound = true;

    function autoGrow(ta) {
      if (!ta || ta.tagName !== "TEXTAREA") { return; }
      ta.style.height = "auto";
      var h = Math.min(Math.max(ta.scrollHeight + 2, 56), 460);
      ta.style.height = h + "px";
      // 同一行三列取等高，底部不参差
      var grid = ta.closest ? ta.closest(".wk-note-grid") : null;
      if (!grid) { return; }
      var sibs = grid.querySelectorAll("textarea[data-note]");
      var max = 0, i;
      for (i = 0; i < sibs.length; i++) {
        sibs[i].style.height = "auto";
        if (sibs[i].scrollHeight + 2 > max) { max = sibs[i].scrollHeight + 2; }
      }
      max = Math.min(Math.max(max, 56), 460);
      for (i = 0; i < sibs.length; i++) { sibs[i].style.height = max + "px"; }
    }
    container._wkAutoGrow = function () {
      var all = container.querySelectorAll("textarea[data-note]");
      for (var i = 0; i < all.length; i++) { autoGrow(all[i]); }
    };

    container.addEventListener("input", function (e) {
      var ta = e.target;
      if (!ta || !ta.getAttribute || !ta.getAttribute("data-note")) { return; }
      autoGrow(ta);
      var rk = curRangeKey(container);
      if (!rk) { return; }
      var key = ta.getAttribute("data-note");
      // 先落本地：两个框同时编辑时不会互相覆盖
      var all = readNotes();
      var n = normNote(all[rk]);
      n[key] = ta.value;
      n.updatedAt = Date.now();
      all[rk] = n;
      try { localStorage.setItem(NOTE_KEY, JSON.stringify(all)); } catch (e2) {}
      setSaveTip(container, "保存中…", key);
      clearTimeout(container._wkPushT);
      container._wkPushT = setTimeout(function () {
        var last = readNote(rk);
        saveNote(rk, last, true);
        setSaveTip(container, "已保存 · " + tsLabel(last.updatedAt), key);
      }, 900);
    });

    // 失焦时立即推云端，避免关页面丢内容
    container.addEventListener("blur", function (e) {
      var ta = e.target;
      if (!ta || !ta.getAttribute || !ta.getAttribute("data-note")) { return; }
      var rk = curRangeKey(container);
      if (!rk) { return; }
      clearTimeout(container._wkPushT);
      var last = readNote(rk);
      saveNote(rk, last, true);
      setSaveTip(container, "已保存 · " + tsLabel(last.updatedAt), ta.getAttribute("data-note"));
    }, true);

  // AI 拟稿：有旧内容就明确告知会覆盖，生成后五栏全量写入（不再只补空栏）
  container.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-wk-draft]") : null;
    if (!btn) { return; }
    var cx = container._wkCtx;
    if (!cx) { return; }
    var rk = curRangeKey(container);
    var n = readNote(rk);
    var oldCnt = NOTE_FIELDS.filter(function (k) { return String(n[k] || "").trim(); }).length;
    if (oldCnt) {
      if (!window.confirm("已有 " + oldCnt + " 栏内容，AI 初稿会覆盖它们，继续吗？")) { return; }
    }
    btn.disabled = true;
    btn.textContent = "生成中…";
    aiDraft(factsTextOf(cx.data, cx.an), function (err, out) {
      btn.disabled = false;
      btn.textContent = "✦ AI 拟稿";
      if (err) { toast("AI 拟稿失败：" + err.message); return; }
      var now = readNote(rk);
      var filled = 0;
      NOTE_FIELDS.forEach(function (k) {
        var gen = String(out[k] || "").trim();
        if (gen) { now[k] = gen; filled++; }
      });
      if (!filled) { toast("AI 未返回可用内容，请重试"); return; }
      saveNote(rk, now, true);
      NOTE_FIELDS.forEach(function (k) {
        var ta = container.querySelector('textarea[data-note="' + k + '"]');
        if (ta) { ta.value = now[k] || ""; }
      });
      if (container._wkAutoGrow) { container._wkAutoGrow(); }
      setSaveTip(container, "AI 初稿 · 已保存，可继续修改");
      toast("AI 已生成初稿 · " + filled + " 栏" + (oldCnt ? "（已覆盖）" : ""));
    });
  });
}

  function render(container, opts) {
    opts = opts || {};
    var ctx = opts.ctx || getWorkbenchData();
    if (!opts.start && !opts.end) {
      var end = latestDayKey(ctx);
      opts.end = end;
      opts.start = shiftKey(end, -6);
    }
    var data = collect(ctx, opts.start, opts.end);
    var an = analyze(data);
    var rangeLabel = (data.dayKeys[0] || opts.start || "?") + " ~ " + (data.dayKeys[data.dayKeys.length - 1] || opts.end || "?");
    var html = [];

    html.push('<div class="wk-head"><div class="wk-range">区间 ' + esc(rangeLabel) +
      ' ｜ 覆盖 ' + data.dayKeys.length + ' 天 ｜ 重点店 ' + data.keyShops.length + ' 家</div></div>');

    if (!data.dayKeys.length) {
      html.push('<div class="wk-card"><div class="empty">所选区间无数据。请确认：① 工作台已产生每日数据（店铺库/同步数据）；② 区间日期正确。</div></div>');
      container.innerHTML = '<div class="wb-weekly">' + html.join("") + '</div>';
      container._weeklyText = "【周度复盘】" + rangeLabel + "\n（无数据）";
      return { data: data, analyze: an, text: container._weeklyText };
    }

    // ① 概览
    var doneTotal = TASKS.reduce(function (a, t) { return a + data.taskDone[t.id]; }, 0);
    var taskCap = TASKS.length * data.taskDays;
    html.push('<div class="wk-card"><h3><span class="wk-ico">' + ico("chart", "", 13) + '</span>① 本周概览</h3><div class="wk-kv-grid">');
    html.push('<div class="kv"><span>' + ico("calendar", "kv-ico", 13) + '覆盖天数</span><b>' + data.dayKeys.length + ' 天</b></div>');
    html.push('<div class="kv"><span>' + ico("shop", "kv-ico", 13) + '重点店铺</span><b>' + data.keyShops.length + ' 家</b></div>');
    html.push('<div class="kv"><span>' + ico(an.drops.length ? "alert" : "check", "kv-ico" + (an.drops.length ? " warn" : ""), 13) +
      '指标下滑</span><b' + (an.drops.length ? ' class="up"' : '') + '>' + an.drops.length + ' 项</b></div>');
    html.push('<div class="kv"><span>' + ico("chat", "kv-ico", 13) + '问题反馈</span><b>' + an.feedbackDays + ' 天</b></div>');
    html.push('</div>');
    html.push('<div class="wk-note">任务完成 ' + doneTotal + ' / ' + taskCap + '（项·天）' +
      (data.taskStatus && (data.taskStatus.done + data.taskStatus.doing + data.taskStatus.todo) ?
        '，完成 ' + data.taskStatus.done + ' · 进行 ' + data.taskStatus.doing + ' · 待办 ' + data.taskStatus.todo : '') + '</div>');
    html.push('</div>');

    // ② 每日指标速览
    html.push('<div class="wk-card"><h3><span class="wk-ico">' + ico("calendar", "", 13) + '</span>② 每日指标速览 <span class="tag">重点店均值</span></h3>');
    html.push('<div class="wk-table-wrap"><table class="tbl-daily"><thead><tr><th>日期</th>');
    // 表头带一周迷你走势线：不看数字也能看出涨跌方向
    METRICS.forEach(function (mt) {
      var col = data.dailyAvg.map(function (r) { return r.vals[mt.key]; });
      html.push('<th class="num"><span class="th-l">' + esc(mt.label) + '</span>' + sparkSvg(col) + '</th>');
    });
    html.push('</tr></thead><tbody>');
    data.dailyAvg.forEach(function (row, ri) {
      html.push('<tr><td>' + esc(row.date) + ' <span class="wk-wd">' + weekday(row.date) + '</span></td>');
      METRICS.forEach(function (mt) {
        var v = row.vals[mt.key];
        var pv = ri > 0 ? data.dailyAvg[ri - 1].vals[mt.key] : null;
        var bad = mt.target != null && v !== null && (mt.higher ? v < mt.target : v > mt.target);
        var ar = "";
        var arCls = "";
        if (v !== null && pv !== null) {
          var dv = v - pv;
          if (Math.abs(dv) >= 0.01) { arCls = dv > 0 ? "up" : "down"; ar = dv > 0 ? "▲" : "▼"; }
        }
        // 箭头槽固定宽度：无论有无箭头，右对齐的数值都落在同一条竖线上
        html.push('<td class="num' + (bad ? ' bad' : '') + '">' + fmt(v, mt.unit) +
          '<i class="ar ' + arCls + '">' + ar + '</i></td>');
      });
      html.push('</tr>');
    });
    html.push('</tbody></table></div></div>');

    // ③ 需要关注（只列真问题：指标下滑 + 日报问题）
    html.push('<div class="wk-card"><h3><span class="wk-ico wk-ico-warn">' + ico("alert", "", 13) + '</span>③ 需要关注 <span class="tag">下滑 ' + an.drops.length + ' 项 ｜ 日报反馈 ' + an.feedbackDays + ' 天</span></h3>');
    if (an.drops.length) {
      html.push('<div class="wk-table-wrap"><table><thead><tr><th>店铺</th><th>指标</th><th class="num">首日 → 末日</th><th class="num">变动</th><th class="num">周均</th></tr></thead><tbody>');
      var prevShop = null;
      an.drops.forEach(function (x) {
        var tgt = x.target != null ? (x.higher === false ? " ≤" : " ≥") + x.target + (x.unit === "%" ? "%" : "") : "";
        var nameCell = (x.shop === prevShop) ? "" : esc(x.shop);
        var isGrp = (prevShop !== null && x.shop !== prevShop) ? ' class="grp"' : "";
        prevShop = x.shop;
        // 本表全为「变差」项，变动列统一警示色，箭头表方向、数字用绝对值，避免「↓-5.21」方向重复
        var mag = Math.round(Math.abs(x.delta) * 100) / 100;
        html.push('<tr' + isGrp + '><td>' + nameCell + '</td><td>' + ico("alert", "row-alert", 12) + esc(x.label) + (tgt ? ' <span class="wk-target">' + tgt + '</span>' : '') +
          '</td><td class="num">' + fmt(x.first, x.unit) + ' → ' + fmt(x.last, x.unit) + '</td>' +
          '<td class="num mov"><i class="ar">' + (x.delta > 0 ? "▲" : (x.delta < 0 ? "▼" : "—")) + '</i>' + mag +
          (x.unit === "%" ? "pct" : "") + '</td><td class="num">' + fmt(x.avg, x.unit) + '</td></tr>');
      });
      html.push('</tbody></table></div>');
    } else {
      html.push('<div class="fb muted">本周重点店铺核心指标整体平稳，无显著下滑项。</div>');
    }
    data.texts.forEach(function (t) {
      if (t.feedback) { html.push('<div class="fb"><div class="dt">' + t.date + ' ' + weekday(t.date) + '</div>' + esc(t.feedback) + '</div>'); }
    });
    html.push('</div>');

    // ③附：全店指标明细（折叠；导出发给他人时自动剔除）
    html.push('<details class="wk-card" data-skip-export="1"><summary class="wk-summary"><h3><span class="wk-ico">' + ico("chart", "", 13) + '</span>全店指标明细 <span class="tag">首日 → 末日 ｜ 周均 ｜ ' + an.metricStatus.length + ' 行</span></h3></summary>');
    html.push('<div class="wk-table-wrap"><table><thead><tr><th>店铺</th><th>指标</th><th class="num">首日</th><th class="num">末日</th><th class="num">周均</th><th class="num">变动</th></tr></thead><tbody>');
    an.metricStatus.forEach(function (x) {
      // 箭头按数值方向（涨↑跌↓），颜色沿用驾驶舱约定（涨红跌绿），⚠ 表示"变差"
      var dir = x.delta > 0.0001 ? 1 : (x.delta < -0.0001 ? -1 : 0);
      var cls = dir > 0 ? "up" : (dir < 0 ? "down" : "flat");
      var arrow = dir > 0 ? "▲" : (dir < 0 ? "▼" : "—");
      var tgt = x.target != null ? (x.higher === false ? " ≤" : " ≥") + x.target + (x.unit === "%" ? "%" : "") : "";
      html.push('<tr><td>' + esc(x.shop) + '</td><td>' + esc(x.label) + (tgt ? ' <span class="wk-target">' + tgt + '</span>' : '') +
        '</td><td class="num">' + fmt(x.first, x.unit) + '</td><td class="num">' + fmt(x.last, x.unit) +
        '</td><td class="num">' + fmt(x.avg, x.unit) + '</td><td class="num ' + cls + '">' + arrow + ' ' +
        (Math.round(x.delta * 100) / 100) + (x.unit === "%" ? "pct" : "") + (x.drop ? ' ⚠' : '') + '</td></tr>');
    });
    html.push('</tbody></table></div></details>');

    // ④ 分析与思考（归因）：事实底稿自动汇总 + 结论自己写，存本地与云端
    var rk = rangeKeyOf(opts.start, opts.end);
    var note = readNote(rk);
    var summJoined = data.texts.map(function (t) { return t.summary; }).filter(Boolean).join("；");
    var toms = data.texts.map(function (t) { return t.tomorrow; }).filter(Boolean);
    var fbJoined = data.texts.filter(function (t) { return t.feedback; })
      .map(function (t) { return t.date + " " + t.feedback; }).join("；");

    var facts = [];
    function clip(s, n) {
      s = String(s || "").replace(/\s+/g, " ").trim();
      return s.length > n ? s.slice(0, n) + "…" : s;
    }
    if (an.drops.length) {
      var dTop = an.drops.slice(0, 6).map(function (x) {
        return clip(x.shop.replace(/旗舰店|专营店|专卖店|企业店|官方店/g, ""), 9) + " " + x.label + " " +
          fmt(x.first, x.unit) + "→" + fmt(x.last, x.unit);
      });
      facts.push('<b>指标下滑 ' + an.drops.length + ' 项</b>：' + esc(dTop.join("；")) +
        (an.drops.length > 6 ? ' 等' : ''));
    } else {
      facts.push('<b>指标</b>：重点店本周无显著下滑项。');
    }
    if (fbJoined) { facts.push('<b>日报问题反馈</b>：' + esc(clip(fbJoined, 200))); }
    if (summJoined) { facts.push('<b>日报配置总结</b>：' + esc(clip(summJoined, 200))); }

    html.push('<div class="wk-card wk-note-card" data-wk-note="' + esc(rk) + '">');
    html.push('<h3><span class="wk-ico">' + ico("bolt", "", 13) + '</span>④ 分析与思考 <span class="tag">归因 · 判断</span>' +
      '<button class="wk-ai-btn" data-wk-draft="1" title="按本周事实生成初稿，生成后可自行修改">✦ AI 拟稿</button></h3>');
    html.push('<div class="wk-facts"><div class="wk-facts-h">事实底稿（按本周数据自动汇总，只读）</div>' +
      facts.map(function (f) { return '<div class="wk-facts-row">' + f + '</div>'; }).join("") + '</div>');
    html.push('<textarea class="wk-ta wk-ta-think" data-note="think" rows="4" placeholder="' +
      esc('为什么会出现这些下滑或反馈？判断属于哪一类：口径变化 / 历史配置回退 / 场景未覆盖 / 能力边界。写下你的判断和依据，1~3 句即可。') +
      '">' + esc(note.think) + '</textarea>');
    html.push('<div class="wk-note-save" data-save-tip="think">' + (note.think ? '已保存 · ' + tsLabel(note.updatedAt) : '未填写 · 输入后自动保存') + '</div>');
    html.push('</div>');

    // ⑤ 解决方案与下周计划
    html.push('<div class="wk-card wk-note-card" data-wk-note="' + esc(rk) + '">');
    html.push('<h3><span class="wk-ico">' + ico("target", "", 13) + '</span>⑤ 解决方案与下周计划 <span class="tag">止血 / 治本 / 防复发</span></h3>');
    html.push('<div class="wk-note-grid">');
    html.push('<label class="wk-field"><span>止血</span><textarea class="wk-ta" data-note="stop" rows="3" placeholder="' +
      esc('这周马上做什么先止损？（可参照上方日报配置总结）') + '">' + esc(note.stop) + '</textarea></label>');
    html.push('<label class="wk-field"><span>治本</span><textarea class="wk-ta" data-note="fix" rows="3" placeholder="' +
      esc('针对上面的根因，改哪一处配置 / 补哪个场景，能永久解决？') + '">' + esc(note.fix) + '</textarea></label>');
    html.push('<label class="wk-field"><span>防复发</span><textarea class="wk-ta" data-note="prevent" rows="3" placeholder="' +
      esc('加什么巡检或校验，让同类问题下次能被提前发现？') + '">' + esc(note.prevent) + '</textarea></label>');
    html.push('</div>');
    html.push('<div class="wk-field wk-field-plan"><span>下周计划</span><textarea class="wk-ta" data-note="plan" rows="4" placeholder="' +
      esc('一行一条，写清做什么、做到什么程度、什么时候验证') + '">' + esc(note.plan) + '</textarea></div>');
    html.push('<div class="wk-note-save" data-save-tip="plan">' + (noteFilled(note) ? '已保存 · ' + tsLabel(note.updatedAt) : '未填写 · 输入后自动保存') + '</div>');
    html.push('<div class="wk-note">验证：下周同区间复查，回到目标线或环比改善即通过（T-3 / T-1 观察）' +
      (an.drops.length ? '；复发预警 ' + an.drops.length + ' 项优先排期' : '') + '。</div>');
    html.push('</div>');

    // ⑥ 每日日报原文（默认折叠，仅在页面查看；导出稿已含问题反馈，不重复带出）
    html.push('<details class="wk-card" data-skip-export="1"><summary class="wk-summary"><h3><span class="wk-ico">' + ico("doc", "", 13) + '</span>⑥ 每日日报原文 <span class="tag">' + data.texts.length + ' 天</span></h3></summary>');
    data.texts.forEach(function (t) {
      var has = t.summary || t.feedback || t.weekFocus || t.tomorrow;
      html.push('<div class="wk-day"><div class="wk-day-head">' + t.date + '（' + weekday(t.date) + '）' +
        (has ? '' : '<span class="wk-day-empty">未填写日报</span>') + '</div>');
      if (t.summary) { html.push('<div class="wk-day-row" data-row="sum"><b>配置总结</b><span>' + esc(t.summary) + '</span></div>'); }
      if (t.feedback) { html.push('<div class="wk-day-row" data-row="fb"><b>问题反馈</b><span>' + esc(t.feedback) + '</span></div>'); }
      if (t.weekFocus) { html.push('<div class="wk-day-row" data-row="focus"><b>本周重点</b><span>' + esc(t.weekFocus) + '</span></div>'); }
      if (t.tomorrow) { html.push('<div class="wk-day-row" data-row="tom"><b>明日待办</b><span>' + esc(t.tomorrow) + '</span></div>'); }
      html.push('</div>');
    });
    html.push('</details>');

    // 方法速查（折叠；导出发送时剔除）
    html.push('<details class="wk-card" data-skip-export="1"><summary class="wk-summary"><h3><span class="wk-ico">' + ico("bolt", "", 13) + '</span>方法速查 <span class="tag">《问题分析与解决》</span></h3><div class="method-grid">');
    html.push('<div class="method"><h4>问题定义</h4><p>问题 = 现状 − 目标 = 差距。指标型（数字倒推）vs 事务型（事件正推）。5W1H 界定，假设≠结论。</p></div>');
    html.push('<div class="method"><h4>归因框架</h4><p>能力边界先行；四层：口径/历史配置/可修/合规；三层：瞬时检索/合规拦截/未覆盖；四类：答非所问/笼统/生硬/超纲。</p></div>');
    html.push('<div class="method"><h4>闭环流程</h4><p>五步：发现→界定→归因→方案→验证。方案三段式：止血→治本→防复发。</p></div>');
    html.push('<div class="method"><h4>验证标准</h4><p>好动作三标准：绑归因/有信号/有边界。做→看→判→调（3–7 天，T-3/T-1）。</p></div>');
    html.push('</div></details>');

    container.innerHTML = '<div class="wb-weekly">' + html.join("") + '</div>';
    container._wkCtx = { data: data, an: an, rangeLabel: rangeLabel, rk: rk };
    bindNoteEvents(container);
    if (container._wkAutoGrow) { container._wkAutoGrow(); }
    var curNote = readNote(rk);
    container._weeklyText = buildText(data, an, rangeLabel, curNote);
    return { data: data, analyze: an, text: container._weeklyText, note: curNote, rangeKey: rk };
  }

  function toast(msg) {
    var t = document.querySelector(".wb-weekly-toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "wb-weekly-toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  function exportCsv(ctx, start, end) {
    var data = collect(ctx || getWorkbenchData(), start, end);
    var an = analyze(data);
    var rows = [["店铺", "指标", "首日", "末日", "周均", "变动", "是否下滑"]];
    an.metricStatus.forEach(function (x) {
      rows.push([x.shop, x.label, x.first, x.last, Math.round(x.avg * 100) / 100, Math.round(x.delta * 100) / 100, x.drop ? "是" : "否"]);
    });
    var csv = "\ufeff" + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "周度复盘-指标-" + (data.dayKeys[0] || "x") + "_" + (data.dayKeys[data.dayKeys.length - 1] || "x") + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("CSV 已导出");
  }

  /* ---------- 导出单文件 HTML（浅色、可离线打开、可直接发送） ---------- */
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  // 整段日报都空着时，把 7 个「未填写日报」折叠成一行提示，避免导出发给他人时空占版面
  // 整段日报都空着时，导出稿直接去掉这一节（发给他人时「未填写」占位没有意义）
  function tidyEmptyDays(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var days = tmp.querySelectorAll(".wk-day");
    if (!days.length) { return html; }
    for (var i = 0; i < days.length; i++) {
      if (days[i].querySelector(".wk-day-row")) { return html; }
    }
    var card = days[0].closest ? days[0].closest(".wk-card") : null;
    if (card && card.parentNode) { card.parentNode.removeChild(card); }
    return tmp.innerHTML;
  }
  // 表格同一店铺连续多行时，后几行清空店名并给新组加分隔线，读起来更像分组清单
  function tidyTables(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    var tables = tmp.querySelectorAll("table");
    for (var i = 0; i < tables.length; i++) {
      var rows = tables[i].querySelectorAll("tbody tr");
      var names = [], k;
      for (k = 0; k < rows.length; k++) {
        var c0 = rows[k].querySelector("td");
        names.push(c0 ? String(c0.textContent || "").trim() : "");
      }
      var hasDup = false;
      for (k = 1; k < names.length; k++) { if (names[k] && names[k] === names[k - 1]) { hasDup = true; break; } }
      if (!hasDup) { continue; }
      var prev = null;
      for (k = 0; k < rows.length; k++) {
        var td = rows[k].querySelector("td");
        if (!td) { continue; }
        var nm = names[k];
        if (!nm) { continue; }
        if (nm === prev) { td.textContent = ""; }
        else { if (prev !== null) { rows[k].classList.add("grp"); } prev = nm; }
      }
    }
    return tmp.innerHTML;
  }


  var EXPORT_CSS = ":root{\n  --ink:#131b18;--ink-2:#3a453f;--muted:#6c7873;\n  --line:#e4e9e6;--line-2:#eff3f1;--soft:#f5f8f6;\n  --brand:#0d6b4c;--brand-2:#0a5238;--brand-soft:#eff7f2;\n  --up:#c0392b;--down:#12805c;--danger:#c0392b;--amber:#a86400;\n  --text:#131b18;--panel-2:#ffffff;--panel-soft:#f5f8f6;--line-bright:#e4e9e6;\n  --accent-rgb:13 107 76;--accent-300:#0d6b4c;--accent-400:#12805c;--accent-500:#0d6b4c;\n}\n*{box-sizing:border-box}\nhtml,body{margin:0;padding:0}\nbody{\n  background:#e9edeb;color:var(--ink);\n  font:13px/1.72 -apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;\n  -webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;\n}\n.page{\n  max-width:1080px;margin:26px auto;background:#fff;border-radius:18px;overflow:hidden;\n  box-shadow:0 1px 2px rgba(19,27,24,.06),0 12px 34px rgba(19,27,24,.09);\n}\n\n/* ============ 封面横幅 ============ */\n.rpt-hero{\n  position:relative;overflow:hidden;color:#fff;\n  padding:32px 44px 30px;\n  background:\n    radial-gradient(120% 140% at 100% 0%,rgba(255,255,255,.18),rgba(255,255,255,0) 58%),\n    linear-gradient(132deg,#093f2c 0%,#0d6b4c 54%,#12815b 100%);\n}\n.rpt-hero::after{\n  content:\"\";position:absolute;right:-90px;bottom:-140px;width:300px;height:300px;border-radius:50%;\n  background:rgba(255,255,255,.04);pointer-events:none;\n}\n.rpt-hero-top{display:flex;align-items:center;justify-content:space-between;gap:16px;position:relative;z-index:1}\n.rpt-tag{\n  display:inline-flex;align-items:center;gap:7px;font-size:11px;letter-spacing:.08em;\n  padding:3px 11px;border-radius:20px;color:#dff3ea;\n  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);\n}\n.rpt-tag::before{content:\"\";width:5px;height:5px;border-radius:50%;background:#7ee0b0}\n.rpt-org{font-size:11px;color:rgba(255,255,255,.62);letter-spacing:.03em}\n.rpt-hero h1{\n  position:relative;z-index:1;margin:16px 0 0;font-size:27px;line-height:1.3;font-weight:600;\n  letter-spacing:-.015em;\n}\n.rpt-hero-meta{\n  position:relative;z-index:1;margin-top:9px;display:flex;flex-wrap:wrap;gap:6px 22px;\n  font-size:12px;color:rgba(255,255,255,.72);\n}\n.rpt-hero-meta b{color:#fff;font-weight:500}\n\n/* 四张核心 KPI */\n.rpt-kpis{\n  position:relative;z-index:1;margin-top:22px;\n  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;\n}\n.rpt-kpi{\n  background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);\n  border-radius:12px;padding:12px 14px 11px;\n}\n.rpt-kpi-h{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11.5px;color:rgba(255,255,255,.78)}\n.rpt-kpi-h span{font-size:10.5px;color:rgba(255,255,255,.52);white-space:nowrap}\n.rpt-kpi-v{margin-top:3px;font-size:26px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums;letter-spacing:-.01em}\n.rpt-kpi-v i{font-style:normal;font-size:13px;font-weight:500;opacity:.72;margin-left:1px}\n.rpt-kpi-d{margin-top:1px;font-size:11.5px;color:rgba(255,255,255,.72)}\n.rpt-kpi-d.is-bad{color:#ffb0a3}\n.rpt-kpi-d.is-good{color:#8ae6bd}\n.rpt-kpi-bar{height:3px;border-radius:2px;background:rgba(255,255,255,.16);margin-top:9px;overflow:hidden}\n.rpt-kpi-bar span{display:block;height:100%;border-radius:2px;background:#7ee0b0}\n.rpt-kpi.is-bad .rpt-kpi-bar span{background:#ff9d8d}\n.rpt-kpi-n{margin-top:5px;font-size:10.5px;color:rgba(255,255,255,.55)}\n.rpt-kpi.is-bad .rpt-kpi-n{color:#ffc4ba}\n\n/* ============ 执行摘要 ============ */\n.rpt-body{padding:26px 44px 28px}\n.rpt-brief{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}\n.rpt-brief-h{\n  display:flex;align-items:center;gap:9px;padding:11px 18px;\n  background:var(--soft);border-bottom:1px solid var(--line);\n  font-size:12px;font-weight:600;color:var(--ink);letter-spacing:.02em;\n}\n.rpt-brief-h em{font-style:normal;font-size:10.5px;font-weight:400;color:var(--muted);letter-spacing:.04em}\n.rpt-brief-item{display:flex;gap:14px;padding:13px 18px;border-bottom:1px solid var(--line-2)}\n.rpt-brief-item:last-child{border-bottom:0}\n.rpt-brief-k{\n  flex:0 0 52px;font-size:11px;font-weight:600;letter-spacing:.06em;color:var(--brand);\n  padding-top:1px;\n}\n.rpt-brief-item.is-risk .rpt-brief-k{color:var(--up)}\n.rpt-brief-item.is-next .rpt-brief-k{color:var(--amber)}\n.rpt-brief-t{font-size:12.5px;line-height:1.85;color:var(--ink-2);min-width:0}\n.rpt-brief-t b{color:var(--ink);font-weight:600}\n.rpt-brief-t .hi{color:var(--up);font-weight:600}\n.rpt-brief-t .ok{color:var(--down);font-weight:600}\n\n/* ============ 分区卡片 ============ */\n.wk-head{display:none}\n.wb-weekly{display:block;margin-top:18px}\n.wk-card{\n  background:#fff;border:1px solid var(--line);border-radius:14px;\n  padding:18px 20px 16px;margin:0 0 14px;\n}\n.wk-card--sum{background:linear-gradient(180deg,#f7fbf9,#fff 120px)}\n.wk-card--warn{border-color:#f0d8d3;background:linear-gradient(180deg,#fdf8f7,#fff 150px)}\n.wk-card--note{border-color:#d9e8e0;background:linear-gradient(180deg,#f8fcfa,#fff 130px)}\n.wk-card h3{\n  margin:0 0 14px;font-size:15px;font-weight:600;color:var(--ink);\n  display:flex;align-items:center;gap:9px;flex-wrap:wrap;letter-spacing:-.005em;\n}\n.wk-card h3 .wk-ico{display:none}\n.wk-card h3::before{content:none}\n.rpt-no{\n  display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;\n  width:22px;height:22px;border-radius:7px;cursor:default;\n  background:var(--brand);color:#fff;font-style:normal;font-size:12px;font-weight:600;\n}\n.wk-card--warn .rpt-no{background:var(--up)}\n.wk-card h3 .tag{\n  margin-left:auto;font-size:11px;font-weight:400;color:var(--muted);\n  background:var(--soft);border:1px solid var(--line);border-radius:20px;padding:1px 10px;\n  letter-spacing:.01em;\n}\n.wk-card h3 .tag::before{content:none}\n\n/* ① 概览：四格数据条 */\n.wk-kv-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:2px 0 4px}\n.kv{display:flex;flex-direction:column-reverse;gap:2px;padding:0 20px;border-left:1px solid var(--line);min-width:0}\n.kv:first-child{border-left:0;padding-left:2px}\n.kv span{font-size:11.5px;color:var(--muted);letter-spacing:.01em;white-space:nowrap}\n.kv b{font-size:23px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1.35}\n.kv b.up{color:var(--up)}\n.wk-note{margin-top:12px;font-size:11.5px;color:var(--muted);line-height:1.7}\n\n/* ============ 表格 ============ */\n.wk-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}\ntable{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}\nthead th{\n  background:var(--soft);color:var(--muted);font-weight:500;font-size:11px;\n  padding:8px 11px;text-align:left;white-space:nowrap;letter-spacing:.02em;\n  border-bottom:1px solid var(--line);\n}\nthead th:first-child{border-radius:8px 0 0 0}\nthead th:last-child{border-radius:0 8px 0 0}\ntbody td{\n  padding:7px 11px;border-bottom:1px solid var(--line-2);white-space:nowrap;color:var(--ink-2);\n  font-variant-numeric:tabular-nums;\n}\ntbody td:first-child{color:var(--ink);font-weight:600}\ntbody tr.grp td{border-top:1px solid var(--line)}\ntbody tr.grp:first-child td{border-top:0}\ntbody tr:last-child td{border-bottom:0}\ntd.num{text-align:right}\ntd.bad{color:var(--up);font-weight:600}\ntd.mov{color:var(--up);font-weight:600}\n.up{color:var(--up)}\n.down{color:var(--down)}\n.flat{color:var(--muted)}\n.wk-wd{color:var(--muted);font-size:10.5px;margin-left:3px;font-weight:400}\n.wk-target{color:var(--muted);font-size:10.5px;font-weight:400}\n.badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:5px;background:#f2f5f3;color:var(--muted);margin-right:6px;vertical-align:1px}\n.badge.drop{color:var(--up);background:#fdf0f0}\n.ar{font-style:normal;font-size:9px;line-height:1;display:inline-block;width:9px;margin-left:2px;text-align:center;vertical-align:1px;opacity:.95}\n.row-alert{color:var(--up);margin-right:5px;vertical-align:-2px}\n.th-l{display:block}\n\n/* ============ 文本块 / 反馈 ============ */\n.wk-q{padding:7px 0;border-bottom:1px dashed var(--line-2);font-size:12.5px;color:var(--ink-2);line-height:1.8}\n.wk-q:last-of-type{border-bottom:0}\n.wk-q b{color:var(--ink);font-weight:600}\n.fb{border-left:3px solid #d6e7de;padding:2px 0 2px 14px;margin:0 0 12px;font-size:12.5px;color:var(--ink-2);line-height:1.8}\n.fb .dt{color:var(--muted);font-size:11px;margin-bottom:2px}\n.fb.muted{color:var(--muted);border-left-color:var(--line)}\n.tmpl{background:var(--brand-soft);border-radius:10px;padding:12px 15px;font-size:12.5px;color:var(--ink-2);line-height:1.85;margin-top:12px}\n.tmpl b{color:var(--brand);font-weight:600}\nul{margin:6px 0;padding-left:18px}\nli{margin:3px 0}\n.grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px 30px}\n.wk-sub{font-size:12.5px;font-weight:600;color:var(--ink);margin:18px 0 8px}\n.wk-sub2{font-size:12px;font-weight:600;color:var(--brand);margin-bottom:6px}\n.wk-recur{margin-top:14px;font-size:12.5px;color:var(--ink-2);line-height:1.85}\n.wk-recur b{color:var(--brand);font-weight:600}\n.empty{color:var(--muted);font-size:12.5px;padding:4px 0}\n.wk-row-k{display:flex;gap:14px;padding:8px 0;border-bottom:1px solid var(--line-2);font-size:12.5px;line-height:1.8}\n.wk-row-k:last-of-type{border-bottom:0}\n.wk-row-k b{flex:0 0 62px;color:var(--brand);font-weight:600;font-size:12px;padding-top:1px}\n.wk-row-k span{color:var(--ink-2);min-width:0}\n.wk-row-k .wk-blank{color:var(--muted)}\n\n/* ============ ④ 事实底稿 ============ */\n.wk-facts{border-left:3px solid rgb(var(--accent-rgb) / .38);background:var(--brand-soft);border-radius:0 10px 10px 0;padding:11px 14px;margin-bottom:13px;font-size:12px;line-height:1.8}\n.wk-facts-h{color:var(--brand);font-size:10.5px;margin-bottom:5px;letter-spacing:.05em;font-weight:600}\n.wk-facts-row{color:var(--ink-2);word-break:break-word}\n.wk-facts-row + .wk-facts-row{margin-top:3px}\n.wk-facts-row b{color:var(--ink);font-weight:600;margin-right:4px}\n\n/* ============ ⑤ 三列方案 ============ */\n.wk-note-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}\n.wk-field{display:flex;flex-direction:column;gap:0;min-width:0}\n.wk-note-grid .wk-field{\n  background:#fff;border:1px solid var(--line);border-radius:11px;\n  border-top-width:3px;border-top-style:solid;padding:11px 13px 12px;\n}\n.wk-note-grid .wk-field:nth-child(1){border-top-color:#c0392b}\n.wk-note-grid .wk-field:nth-child(2){border-top-color:var(--brand)}\n.wk-note-grid .wk-field:nth-child(3){border-top-color:#2f6f9f}\n.wk-field > span{font-size:11px;font-weight:600;color:var(--brand);letter-spacing:.06em;margin-bottom:6px}\n.wk-note-grid .wk-field:nth-child(1) > span{color:#c0392b}\n.wk-note-grid .wk-field:nth-child(3) > span{color:#2f6f9f}\n.wk-field-plan{margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:11px;padding:12px 14px 13px}\n.wk-note-static{font-size:12.5px;line-height:1.9;color:var(--ink-2);white-space:pre-wrap;word-break:break-word}\n/* ④ 的思考正文是卡片直属块，单独给一个浅底容器与上方事实底稿拉开层次 */\n.wk-card--note > .wk-note-static{\n  background:#f7faf8;border-left:3px solid rgb(var(--accent-rgb) / .32);\n  border-radius:0 9px 9px 0;padding:10px 14px;margin-top:2px;\n}\n.wk-note-static-empty{color:#a9b3ae}\n.wk-ai-btn{display:none}\n\n/* ============ 日报原文 / 方法速查 ============ */\ndetails>summary{display:block;cursor:default;list-style:none}\ndetails>summary::-webkit-details-marker{display:none}\n.wk-day{border-top:1px solid var(--line-2);padding:13px 0 3px}\n.wk-day:first-of-type{border-top:0;padding-top:0}\n.wk-day-head{font-size:12.5px;font-weight:600;color:var(--brand);margin-bottom:8px}\n.wk-day-empty{color:var(--muted);font-size:11px;margin-left:8px;font-weight:400}\n.wk-day-row{display:flex;gap:12px;font-size:12.5px;padding:2px 0;line-height:1.8}\n.wk-day-row b{flex:0 0 66px;color:var(--muted);font-weight:400;font-size:11.5px;padding-top:2px}\n.wk-day-row span{color:var(--ink-2);min-width:0;white-space:pre-wrap}\n.method-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 30px}\n.method{border-left:2px solid var(--line);padding:0 0 0 13px}\n.method h4{margin:0 0 3px;font-size:12px;font-weight:600;color:var(--ink)}\n.method p{margin:0;font-size:12px;color:var(--muted);line-height:1.7}\n\n/* ============ 图标 / 走势 ============ */\n.ico{display:inline-block;vertical-align:-2px;flex:0 0 auto}\n.wk-ico{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:7px;background:var(--brand-soft);color:var(--brand);flex:0 0 auto}\n.wk-ico-warn{background:#fdf0f0;color:var(--up)}\n.kv-ico{color:var(--brand);margin-right:4px}\n.kv-ico.warn{color:var(--up)}\n.spark{display:block;margin:3px 0 0 auto;color:#9fb3a9}\n.spark .ln{stroke:currentColor;stroke-width:1.4;fill:none;stroke-opacity:.75;stroke-linecap:round;stroke-linejoin:round}\n.spark-dot.up{fill:var(--up)}\n.spark-dot.down{fill:var(--down)}\n.spark-dot.flat{fill:var(--muted)}\ntable.tbl-daily{table-layout:fixed}\ntable.tbl-daily th:first-child,table.tbl-daily td:first-child{width:104px}\n\n/* ============ 页脚 ============ */\n.rpt-foot{\n  margin-top:22px;padding-top:13px;border-top:1px solid var(--line);\n  color:#9aa6a1;font-size:11px;display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;\n}\n\n/* ============ 响应式 ============ */\n@media screen and (max-width:900px){\n  .rpt-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .wk-kv-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 0}\n  .kv{padding:0 16px}\n  .kv:nth-child(3){border-left:0;padding-left:2px}\n  .grid2,.method-grid,.wk-note-grid{grid-template-columns:1fr}\n}\n@media screen and (max-width:640px){\n  .page{margin:0;border-radius:0;box-shadow:none}\n  .rpt-hero{padding:24px 20px 22px}\n  .rpt-hero h1{font-size:21px}\n  .rpt-body{padding:18px 16px 20px}\n  .rpt-kpis{grid-template-columns:1fr 1fr;gap:9px}\n  .rpt-kpi-v{font-size:22px}\n  .wk-card{padding:15px 14px 13px}\n}\n\n/* ============ 打印 / 另存 PDF ============ */\n@media print{\n  @page{size:A4;margin:11mm}\n  body{background:#fff}\n  .page{max-width:none;margin:0;border-radius:0;box-shadow:none}\n  .rpt-hero,.rpt-kpi,.wk-card,.wk-facts,.wk-ico,.rpt-no{\n    -webkit-print-color-adjust:exact;print-color-adjust:exact;\n  }\n  .wk-card{break-inside:avoid;page-break-inside:avoid;margin-bottom:10px}\n  thead{display:table-header-group}\n  table{font-size:10.5px}\n  .rpt-hero{padding:22px 26px 20px}\n  .rpt-body{padding:16px 26px 18px}\n  .rpt-hero h1{font-size:22px}\n  .rpt-kpi-v{font-size:21px}\n  .rpt-brief,.fb,.method,.wk-field{break-inside:avoid}\n}\n\n/* ============ 数据一览（图表） ============ */\n.rpt-charts{background:#fff;border:1px solid var(--line);border-radius:14px;padding:15px 18px 16px;margin-top:14px}\n.rpt-charts-h{font-size:14px;font-weight:800;color:var(--ink);letter-spacing:.02em}\n.rpt-charts-h em{font-style:normal;font-size:11px;font-weight:500;color:var(--muted);margin-left:8px;letter-spacing:.04em}\n.rpt-trend-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:12px}\n.rpt-line-card{border:1px solid #eef2ef;border-radius:10px;padding:10px 12px 8px;background:#fbfdfc}\n.rpt-line-h{display:flex;align-items:baseline;gap:6px;margin-bottom:5px}\n.rpt-line-h b{font-size:12px;color:var(--ink);white-space:nowrap}\n.rpt-line-h .lv{margin-left:auto;font-size:16px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}\n.rpt-line-h .ld{font-size:10.5px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}\n.rpt-line-h .ld.is-bad{color:#dc2626}\n.rpt-line-h .ld.is-good{color:#15803d}\n.rpt-line-card svg{display:block;width:100%;height:auto}\n.rpt-line-t{margin-top:4px;font-size:9.5px;color:var(--muted);text-align:right}\n.rpt-bar-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}\n.rpt-bar-card{border:1px solid #eef2ef;border-radius:10px;padding:10px 14px 9px;background:#fbfdfc}\n.rpt-bar-card-h{display:flex;align-items:baseline;gap:8px;margin-bottom:7px;font-size:12px;font-weight:800;color:var(--ink)}\n.rpt-bar-card-h span{margin-left:auto;font-size:10px;font-weight:500;color:var(--muted)}\n.rpt-bar-row{display:flex;align-items:center;gap:8px;margin:5px 0}\n.rpt-bar-name{width:90px;flex:none;font-size:11px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:right}\n.rpt-bar-track{flex:1;position:relative;height:13px;background:#eef2f0;border-radius:7px}\n.rpt-bar-fill{position:absolute;left:0;top:0;bottom:0;border-radius:7px;background:#16a34a;-webkit-print-color-adjust:exact;print-color-adjust:exact}\n.rpt-bar-fill.is-bad{background:#dc2626}\n.rpt-bar-target{position:absolute;top:-2px;bottom:-2px;width:0;border-left:2px dashed #64748b}\n.rpt-bar-val{width:44px;flex:none;font-size:11px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums;text-align:right}\n.rpt-bar-val.is-bad{color:#dc2626}\n.rpt-kpi-spark{margin:3px 0 1px;opacity:.95}\n.rpt-kpi-spark svg{display:block;width:100%;height:auto}\n@media screen and (max-width:900px){\n  .rpt-trend-grid{grid-template-columns:repeat(2,1fr)}\n}\n@media screen and (max-width:640px){\n  .rpt-trend-grid,.rpt-bar-grid{grid-template-columns:1fr}\n  .rpt-bar-name{width:70px}\n}\n\n/* ============ 长文案条目化（④⑤ 自动排版） ============ */\n.rpt-prose{padding:2px 0}\n.rpt-pt{display:flex;gap:11px;margin:0 0 13px;break-inside:avoid;page-break-inside:avoid}\n.rpt-pt:last-child{margin-bottom:0}\n.rpt-pt-k{\n  flex:0 0 21px;height:21px;margin-top:2px;border-radius:7px;\n  display:flex;align-items:center;justify-content:center;\n  background:var(--brand-soft);color:var(--brand);\n  font-style:normal;font-size:11.5px;font-weight:700;line-height:1;\n  border:1px solid #dcebe3;\n}\n.rpt-pt-b{min-width:0;flex:1}\n.rpt-pt-h{\n  font-size:13px;font-weight:700;color:var(--ink);line-height:1.75;\n  margin-bottom:3px;letter-spacing:-.005em;\n}\n.rpt-pt-h::after{content:\"　\";font-size:0}\n.rpt-pt-t{font-size:12.5px;line-height:1.95;color:var(--ink-2);word-break:break-word}\n.rpt-n{font-weight:700;color:var(--brand);font-variant-numeric:tabular-nums}\n.rpt-tagx{\n  font-style:normal;display:inline-block;font-size:10.5px;font-weight:600;\n  color:var(--brand);background:var(--brand-soft);border:1px solid #dcebe3;\n  border-radius:5px;padding:0 5px;margin:0 3px;line-height:1.55;\n}\n/* 三列 / 下周计划里的条目：更紧凑 */\n.rpt-pt.is-compact{margin-bottom:10px;gap:8px}\n.rpt-pt.is-compact .rpt-pt-k{flex:0 0 18px;height:18px;border-radius:6px;font-size:10px}\n.rpt-pt.is-compact .rpt-pt-h{font-size:12px}\n.rpt-pt.is-compact .rpt-pt-t{font-size:12px;line-height:1.85}\n/* ④ 长文：首条（定性结论）加重底色，读起来有起点 */\n.wk-card--note > .rpt-prose .rpt-pt:first-child .rpt-pt-k{background:var(--brand);color:#fff;border-color:var(--brand)}\n/* 事实底稿：标签做胶囊，正文压低对比，减少「一整块字」的压迫感 */\n.wk-facts-row b{\n  display:inline-block;font-size:10.5px;font-weight:600;color:var(--brand);\n  background:#fff;border:1px solid #dcebe3;border-radius:5px;padding:0 6px;\n  margin:0 6px 2px 0;line-height:1.6;\n}\n.wk-facts{line-height:1.85}\n\n/* ============ 需要盯的 6 项下滑 ============ */\n.rpt-risks{background:#fff;border:1px solid #f0d8d3;border-radius:14px;padding:14px 18px 8px;margin-top:14px}\n.rpt-risks-h{font-size:14px;font-weight:800;color:var(--up);letter-spacing:.02em;margin-bottom:8px}\n.rpt-risks-h em{font-style:normal;font-size:11px;font-weight:500;color:var(--muted);margin-left:8px;letter-spacing:.04em}\n.rpt-risks table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px}\n.rpt-risks thead th{background:#fdf7f6;color:var(--muted);font-weight:500;font-size:10.5px;padding:6px 10px;text-align:left;white-space:nowrap;letter-spacing:.02em}\n.rpt-risks tbody td{padding:6px 10px;border-bottom:1px solid #f6ecea;color:var(--ink-2);white-space:nowrap;font-variant-numeric:tabular-nums}\n.rpt-risks tbody td:first-child{color:var(--ink);font-weight:600}\n.rpt-risks tbody tr:last-child td{border-bottom:0}\n.rpt-risks td.num{text-align:right}\n.rpt-risks td.bad{color:var(--up);font-weight:700}\n\n/* ============ ④ 分析与思考：双栏排版，降行长提可读性 ============ */\n.wk-card--note > .rpt-prose{\n  column-count:2;column-gap:32px;\n  column-rule:1px dashed var(--line-2);\n  background:none;border-left:0;border-radius:0;padding:0;margin-top:4px;\n}\n.wk-card--note > .rpt-prose .rpt-pt{margin-bottom:17px;break-inside:avoid;page-break-inside:avoid}\n.wk-card--note > .rpt-prose .rpt-pt-t{font-size:12px;line-height:1.9;color:#4a554f}\n.wk-card--note > .rpt-prose .rpt-pt-h{font-size:12.5px;line-height:1.7}\n.wk-card--note > .rpt-prose .rpt-pt-k{margin-top:1px}\n/* 首条「本周定性」跨双栏置顶，作为结论锚点 */\n.wk-card--note > .rpt-prose .rpt-pt:first-child{column-span:all;margin-bottom:15px;padding-bottom:13px;border-bottom:1px dashed var(--line-2)}\n.wk-card--note > .rpt-prose .rpt-pt:first-child .rpt-pt-t{font-size:12.5px;color:var(--ink-2)}\n/* 下周计划同样双栏，行动项一屏扫完 */\n.wk-field-plan > .rpt-prose{column-count:2;column-gap:32px;column-rule:1px dashed var(--line-2)}\n.wk-field-plan > .rpt-prose .rpt-pt{margin-bottom:13px;break-inside:avoid;page-break-inside:avoid}\n@media screen and (max-width:900px){\n  .wk-card--note > .rpt-prose,.wk-field-plan > .rpt-prose{column-count:1}\n}";

  /* ---------- 汇报稿增强：封面 KPI 横幅 + 执行摘要 ---------- */
  function aggMetric(an, key) {
    var mt = null, rows = [];
    METRICS.forEach(function (m) { if (m.key === key) { mt = m; } });
    if (!mt) { return null; }
    an.metricStatus.forEach(function (r) { if (r.key === key) { rows.push(r); } });
    if (!rows.length) { return null; }
    var avg = 0, first = 0, last = 0;
    rows.forEach(function (r) { avg += r.avg; first += r.first; last += r.last; });
    var n = rows.length;
    avg /= n; first /= n; last /= n;
    var miss = mt.target == null ? 0 : rows.filter(function (r) {
      return mt.higher === false ? r.avg > mt.target : r.avg < mt.target;
    }).length;
    return { mt: mt, avg: avg, first: first, last: last, delta: last - first, miss: miss, n: n };
  }

  function num2(v) {
    if (v === null || v === undefined || !isFinite(v)) { return "—"; }
    var s = (Math.round(v * 100) / 100).toFixed(2);
    return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function nowLabel() {
    var n = new Date();
    return n.getFullYear() + "-" + pad2(n.getMonth() + 1) + "-" + pad2(n.getDate()) +
      " " + pad2(n.getHours()) + ":" + pad2(n.getMinutes());
  }

  function shortShop(name) {
    var s = String(name || "");
    var m = s.match(/（([^）]*)）/);
    var tail = m ? m[1] : "";
    s = s.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "")
      .replace(/(旗舰店|专营店|专卖店|企业店|官方店)$/g, "").replace(/官方$/g, "");
    return (s + (tail ? "·" + tail : "")).trim();
  }

  function buildHero(an, data, rangeLabel) {
    var picks = ["adoptionRate", "generationRate", "pureAgentRatio", "riskRate"];
    var tiles = [];
    picks.forEach(function (k) {
      var g = aggMetric(an, k);
      if (!g) { return; }
      var mt = g.mt;
      var bad = mt.target != null && g.miss > 0;
      var w = 100;
      if (mt.target != null) {
        w = mt.higher === false ? (mt.target / (g.avg || 0.001) * 100) : (g.avg / mt.target * 100);
        w = Math.max(4, Math.min(100, w));
      }
      var worse = mt.higher === false ? (g.delta > 0.005) : (g.delta < -0.005);
      var better = mt.higher === false ? (g.delta < -0.005) : (g.delta > 0.005);
      var dCls = worse ? "is-bad" : (better ? "is-good" : "");
      var dTxt = g.delta > 0.005 ? "上升 " + num2(Math.abs(g.delta)) + (mt.unit === "%" ? "pct" : "")
        : (g.delta < -0.005 ? "下降 " + num2(Math.abs(g.delta)) + (mt.unit === "%" ? "pct" : "") : "与首日持平");
      tiles.push('<div class="rpt-kpi' + (bad ? " is-bad" : "") + '">' +
        '<div class="rpt-kpi-h">' + esc(mt.label) +
        (mt.target != null ? '<span>目标 ' + (mt.higher === false ? "≤" : "≥") + mt.target + (mt.unit === "%" ? "%" : "") + '</span>' : '') +
        '</div>' +
        '<div class="rpt-kpi-v">' + num2(g.avg) + (mt.unit === "%" ? '<i>%</i>' : '') + '</div>' +
        kpiSpark(data, k, METRIC_COLORS[k] || "rgba(255,255,255,.9)") +
        '<div class="rpt-kpi-d ' + dCls + '">' + dTxt + '</div>' +
        '<div class="rpt-kpi-bar"><span style="width:' + Math.round(w) + '%"></span></div>' +
        '<div class="rpt-kpi-n">' + (mt.target == null ? "覆盖 " + g.n + " 家"
          : (bad ? g.miss + " / " + g.n + " 家未达标" : g.n + " 家全部达标")) + '</div>' +
        '</div>');
    });
    return '<header class="rpt-hero">' +
      '<div class="rpt-hero-top"><span class="rpt-tag">拼多多客服 AI · 周度复盘</span>' +
      '<span class="rpt-org">数据来源：探域 + 拼多多后台</span></div>' +
      '<h1>客服 AI 运营周报</h1>' +
      '<div class="rpt-hero-meta">' +
      '<span>周期 <b>' + esc(rangeLabel) + '</b></span>' +
      '<span>重点店铺 <b>' + data.keyShops.length + '</b> 家</span>' +
      '<span>覆盖 <b>' + data.dayKeys.length + '</b> 天</span>' +
      '<span>生成于 ' + nowLabel() + '</span>' +
      '</div>' +
      '<div class="rpt-kpis">' + tiles.join("") + '</div>' +
      '</header>';
  }

  function buildBrief(an, data, notes) {
    var adp = aggMetric(an, "adoptionRate"), gen = aggMetric(an, "generationRate"),
      pure = aggMetric(an, "pureAgentRatio"), risk = aggMetric(an, "riskRate");
    var missLabels = [];
    [adp, gen, pure, risk].forEach(function (g) {
      if (g && g.mt.target != null && g.miss > 0) { missLabels.push(g.mt.label + "（" + g.miss + " 家未达标）"); }
    });
    var t1 = "重点店 <b>" + data.keyShops.length + "</b> 家";
    if (missLabels.length) {
      t1 += "本周 <span class=\"hi\">" + missLabels.length + " 项核心指标未达标</span>：" + missLabels.join("、") + "。";
    } else {
      t1 += "核心指标<span class=\"ok\">全部达标</span>。";
    }
    if (adp && adp.delta < -0.005) {
      t1 += "采纳率由 " + num2(adp.first) + "% 降至 <span class=\"hi\">" + num2(adp.last) + "%</span>（" +
        num2(Math.abs(adp.delta)) + "pct）";
      if (pure && pure.delta < -0.005) {
        t1 += "，纯智能体占比同步由 " + num2(pure.first) + "% 降至 " + num2(pure.last) + "%";
      }
      t1 += "。";
    }
    var items = [{ k: "结论", t: t1 }];

    // 每个店只取下滑幅度最大的一项，避免「同一家店同一指标」重复占位
    var byShop = {}, order = [];
    an.drops.forEach(function (x) {
      if (!byShop[x.shop] || Math.abs(x.delta) > Math.abs(byShop[x.shop].delta)) { byShop[x.shop] = x; }
      if (order.indexOf(x.shop) < 0) { order.push(x.shop); }
    });
    var ds = order.map(function (s) { return byShop[s]; })
      .sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).slice(0, 3);
    if (ds.length) {
      items.push({
        k: "风险", cls: "is-risk",
        t: "下滑幅度最大：" + ds.map(function (x) {
          return "<b>" + esc(shortShop(x.shop)) + "</b> " + esc(x.label) + " " +
            (x.delta > 0 ? "+" : "-") + num2(Math.abs(x.delta)) + (x.unit === "%" ? "pct" : "");
        }).join("；") + "。共 <span class=\"hi\">" + an.drops.length + " 项</span>指标环比走弱。"
      });
    }

    var plan = String((notes && notes.plan) || "").split(/\n+/).filter(function (s) { return String(s).trim(); })[0] || "";
    plan = plan.replace(/^\s*\d+[.、)）]\s*/, "").trim();
    if (!plan) {
      plan = (gen && gen.mt.target != null && gen.avg < gen.mt.target)
        ? "优先补齐未生成话术场景，把生成率从 " + num2(gen.avg) + "% 拉回 " + gen.mt.target + "% 以上，并盯住采纳率最低的 2 家门店。"
        : "维持现有配置，盯住下滑项，下周同区间复查是否回到目标线。";
    }
    items.push({ k: "下一步", cls: "is-next", t: esc(plan) });

    return '<div class="rpt-brief"><div class="rpt-brief-h">执行摘要 <em>结论 · 风险 · 下一步</em></div>' +
      items.map(function (it) {
        return '<div class="rpt-brief-item ' + (it.cls || "") + '"><div class="rpt-brief-k">' + it.k + '</div>' +
          '<div class="rpt-brief-t">' + it.t + '</div></div>';
      }).join("") + '</div>';
  }

  /* ---------- 导出稿图表：把文字口径变成一眼能看的图（纯内联 SVG，打印不丢） ---------- */
  var METRIC_COLORS = {
    adoptionRate: "#7ee0b0", generationRate: "#8fc4ff",
    pureAgentRatio: "#cdb4ff", riskRate: "#ff9d8d"
  };
  var CHART_INK = "#16a34a", CHART_BAD = "#dc2626", CHART_TARGET = "#64748b";

  function dailyVals(data, key) {
    return (data.dailyAvg || []).map(function (r) { return r.vals[key]; }).filter(function (v) { return v !== null && v !== undefined; });
  }

  // 折线：vals 非空数值数组；target 画虚线；dark=true 时用于 hero 半透明卡（白线）
  function svgLine(vals, target, color, w, h, dark) {
    if (!vals || !vals.length) { return ""; }
    var pad = { l: 3, r: 3, t: 6, b: 3 };
    var iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (target != null) { lo = Math.min(lo, target); hi = Math.max(hi, target); }
    if (hi - lo < 0.6) { lo -= 0.4; hi += 0.4; }
    var m = (hi - lo) * 0.18; lo -= m; hi += m;
    function y(v) { return pad.t + (hi - v) / (hi - lo) * ih; }
    function x(i) { return vals.length === 1 ? pad.l + iw / 2 : pad.l + i * iw / (vals.length - 1); }
    var pts = vals.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); });
    var area = "M" + pts[0] + " L" + pts.join(" L") + " L" + x(vals.length - 1).toFixed(1) + "," + (pad.t + ih) +
      " L" + x(0).toFixed(1) + "," + (pad.t + ih) + " Z";
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">';
    s += '<path d="' + area + '" fill="' + color + '" fill-opacity="' + (dark ? ".16" : ".1") + '"/>';
    if (target != null) {
      s += '<line x1="' + pad.l + '" y1="' + y(target).toFixed(1) + '" x2="' + (w - pad.r) + '" y2="' + y(target).toFixed(1) +
        '" stroke="' + (dark ? "rgba(255,255,255,.5)" : CHART_TARGET) + '" stroke-width="1" stroke-dasharray="4 3"/>';
    }
    s += '<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    for (var i = 0; i < pts.length; i++) {
      var xy = pts[i].split(",");
      s += '<circle cx="' + xy[0] + '" cy="' + xy[1] + '" r="2" fill="' + (dark ? "#fff" : color) + '"/>';
    }
    return s + "</svg>";
  }

  // KPI 卡里的 7 日迷你走势
  function kpiSpark(data, key, color) {
    var vals = dailyVals(data, key);
    if (vals.length < 2) { return ""; }
    return '<div class="rpt-kpi-spark">' + svgLine(vals, null, color, 200, 30, true) + "</div>";
  }

  // 「数据一览」上半：四条指标 7 日走势小卡（含目标虚线）
  function trendBlocks(data) {
    var picks = ["adoptionRate", "generationRate", "pureAgentRatio", "riskRate"];
    return picks.map(function (k) {
      var mt = null;
      METRICS.forEach(function (m) { if (m.key === k) { mt = m; } });
      var vals = dailyVals(data, k);
      if (!mt || vals.length < 2) { return ""; }
      var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      var delta = vals[vals.length - 1] - vals[0];
      var worse = mt.higher === false ? delta > 0.005 : delta < -0.005;
      var better = mt.higher === false ? delta < -0.005 : delta > 0.005;
      var dTxt = delta > 0.005 ? "+" + num2(delta) : (delta < -0.005 ? "-" + num2(Math.abs(delta)) : "持平");
      return '<div class="rpt-line-card"><div class="rpt-line-h"><b>' + esc(mt.label) + '</b>' +
        '<i class="ld ' + (worse ? "is-bad" : (better ? "is-good" : "")) + '">' + dTxt + (mt.unit === "%" ? "pct" : "") + '</i>' +
        '<span class="lv">' + num2(avg) + (mt.unit === "%" ? "%" : "") + '</span></div>' +
        svgLine(vals, mt.target, METRIC_COLORS[k] || CHART_INK, 260, 74, false) +
        '<div class="rpt-line-t">目标 ' + (mt.higher === false ? "≤" : "≥") + mt.target + (mt.unit === "%" ? "%" : "") + ' · 虚线</div></div>';
    }).join("");
  }

  // 「数据一览」下半：各店均值横向条形 + 目标虚线（未达标红）
  function shopBarBlocks(data) {
    var picks = ["adoptionRate", "generationRate", "pureAgentRatio", "riskRate"];
    return picks.map(function (k) {
      var mt = null;
      METRICS.forEach(function (m) { if (m.key === k) { mt = m; } });
      if (!mt) { return ""; }
      var rows = data.keyShops.map(function (s) {
        var arr = ((data.series[s.id] || {}).metrics || {})[k] || [];
        if (!arr.length) { return null; }
        var avg = arr.reduce(function (a, b) { return a + b.val; }, 0) / arr.length;
        var ok = mt.target == null ? true : (mt.higher === false ? avg <= mt.target : avg >= mt.target);
        return { name: shortShop(s.name), avg: avg, ok: ok };
      }).filter(function (r) { return r; });
      if (!rows.length) { return ""; }
      rows.sort(function (a, b) { return b.avg - a.avg; });
      var hi = Math.max.apply(null, rows.map(function (r) { return r.avg; }));
      if (mt.target != null) { hi = Math.max(hi, mt.target); }
      hi = hi * 1.1 || 1;
      var bars = rows.map(function (r) {
        var w = Math.max(2, Math.round(r.avg / hi * 100));
        return '<div class="rpt-bar-row"><span class="rpt-bar-name" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
          '<span class="rpt-bar-track"><span class="rpt-bar-fill' + (r.ok ? "" : " is-bad") + '" style="width:' + w + '%"></span>' +
          (mt.target != null ? '<i class="rpt-bar-target" style="left:' + Math.round(mt.target / hi * 100) + '%"></i>' : "") +
          '</span><b class="rpt-bar-val' + (r.ok ? "" : " is-bad") + '">' + num2(r.avg) + '</b></div>';
      }).join("");
      return '<div class="rpt-bar-card"><div class="rpt-bar-card-h">' + esc(mt.label) +
        (mt.target != null ? '<span>目标 ' + (mt.higher === false ? "≤" : "≥") + mt.target + (mt.unit === "%" ? "%" : "") + '</span>' : "") +
        '</div>' + bars + '</div>';
    }).join("");
  }

  /* ---------- 长文案自动排版：编号文拆成序号条目，首句当小标题，数字/责任可视化 ---------- */
  function escRich(t) {
    var s = esc(t);
    s = s.replace(/(\d+(?:\.\d+)?\s*(?:%|pct))/g, '<b class="rpt-n">$1</b>');
    s = s.replace(/(责任|验证|依据|负责人)[：:]/g, '<em class="rpt-tagx">$1</em>');
    return s;
  }

  // 按「一、」「1.」「①」拆条目；无编号的续行并回上一条
  function prosePoints(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var items = [], cur = null;
    lines.forEach(function (ln) {
      var m = ln.match(/^([一二三四五六七八九十]{1,3}[、.]|\d{1,2}[.、)）]|[①②③④⑤⑥⑦⑧⑨⑩])\s*/);
      if (m) {
        cur = { mark: m[1].replace(/[、.。）)]/g, ""), body: ln.slice(m[0].length) };
        items.push(cur);
      } else if (cur) {
        cur.body += " " + ln;
      } else {
        cur = { mark: "", body: ln };
        items.push(cur);
      }
    });
    return items;
  }

  function pointsHtml(items, compact) {
    var out = "";
    items.forEach(function (it, i) {
      var body = String(it.body || "").trim();
      var lead = "", rest = body;
      var c = body.indexOf("：");
      if (c > 0 && c <= 26) { lead = body.slice(0, c); rest = body.slice(c + 1); }
      else {
        var p = body.indexOf("。");
        if (p > 0 && p <= 40) { lead = body.slice(0, p + 1); rest = body.slice(p + 1); }
      }
      out += '<div class="rpt-pt' + (compact ? " is-compact" : "") + '">' +
        '<i class="rpt-pt-k">' + esc(String(it.mark || (i + 1))) + '</i>' +
        '<div class="rpt-pt-b">' +
        (lead ? '<div class="rpt-pt-h">' + escRich(lead) + '</div>' : "") +
        (String(rest || "").trim() ? '<div class="rpt-pt-t">' + escRich(String(rest).trim()) + '</div>' : "") +
        '</div></div>';
    });
    return out;
  }

  function beautifyProse(root) {
    var nodes = root.querySelectorAll(".wk-note-static");
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var txt = String(node.textContent || "").trim();
      if (txt.length < 40) { continue; }
      var items = prosePoints(txt);
      if (items.length < 2) { continue; }
      var compact = !!(node.closest && node.closest(".wk-note-grid, .wk-field-plan"));
      node.innerHTML = pointsHtml(items, compact);
      node.className += " rpt-prose";
    }
  }

  // 按标题文字整卡删除（导出稿只留汇报需要的部分）
  function dropCardsByTitle(root, words) {
    var cs = root.querySelectorAll(".wk-card");
    for (var i = cs.length - 1; i >= 0; i--) {
      var h = cs[i].querySelector("h3");
      var t = h ? String(h.textContent || "") : "";
      for (var w = 0; w < words.length; w++) {
        if (t.indexOf(words[w]) >= 0) { if (cs[i].parentNode) { cs[i].parentNode.removeChild(cs[i]); } break; }
      }
    }
  }

  // 风险榜：只留跌幅最大的 6 项（原 21 行表格没人看得完）
  function buildRisks(an) {
    var ds = (an.drops || []).slice().sort(function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); }).slice(0, 6);
    if (!ds.length) { return ""; }
    var rows = ds.map(function (x) {
      return '<tr><td>' + esc(shortShop(x.shop)) + '</td><td>' + esc(x.label) + '</td>' +
        '<td class="num">' + num2(x.first) + ' → ' + num2(x.last) + '</td>' +
        '<td class="num bad">' + (x.delta > 0 ? "+" : "-") + num2(Math.abs(x.delta)) + (x.unit === "%" ? "pct" : "") + '</td></tr>';
    }).join("");
    return '<section class="rpt-risks"><div class="rpt-risks-h">需要盯的 6 项下滑 <em>按跌幅排序 · 全周共 ' + an.drops.length + ' 项</em></div>' +
      '<table><thead><tr><th>店铺</th><th>指标</th><th class="num">首日 → 末日</th><th class="num">变化</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></section>';
  }

  // 收紧长句：只在句子边界收（完整句子，不加省略号）；⑤ 方案与下周计划属行动项，必须全文保留
  function compactProse(root) {
    var pts = root.querySelectorAll(".rpt-pt");
    for (var i = 0; i < pts.length; i++) {
      var pt = pts[i];
      if (pt.closest && pt.closest(".wk-note-grid, .wk-field-plan")) { continue; }
      var body = pt.querySelector(".rpt-pt-t");
      if (!body) { continue; }
      var sents = String(body.textContent || "").match(/[^。！？]*[。！？]|[^。！？]+$/g) || [];
      if (sents.length > 2) { body.textContent = sents.slice(0, 2).join("").trim(); }
    }
  }

  function buildCharts(data) {
    var lines = trendBlocks(data), bars = shopBarBlocks(data);
    if (!lines && !bars) { return ""; }
    return '<section class="rpt-charts"><div class="rpt-charts-h">数据一览 <em>7 日走势 · 门店对比</em></div>' +
      (lines ? '<div class="rpt-trend-grid">' + lines + '</div>' : "") +
      (bars ? '<div class="rpt-bar-grid">' + bars + '</div>' : "") +
      '</section>';
  }

  // 编号徽标：把 h3 文本开头的 ①②③ 抠出来做色块，卡片按编号上色
  function decorateCards(root) {
    var cards = root.querySelectorAll(".wk-card");
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var h = card.querySelector("h3");
      var no = "";
      if (h) {
        var tn = null;
        for (var c = 0; c < h.childNodes.length; c++) {
          var nd = h.childNodes[c];
          if (nd.nodeType === 3 && /[①②③④⑤⑥⑦⑧⑨]/.test(nd.nodeValue)) { tn = nd; break; }
        }
        if (tn) {
          var m = String(tn.nodeValue).match(/([①②③④⑤⑥⑦⑧⑨])\s*/);
          if (m) {
            no = m[1];
            tn.nodeValue = String(tn.nodeValue).replace(m[0], "");
            var pill = document.createElement("i");
            pill.className = "rpt-no";
            pill.textContent = no;
            h.insertBefore(pill, h.firstChild);
            while (h.firstChild && h.firstChild.nodeType === 3 && !String(h.firstChild.nodeValue).trim()) {
              h.removeChild(h.firstChild);
            }
          }
        }
      }
      if (no === "①") { card.className += " wk-card--sum"; }
      else if (no === "③") { card.className += " wk-card--warn"; }
      else if (no === "④" || no === "⑤") { card.className += " wk-card--note"; }
    }
  }

  function buildHtmlDoc(rangeLabel, keyShopCount, bodyHtml, hero, brief, charts) {
    var ts = nowLabel();
    return [
      "<!DOCTYPE html>",
      '<html lang="zh-CN">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>客服 AI 运营周报 " + esc(rangeLabel) + "</title>",
      "<style>\n" + EXPORT_CSS + "\n</style>",
      "</head>",
      "<body>",
      '<div class="page">',
      hero || "",
      '<div class="rpt-body">',
      brief || "",
      charts || "",
      '<div class="wb-weekly">',
      bodyHtml,
      "</div>",
      '<div class="rpt-foot"><span>拼多多客服 AI 数据驾驶舱 · 周度复盘</span>' +
      '<span>数据来源：探域 + 拼多多后台 · 生成于 ' + ts + '</span></div>',
      "</div>",
      "</div>",
      "</body>",
      "</html>"
    ].join("\n");
  }

  function exportHtml(ctx, start, end) {
    var el = document.getElementById("weeklyContent");
    if (!el || !String(el.innerHTML || "").trim()) {
      toast("当前还没有复盘内容");
      return null;
    }
    var data = collect(ctx || getWorkbenchData(), start, end);
    var a0 = data.dayKeys[0] || start || "";
    var a1 = data.dayKeys[data.dayKeys.length - 1] || end || "";
    var rangeLabel = a0 + " ~ " + a1;
    var an = analyze(data);
    // 覆盖前先取输入框当前值（执行摘要的「下一步」直接用下周计划首行）
    var notes = {};
    var ntas = el.querySelectorAll("textarea[data-note]");
    for (var ni = 0; ni < ntas.length; ni++) {
      notes[ntas[ni].getAttribute("data-note")] = String(ntas[ni].value || "").trim();
    }
    // 展开所有折叠块，收件人直接看到全部内容
    var body = el.innerHTML.replace(/<details(?![^>]*\sopen[\s=>])/g, "<details open");
    // 发给他人时剔除「自己看」的内容：全店明细、方法速查、日报里的配置总结/本周重点
    var tmp = document.createElement("div");
    tmp.innerHTML = body;
    var skips = tmp.querySelectorAll("[data-skip-export]");
    for (var si = 0; si < skips.length; si++) { if (skips[si].parentNode) { skips[si].parentNode.removeChild(skips[si]); } }
    // 汇报稿只留看得完的内容：① 概览（数字与封面重复）、② 每日明细表（已由走势图替代）、
    // ③ 21 行下滑表（改由「需要盯的 6 项」新模块承载）整卡删除；④ 内部事实底稿也不外发
    dropCardsByTitle(tmp, ["本周概览", "每日指标速览", "需要关注"]);
    var facts = tmp.querySelectorAll(".wk-facts");
    for (var xi = 0; xi < facts.length; xi++) { if (facts[xi].parentNode) { facts[xi].parentNode.removeChild(facts[xi]); } }
    decorateCards(tmp);
    var dropRows = tmp.querySelectorAll('.wk-day-row[data-row="sum"], .wk-day-row[data-row="focus"]');
    for (var di = 0; di < dropRows.length; di++) { if (dropRows[di].parentNode) { dropRows[di].parentNode.removeChild(dropRows[di]); } }
    // 可编辑框 → 静态文本；去掉「保存中」提示与 AI 按钮
    var tas = tmp.querySelectorAll("textarea[data-note]");
    for (var ti = 0; ti < tas.length; ti++) {
      var ta = tas[ti];
      var val = String(ta.value || "").trim();
      var dv = document.createElement("div");
      dv.className = "wk-note-static" + (val ? "" : " wk-note-static-empty");
      dv.textContent = val || "（未填写）";
      if (ta.parentNode) { ta.parentNode.replaceChild(dv, ta); }
    }
    var tips = tmp.querySelectorAll(".wk-note-save, [data-wk-draft]");
    for (var pi = 0; pi < tips.length; pi++) { if (tips[pi].parentNode) { tips[pi].parentNode.removeChild(tips[pi]); } }
    // 没填的框不发出去（汇报稿里「未填写」比留白更难看）：空格连同外层一起去掉，整卡全空就整卡去掉
    var empt = tmp.querySelectorAll("[data-wk-note] .wk-note-static-empty");
    for (var ei = 0; ei < empt.length; ei++) {
      var en = empt[ei];
      var fld = en.closest ? en.closest(".wk-field") : null;
      var gon = fld || en;
      if (gon.parentNode) { gon.parentNode.removeChild(gon); }
    }
    var ncs = tmp.querySelectorAll("[data-wk-note]");
    for (var ci = 0; ci < ncs.length; ci++) {
      if (!ncs[ci].querySelector(".wk-note-static")) {
        if (ncs[ci].parentNode) { ncs[ci].parentNode.removeChild(ncs[ci]); }
      }
    }
    var grids = tmp.querySelectorAll(".wk-note-grid");
    for (var gi = 0; gi < grids.length; gi++) {
      var rest = grids[gi].children.length;
      if (rest > 0 && rest < 3) { grids[gi].style.gridTemplateColumns = "repeat(" + rest + ",minmax(0,1fr))"; }
      if (!rest && grids[gi].parentNode) { grids[gi].parentNode.removeChild(grids[gi]); }
    }
    beautifyProse(tmp);
    compactProse(tmp);
    body = tmp.innerHTML;
    body = tidyTables(body);
    body = tidyEmptyDays(body);
    var html = buildHtmlDoc(rangeLabel, data.keyShops.length, body, buildHero(an, data, rangeLabel), buildBrief(an, data, notes), buildCharts(data) + buildRisks(an));
    var name = "周度复盘-" + (a0 || "x") + "_" + (a1 || "x") + ".html";
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      if (a.parentNode) { a.parentNode.removeChild(a); }
    }, 1500);
    toast("HTML 已导出，可直接发送");
    return { name: name, size: html.length };
  }

  /* ---------- AI 助手联动：读事实底稿 / 把 AI 写的复盘刷进当前输入框 ---------- */
  // 当前界面选中的区间键；没选或格式不对就用「最近有数据的一天往前 7 天」
  function defaultNoteRangeKey() {
    var sEl = document.getElementById("weeklyStart");
    var eEl = document.getElementById("weeklyEnd");
    var s = sEl ? String(sEl.value || "").trim() : "";
    var e = eEl ? String(eEl.value || "").trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) {
      var ctx = getWorkbenchData();
      e = latestDayKey(ctx);
      s = shiftKey(e, -6);
    }
    return { start: s, end: e, key: rangeKeyOf(s, e) };
  }

  // 外部（AI 助手）写完笔记后，若周度复盘正显示同一区间，直接刷新输入框
  function applyNote(rk, note) {
    var container = document.getElementById("weeklyContent");
    if (!container || !container._wkCtx || container._wkCtx.rk !== rk) { return false; }
    var n = normNote(note);
    NOTE_FIELDS.forEach(function (k) {
      var ta = container.querySelector('textarea[data-note="' + k + '"]');
      if (ta) { ta.value = n[k] || ""; }
    });
    if (container._wkAutoGrow) { container._wkAutoGrow(); }
    setSaveTip(container, "AI 助手已写入 · " + tsLabel(n.updatedAt || Date.now()));
    return true;
  }

  window.WeeklyReview = {
    render: render, collect: collect, analyze: analyze, buildText: buildText,
    getWorkbenchData: getWorkbenchData, exportCsv: exportCsv, exportHtml: exportHtml,
    latestDayKey: latestDayKey, shiftKey: shiftKey, todayKey: todayKey,
    readNote: readNote, saveNote: saveNote, rangeKeyOf: rangeKeyOf, noteFilled: noteFilled,
    hydrateNotes: hydrateNotes, NOTE_FIELDS: NOTE_FIELDS,
    factsTextOf: factsTextOf, defaultNoteRangeKey: defaultNoteRangeKey, applyNote: applyNote,
    METRICS: METRICS, TASKS: TASKS, toast: toast
  };

  /* ---------- 工作台视图入口：由 app.js 的 setDashboardMode('weekly') 调用 ---------- */
  var bound = false;
  function wbRenderWeekly() {
    var root = document.getElementById("weeklyView");
    var content = document.getElementById("weeklyContent");
    var startEl = document.getElementById("weeklyStart");
    var endEl = document.getElementById("weeklyEnd");
    var label = document.getElementById("weeklyRangeLabel");
    if (!content) { return; }

    var ctx = getWorkbenchData();
    // 换设备时云端笔记更新：渲染前先合并，避免本机旧值覆盖云端新值
    try { hydrateNotes(ctx); } catch (e) {}
    var end = wbRenderWeekly._end || (endEl && endEl.value) || latestDayKey(ctx);
    var start = wbRenderWeekly._start || (startEl && startEl.value) || shiftKey(end, -6);
    // 首次进入 / 数据更新后：默认跟到最新一天
    if (!wbRenderWeekly._touched) {
      end = latestDayKey(ctx);
      start = shiftKey(end, -6);
    }
    if (startEl) { startEl.value = start; }
    if (endEl) { endEl.value = end; }
    if (label) { label.textContent = start + " ~ " + end + " · 周度复盘"; }

    var out = WeeklyReview.render(content, { ctx: ctx, start: start, end: end });

    if (!bound) {
      bound = true;
      var gen = document.getElementById("weeklyGenBtn");
      var copy = document.getElementById("weeklyCopyBtn");
      var exp = document.getElementById("weeklyExportBtn");
      var onEdit = function () {
        wbRenderWeekly._touched = true;
        wbRenderWeekly._start = startEl ? startEl.value : "";
        wbRenderWeekly._end = endEl ? endEl.value : "";
      };
      if (gen) { gen.addEventListener("click", function () { onEdit(); wbRenderWeekly(); }); }
      [startEl, endEl].forEach(function (el) {
        if (el) { el.addEventListener("change", function () { onEdit(); wbRenderWeekly(); }); }
      });
      if (copy) {
        copy.addEventListener("click", function () {
          var text = (document.getElementById("weeklyContent") || {})._weeklyText || "";
          if (!text) { WeeklyReview.toast("暂无可复制的复盘内容"); return; }
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { WeeklyReview.toast("复盘文本已复制"); }, function () { WeeklyReview.toast("复制失败"); });
          } else { WeeklyReview.toast("当前环境不支持自动复制"); }
        });
      }
      if (exp) {
        exp.addEventListener("click", function () {
          WeeklyReview.exportCsv(getWorkbenchData(), startEl ? startEl.value : "", endEl ? endEl.value : "");
        });
      }
      var htmlBtn = document.getElementById("weeklyHtmlBtn");
      if (htmlBtn) {
        htmlBtn.addEventListener("click", function () {
          WeeklyReview.exportHtml(getWorkbenchData(), startEl ? startEl.value : "", endEl ? endEl.value : "");
        });
      }
    }
    return out;
  }
  window.wbRenderWeekly = wbRenderWeekly;
})();
