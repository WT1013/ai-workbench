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

  function buildText(data, an, rangeLabel) {
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
    L.push("二、方案与验证");
    L.push("· 止血：" + (data.texts.map(function (t) { return t.summary; }).filter(Boolean).join("；") || "（待补充）"));
    L.push("· 治本：_____");
    L.push("· 防复发：日巡检 + 周复盘；关键场景上线前回归验证。");
    var toms = data.texts.map(function (t) { return t.tomorrow; }).filter(Boolean);
    L.push("· 下周待办：" + (toms.length ? toms.join("；") : "（日报未填明日待办）"));
    L.push("· 验证：下周同区间复查，回到目标线或环比改善即通过（T-3 / T-1 观察）。");
    return L.join("\n");
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
    html.push('<div class="wk-card"><h3>① 本周概览</h3><div class="wk-kv-grid">');
    html.push('<div class="kv"><span>覆盖天数</span><b>' + data.dayKeys.length + ' 天</b></div>');
    html.push('<div class="kv"><span>重点店铺</span><b>' + data.keyShops.length + ' 家</b></div>');
    html.push('<div class="kv"><span>指标下滑</span><b>' + an.drops.length + ' 项</b></div>');
    html.push('<div class="kv"><span>问题反馈</span><b>' + an.feedbackDays + ' 天</b></div>');
    html.push('</div>');
    html.push('<div class="wk-note">任务完成 ' + doneTotal + ' / ' + taskCap + '（项·天）' +
      (data.taskStatus && (data.taskStatus.done + data.taskStatus.doing + data.taskStatus.todo) ?
        '，完成 ' + data.taskStatus.done + ' · 进行 ' + data.taskStatus.doing + ' · 待办 ' + data.taskStatus.todo : '') + '</div>');
    html.push('</div>');

    // ② 每日指标速览
    html.push('<div class="wk-card"><h3>② 每日指标速览 <span class="tag">重点店均值</span></h3>');
    html.push('<div class="wk-table-wrap"><table><thead><tr><th>日期</th>');
    METRICS.forEach(function (mt) { html.push('<th class="num">' + esc(mt.label) + '</th>'); });
    html.push('</tr></thead><tbody>');
    data.dailyAvg.forEach(function (row) {
      html.push('<tr><td>' + esc(row.date) + ' <span class="wk-wd">' + weekday(row.date) + '</span></td>');
      METRICS.forEach(function (mt) {
        var v = row.vals[mt.key];
        var bad = mt.target != null && v !== null && (mt.higher ? v < mt.target : v > mt.target);
        html.push('<td class="num' + (bad ? ' bad' : '') + '">' + fmt(v, mt.unit) + '</td>');
      });
      html.push('</tr>');
    });
    html.push('</tbody></table></div></div>');

    // ③ 需要关注（只列真问题：指标下滑 + 日报问题）
    html.push('<div class="wk-card"><h3>③ 需要关注 <span class="tag">下滑 ' + an.drops.length + ' 项 ｜ 日报反馈 ' + an.feedbackDays + ' 天</span></h3>');
    if (an.drops.length) {
      html.push('<div class="wk-table-wrap"><table><thead><tr><th>店铺</th><th>指标</th><th class="num">首日 → 末日</th><th class="num">变动</th><th class="num">周均</th></tr></thead><tbody>');
      var prevShop = null;
      an.drops.forEach(function (x) {
        var tgt = x.target != null ? (x.higher === false ? " ≤" : " ≥") + x.target + (x.unit === "%" ? "%" : "") : "";
        var nameCell = (x.shop === prevShop) ? "" : esc(x.shop);
        var isGrp = (prevShop !== null && x.shop !== prevShop) ? ' class="grp"' : "";
        prevShop = x.shop;
        html.push('<tr' + isGrp + '><td>' + nameCell + '</td><td>' + esc(x.label) + (tgt ? ' <span class="wk-target">' + tgt + '</span>' : '') +
          '</td><td class="num">' + fmt(x.first, x.unit) + ' → ' + fmt(x.last, x.unit) + '</td>' +
          '<td class="num ' + (x.delta > 0 ? "up" : (x.delta < 0 ? "down" : "flat")) + '">' + (x.delta > 0 ? "+" : "") + (Math.round(x.delta * 100) / 100) +
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
    html.push('<details class="wk-card" data-skip-export="1"><summary class="wk-summary"><h3>全店指标明细 <span class="tag">首日 → 末日 ｜ 周均 ｜ ' + an.metricStatus.length + ' 行</span></h3></summary>');
    html.push('<div class="wk-table-wrap"><table><thead><tr><th>店铺</th><th>指标</th><th class="num">首日</th><th class="num">末日</th><th class="num">周均</th><th class="num">变动</th></tr></thead><tbody>');
    an.metricStatus.forEach(function (x) {
      // 箭头按数值方向（涨↑跌↓），颜色沿用驾驶舱约定（涨红跌绿），⚠ 表示"变差"
      var dir = x.delta > 0.0001 ? 1 : (x.delta < -0.0001 ? -1 : 0);
      var cls = dir > 0 ? "up" : (dir < 0 ? "down" : "flat");
      var arrow = dir > 0 ? "↑" : (dir < 0 ? "↓" : "—");
      var tgt = x.target != null ? (x.higher === false ? " ≤" : " ≥") + x.target + (x.unit === "%" ? "%" : "") : "";
      html.push('<tr><td>' + esc(x.shop) + '</td><td>' + esc(x.label) + (tgt ? ' <span class="wk-target">' + tgt + '</span>' : '') +
        '</td><td class="num">' + fmt(x.first, x.unit) + '</td><td class="num">' + fmt(x.last, x.unit) +
        '</td><td class="num">' + fmt(x.avg, x.unit) + '</td><td class="num ' + cls + '">' + arrow + ' ' +
        (Math.round(x.delta * 100) / 100) + (x.unit === "%" ? "pct" : "") + (x.drop ? ' ⚠' : '') + '</td></tr>');
    });
    html.push('</tbody></table></div></details>');

    // ④ 方案与验证（原方案三段式 + 验证闭环 + 下周待办合并）
    var summJoined = data.texts.map(function (t) { return t.summary; }).filter(Boolean).join("；");
    var toms = data.texts.map(function (t) { return t.tomorrow; }).filter(Boolean);
    html.push('<div class="wk-card"><h3>④ 方案与验证 <span class="tag">止血 / 治本 / 防复发</span></h3>');
    html.push('<div class="wk-row-k"><b>止血</b><span>' + (summJoined ? esc(summJoined) : "（日报未填配置总结，待补充）") + '</span></div>');
    html.push('<div class="wk-row-k"><b>治本</b><span class="wk-blank">针对归因的永久方案：_____</span></div>');
    html.push('<div class="wk-row-k"><b>防复发</b><span>日巡检 + 周复盘；关键场景上线前回归验证。</span></div>');
    html.push('<div class="wk-row-k"><b>下周待办</b><span>' + (toms.length ? esc(toms.join("；")) : "（日报未填明日待办）") + '</span></div>');
    html.push('<div class="wk-note">验证：下周同区间复查，回到目标线或环比改善即通过（T-3 / T-1 观察）' +
      (an.drops.length ? '；复发预警 ' + an.drops.length + ' 项优先排期' : '') + '。</div>');
    html.push('</div>');

    // ⑤ 每日日报原文（默认折叠，仅在页面查看；导出稿已含问题反馈，不重复带出）
    html.push('<details class="wk-card" data-skip-export="1"><summary class="wk-summary"><h3>⑤ 每日日报原文 <span class="tag">' + data.texts.length + ' 天</span></h3></summary>');
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
    html.push('<details class="wk-card" data-skip-export="1"><summary class="wk-summary"><h3>方法速查 <span class="tag">《问题分析与解决》</span></h3><div class="method-grid">');
    html.push('<div class="method"><h4>问题定义</h4><p>问题 = 现状 − 目标 = 差距。指标型（数字倒推）vs 事务型（事件正推）。5W1H 界定，假设≠结论。</p></div>');
    html.push('<div class="method"><h4>归因框架</h4><p>能力边界先行；四层：口径/历史配置/可修/合规；三层：瞬时检索/合规拦截/未覆盖；四类：答非所问/笼统/生硬/超纲。</p></div>');
    html.push('<div class="method"><h4>闭环流程</h4><p>五步：发现→界定→归因→方案→验证。方案三段式：止血→治本→防复发。</p></div>');
    html.push('<div class="method"><h4>验证标准</h4><p>好动作三标准：绑归因/有信号/有边界。做→看→判→调（3–7 天，T-3/T-1）。</p></div>');
    html.push('</div></details>');

    container.innerHTML = '<div class="wb-weekly">' + html.join("") + '</div>';
    container._weeklyText = buildText(data, an, rangeLabel);
    return { data: data, analyze: an, text: container._weeklyText };
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


  var EXPORT_CSS = ":root{\n  --ink:#17201c;--ink-2:#3c4742;--muted:#6a7671;--line:#e6ebe8;--line-2:#eff3f1;\n  --soft:#f6f8f7;--brand:#0f6f4e;--brand-soft:#eff7f3;--up:#c9333a;--down:#12805c;\n  --text:#17201c;--panel-2:#ffffff;--panel-soft:#f6f8f7;--line-bright:#e6ebe8;\n  --danger:#c9333a;--accent-rgb:16 130 92;--accent-300:#0f6f4e;--accent-400:#12805c;--accent-500:#0f6f4e;\n}\n*{box-sizing:border-box}\nbody{\n  margin:0;background:#f4f6f5;color:var(--ink);\n  font:13px/1.7 -apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif;\n  -webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;\n}\n.page{max-width:1000px;margin:0 auto;background:#fff;padding:40px 46px 52px;min-height:100vh}\n.doc-head{padding-bottom:16px;border-bottom:2px solid var(--ink)}\n.doc-head h1{margin:0 0 7px;font-size:21px;font-weight:600;letter-spacing:-.01em}\n.doc-head .meta{margin:0;color:var(--muted);font-size:12px}\n.doc-head .meta b{color:var(--ink-2);font-weight:500}\n.foot{margin-top:30px;padding-top:14px;border-top:1px solid var(--line);color:#98a29d;font-size:11px}\n\n/* 章节：去卡片框，改用分隔线 + 左侧色条，降低视觉噪音 */\n.wb-weekly{display:block}\n.wk-head{display:none}\n.wk-card{margin:0;padding:24px 0 4px;border:0;border-top:1px solid var(--line);background:none;border-radius:0}\n.wk-head + .wk-card{border-top:0;padding-top:24px}\n.wk-card h3{\n  margin:0 0 14px;font-size:14px;font-weight:600;color:var(--ink);\n  display:flex;align-items:center;gap:9px;flex-wrap:wrap;\n}\n.wk-card h3::before{content:\"\";width:3px;height:15px;border-radius:2px;background:var(--brand);flex:0 0 auto}\n.wk-card h3 .tag{\n  font-size:11px;font-weight:400;color:var(--muted);\n  padding:0;border:0;background:none;letter-spacing:.01em;\n}\n.wk-card h3 .tag::before{content:\"·\";margin-right:6px;color:#c2ccc7}\n\n/* 概览：标签下、数字上，四列 KPI */\n.wk-kv-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px 26px}\n.kv{display:flex;flex-direction:column-reverse;gap:3px;padding:0;border:0;min-width:0}\n.kv span{font-size:11.5px;color:var(--muted);letter-spacing:.01em}\n.kv b{font-size:19px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums;line-height:1.4}\n\n/* 表格：表头浅底、分组行分隔、数字右对齐 */\n.wk-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}\ntable{width:100%;border-collapse:collapse;font-size:12.5px}\nthead th{\n  background:var(--soft);color:var(--muted);font-weight:500;font-size:11px;\n  padding:8px 10px;text-align:left;white-space:nowrap;letter-spacing:.02em;\n  border-bottom:1px solid var(--line);\n}\nthead th:first-child{border-top-left-radius:6px;border-bottom-left-radius:6px}\nthead th:last-child{border-top-right-radius:6px;border-bottom-right-radius:6px}\ntbody td{padding:6px 10px;border-bottom:1px solid var(--line-2);white-space:nowrap;color:var(--ink-2)}\ntbody td:first-child{color:var(--ink);font-weight:500}\ntbody tr.grp td{border-top:1px solid var(--line)}\ntbody tr.grp:first-child td{border-top:0}\ntbody tr:last-child td{border-bottom:0}\ntd.num{text-align:right;font-variant-numeric:tabular-nums}\n\n/* 涨=红 跌=绿 */\n.up{color:var(--up)}\n.down{color:var(--down)}\n.flat{color:var(--muted)}\ntd.bad{color:var(--up)}\n.wk-wd{color:var(--muted);font-size:10.5px;margin-left:3px;font-weight:400}\n.wk-target{color:var(--muted);font-size:10.5px;font-weight:400}\n\n.badge{\n  display:inline-block;font-size:11px;padding:1px 8px;border-radius:4px;\n  background:#f2f5f3;color:var(--muted);margin-right:6px;vertical-align:1px;\n}\n.badge.drop{color:var(--up);background:#fdf0f0}\n\n/* 归因待填行：清单式，不加底色块 */\n.wk-q{padding:7px 0;border-bottom:1px dashed var(--line-2);font-size:12.5px;color:var(--ink-2);line-height:1.75}\n.wk-q:last-of-type{border-bottom:0}\n.wk-q b{color:var(--ink);font-weight:500}\n\n/* 问题 / 反馈：改为左侧引用线 */\n.fb{\n  border:0;background:none;border-left:2px solid #cfe3d9;\n  border-radius:0;padding:2px 0 2px 14px;margin:0 0 14px;\n  font-size:12.5px;color:var(--ink-2);line-height:1.75;\n}\n.fb .dt{color:var(--muted);font-size:11px;margin-bottom:2px}\n.fb.muted{color:var(--muted);border-left-color:var(--line)}\n\n/* 提示块 */\n.tmpl{\n  background:var(--brand-soft);border:0;border-radius:8px;\n  padding:12px 16px;font-size:12.5px;color:var(--ink-2);\n  line-height:1.8;margin-top:12px;\n}\n.tmpl b{color:var(--brand);font-weight:600}\n\nul{margin:6px 0;padding-left:18px}\nli{margin:3px 0}\n.grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px 30px}\n.wk-sub{font-size:12.5px;font-weight:600;color:var(--ink);margin:18px 0 8px}\n.wk-sub2{font-size:12px;font-weight:500;color:var(--brand);margin-bottom:6px}\n.wk-recur{margin-top:14px;font-size:12.5px;color:var(--ink-2);line-height:1.8}\n.wk-recur b{color:var(--brand);font-weight:600}\n.empty{color:var(--muted);font-size:12.5px;padding:4px 0}\n\n/* 折叠块在导出稿里全部展开，标题退化成分组小标题 */\ndetails>summary{display:block;cursor:default;list-style:none}\ndetails>summary::-webkit-details-marker{display:none}\ndetails>summary h3{margin:0 0 18px}\nsummary .tag{font-size:11px;font-weight:400;color:var(--muted);margin-left:2px}\nsummary .tag::before{content:\"·\";margin-right:6px;color:#c2ccc7}\n\n/* 每日日报原文 */\n.wk-day{border-top:1px solid var(--line-2);padding:13px 0 3px}\n.wk-day:first-of-type{border-top:0;padding-top:0}\n.wk-day-head{font-size:12.5px;font-weight:600;color:var(--brand);margin-bottom:8px}\n.wk-day-empty{color:var(--muted);font-size:11px;margin-left:8px;font-weight:400}\n.wk-day-row{display:flex;gap:12px;font-size:12.5px;padding:2px 0;line-height:1.75}\n.wk-day-row b{flex:0 0 66px;color:var(--muted);font-weight:400;font-size:11.5px;padding-top:2px}\n.wk-day-row span{color:var(--ink-2);min-width:0;white-space:pre-wrap}\n\n/* 方法速查 */\n.method-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px 30px}\n.method{border:0;border-left:2px solid var(--line);background:none;border-radius:0;padding:0 0 0 13px}\n.method h4{margin:0 0 3px;font-size:12px;font-weight:600;color:var(--ink)}\n.method p{margin:0;font-size:12px;color:var(--muted);line-height:1.7}\n\n@media (max-width:900px){\n  .wk-kv-grid{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .grid2,.method-grid{grid-template-columns:1fr}\n}\n@media (max-width:700px){\n  .page{padding:22px 18px 32px;min-height:0}\n  .doc-head h1{font-size:18px}\n  body{font-size:12.5px}\n}\n@media print{\n  body{background:#fff}\n  .page{max-width:none;padding:0;min-height:0}\n  .wk-card{break-inside:avoid;page-break-inside:avoid}\n  thead{display:table-header-group}\n  table{font-size:10.5px}\n  .tmpl,.fb,.method{break-inside:avoid}\n}\n\n/* 精简版新增：概览脚注、方案清单行 */\n.wk-note{margin-top:10px;font-size:11.5px;color:var(--muted);line-height:1.75}\n.wk-row-k{display:flex;gap:14px;padding:8px 0;border-bottom:1px solid var(--line-2);font-size:12.5px;line-height:1.8}\n.wk-row-k:last-of-type{border-bottom:0}\n.wk-row-k b{flex:0 0 62px;color:var(--brand);font-weight:600;font-size:12px;padding-top:1px}\n.wk-row-k span{color:var(--ink-2);min-width:0}\n.wk-row-k .wk-blank{color:var(--muted)}\n";

  function buildHtmlDoc(rangeLabel, keyShopCount, bodyHtml) {
    var n = new Date();
    var ts = n.getFullYear() + "-" + pad2(n.getMonth() + 1) + "-" + pad2(n.getDate()) +
      " " + pad2(n.getHours()) + ":" + pad2(n.getMinutes());
    return [
      "<!DOCTYPE html>",
      '<html lang="zh-CN">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      "<title>周度复盘 " + esc(rangeLabel) + "</title>",
      "<style>\n" + EXPORT_CSS + "\n</style>",
      "</head>",
      "<body>",
      '<div class="page">',
      '<div class="doc-head">',
      "<h1>客服 AI 周度复盘</h1>",
      '<p class="meta">周期 ' + esc(rangeLabel) + " · 重点店铺 " + keyShopCount + " 家 · 生成于 " + ts + "</p>",
      "</div>",
      '<div class="wb-weekly">',
      bodyHtml,
      "</div>",
      '<div class="foot">由「拼多多客服 AI 数据驾驶舱 · 周度复盘」生成 · 数据来源：探域 + 拼多多后台</div>',
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
    // 展开所有折叠块，收件人直接看到全部内容
    var body = el.innerHTML.replace(/<details(?![^>]*\sopen[\s=>])/g, "<details open");
    // 发给他人时剔除「自己看」的内容：全店明细、方法速查、日报里的配置总结/本周重点
    var tmp = document.createElement("div");
    tmp.innerHTML = body;
    var skips = tmp.querySelectorAll("[data-skip-export]");
    for (var si = 0; si < skips.length; si++) { if (skips[si].parentNode) { skips[si].parentNode.removeChild(skips[si]); } }
    var dropRows = tmp.querySelectorAll('.wk-day-row[data-row="sum"], .wk-day-row[data-row="focus"]');
    for (var di = 0; di < dropRows.length; di++) { if (dropRows[di].parentNode) { dropRows[di].parentNode.removeChild(dropRows[di]); } }
    body = tmp.innerHTML;
    body = tidyTables(body);
    body = tidyEmptyDays(body);
    var html = buildHtmlDoc(rangeLabel, data.keyShops.length, body);
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

  window.WeeklyReview = {
    render: render, collect: collect, analyze: analyze, buildText: buildText,
    getWorkbenchData: getWorkbenchData, exportCsv: exportCsv, exportHtml: exportHtml,
    latestDayKey: latestDayKey, shiftKey: shiftKey, todayKey: todayKey,
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
