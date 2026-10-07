/**
 * Jev usage ledger & quota windows.
 *
 * HONEST BOUNDARY, verified against the live API on 2026-10-05: TypeSafe
 * exposes NO balance/quota endpoint. GET /v1/usage, /v1/quota, /v1/account,
 * /v1/me, /v1/balance, /v1/credits, /v1/limits, /v1/billing, /v1/subscription
 * and /v1/plan all answer 404; only POST /v1/systemone and GET /v1/models
 * exist. This module therefore reports what THIS instance actually measured
 * (calls, tokens, estimated cost, latency, guard verdicts) plus locally
 * configured policy budgets. It never claims a provider-side balance, and it
 * never invents numbers when nothing has been recorded.
 *
 * Everything is local: history lives in $DSH_HOME/jev-usage.json (opt-in via
 * quota.persist), the in-memory windows always work.
 */
import { readFileSync, writeFileSync, renameSync } from "node:fs";

const MAX_RECENT = 400;
const MAX_SAMPLES_PER_DAY = 120;
const SAVE_THROTTLE_MS = 3000;
const FILE_VERSION = 1;

/** Local-time YYYY-MM-DD for a timestamp. */
export function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/** Next local midnight after `ms` (the daily-quota reset instant). */
export function nextMidnight(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

function emptyBucket() {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUs: 0,
    latencySumMs: 0,
    latencyCount: 0,
    latencyMaxMs: 0,
    samples: [],
    byTool: {},
    byKind: {},
    typeCounts: {},
    guardDenied: 0,
    guardAdvised: 0,
  };
}

function blank(value) {
  const b = emptyBucket();
  if (!value || typeof value !== "object") return b;
  b.calls = Number(value.calls) || 0;
  b.inputTokens = Number(value.inputTokens) || 0;
  b.outputTokens = Number(value.outputTokens) || 0;
  b.costUs = Number(value.costUs) || 0;
  b.latencySumMs = Number(value.latencySumMs) || 0;
  b.latencyCount = Number(value.latencyCount) || 0;
  b.latencyMaxMs = Number(value.latencyMaxMs) || 0;
  b.samples = Array.isArray(value.samples) ? value.samples.filter((v) => typeof v === "number").slice(-MAX_SAMPLES_PER_DAY) : [];
  b.byTool = value.byTool && typeof value.byTool === "object" ? { ...value.byTool } : {};
  b.byKind = value.byKind && typeof value.byKind === "object" ? { ...value.byKind } : {};
  b.typeCounts = value.typeCounts && typeof value.typeCounts === "object" ? { ...value.typeCounts } : {};
  b.guardDenied = Number(value.guardDenied) || 0;
  b.guardAdvised = Number(value.guardAdvised) || 0;
  return b;
}

function mergeInto(target, source) {
  target.calls += source.calls;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.costUs += source.costUs;
  target.latencySumMs += source.latencySumMs;
  target.latencyCount += source.latencyCount;
  target.latencyMaxMs = Math.max(target.latencyMaxMs, source.latencyMaxMs);
  for (const s of source.samples) target.samples.push(s);
  for (const [k, v] of Object.entries(source.byTool)) target.byTool[k] = (target.byTool[k] ?? 0) + v;
  for (const [k, v] of Object.entries(source.byKind)) target.byKind[k] = (target.byKind[k] ?? 0) + v;
  for (const [k, v] of Object.entries(source.typeCounts)) target.typeCounts[k] = (target.typeCounts[k] ?? 0) + v;
  target.guardDenied += source.guardDenied;
  target.guardAdvised += source.guardAdvised;
  return target;
}

function percentile(samples, p) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

export function defaultUsageFile() {
  const home = globalThis.process?.env?.DSH_HOME;
  return typeof home === "string" && home.length > 0 ? home + "/jev-usage.json" : null;
}

export function createUsageModule({ inputPriceUsdPerMTok = 0.042, now = () => Date.now(), filePath = undefined } = {}) {
  const startedAt = now();
  const daily = new Map();
  const recent = [];
  let persist = false;
  let historyDays = 30;
  let loaded = false;
  let file = filePath;
  let lastSaveAt = 0;
  let lastSaveError = null;
  let saveCount = 0;

  function resolveFile() {
    if (file === undefined) file = defaultUsageFile();
    return file;
  }

  function load() {
    if (loaded) return;
    loaded = true;
    const path = resolveFile();
    if (path === null) return;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      const days = parsed?.days && typeof parsed.days === "object" ? parsed.days : {};
      for (const [day, raw] of Object.entries(days)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) daily.set(day, blank(raw));
      }
    } catch {
      /* a missing/corrupt history file must never break a decision */
    }
  }

  function save(force) {
    if (!persist) return;
    const path = resolveFile();
    if (path === null) return;
    const stamp = now();
    if (!force && stamp - lastSaveAt < SAVE_THROTTLE_MS) return;
    lastSaveAt = stamp;
    prune();
    try {
      const days = {};
      for (const [day, bucket] of [...daily.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        days[day] = { ...bucket, samples: bucket.samples.slice(-MAX_SAMPLES_PER_DAY) };
      }
      const payload = JSON.stringify({ version: FILE_VERSION, updatedAt: new Date(stamp).toISOString(), days });
      const tmp = path + ".tmp";
      writeFileSync(tmp, payload);
      renameSync(tmp, path);
      saveCount += 1;
      lastSaveError = null;
    } catch (error) {
      // Losing history is acceptable; breaking a decision is not.
      lastSaveError = String(error?.message ?? error);
    }
  }

  function prune() {
    const cutoff = dayKey(now() - historyDays * 86400000);
    for (const day of [...daily.keys()]) if (day < cutoff) daily.delete(day);
  }

  function bucketFor(day) {
    let bucket = daily.get(day);
    if (bucket === undefined) {
      bucket = emptyBucket();
      daily.set(day, bucket);
    }
    return bucket;
  }

  /**
   * Record one measured event. `calls` lets a batch (jev_verify runs 27 real
   * requests) count as 27 calls while staying one ledger row.
   */
  function record(entry) {
    if (!entry || typeof entry !== "object") return;
    load();
    const at = typeof entry.at === "number" ? entry.at : now();
    const kind = typeof entry.kind === "string" ? entry.kind : "decision";
    const tool = typeof entry.tool === "string" && entry.tool.length > 0 ? entry.tool : "jev_" + kind;
    const calls = Math.max(0, Math.round(Number(entry.calls) || (kind === "guard" ? 0 : 1)));
    const inputTokens = Math.max(0, Number(entry.inputTokens) || 0);
    const outputTokens = Math.max(0, Number(entry.outputTokens) || 0);
    const costUs = Number.isFinite(entry.costUs) ? Math.max(0, entry.costUs) : (inputTokens * inputPriceUsdPerMTok) / 1e6;
    const latencyMs = Number.isFinite(entry.latencyMs) && entry.latencyMs > 0 ? Math.round(entry.latencyMs) : null;
    const questions = Array.isArray(entry.questions) ? entry.questions : [];

    const bucket = bucketFor(dayKey(at));
    bucket.calls += calls;
    bucket.inputTokens += inputTokens;
    bucket.outputTokens += outputTokens;
    bucket.costUs += costUs;
    if (kind === "guard") {
      if (entry.action === "deny") bucket.guardDenied += 1;
      else if (entry.action === "advise") bucket.guardAdvised += 1;
    }
    if (kind !== "guard") bucket.byKind[kind] = (bucket.byKind[kind] ?? 0) + calls;
    bucket.byTool[tool] = (bucket.byTool[tool] ?? 0) + calls;
    for (const q of questions) {
      const type = typeof q?.type === "string" && q.type.length > 0 ? q.type : "?";
      bucket.typeCounts[type] = (bucket.typeCounts[type] ?? 0) + 1;
    }
    if (latencyMs !== null) {
      bucket.latencySumMs += latencyMs;
      bucket.latencyCount += 1;
      bucket.latencyMaxMs = Math.max(bucket.latencyMaxMs, latencyMs);
      bucket.samples.push(latencyMs);
      if (bucket.samples.length > MAX_SAMPLES_PER_DAY) bucket.samples.shift();
    }

    recent.push({ at, kind, tool, calls, inputTokens, outputTokens, costUs, latencyMs, action: entry.action ?? null, stateHead: entry.stateHead ?? null });
    if (recent.length > MAX_RECENT) recent.shift();
    save(false);
  }

  function windowFromBuckets(buckets) {
    const total = emptyBucket();
    for (const bucket of buckets) mergeInto(total, bucket);
    const medianLatencyMs = percentile(total.samples, 50);
    const p95LatencyMs = percentile(total.samples, 95);
    return {
      calls: total.calls,
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      costUs: total.costUs,
      medianLatencyMs,
      p95LatencyMs,
      maxLatencyMs: total.latencyMaxMs > 0 ? total.latencyMaxMs : null,
      byTool: total.byTool,
      byKind: total.byKind,
      typeCounts: total.typeCounts,
      guards: { denied: total.guardDenied, advised: total.guardAdvised },
      sampleCount: total.latencyCount,
    };
  }

  function bucketsFor(days) {
    const stamp = now();
    const out = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = dayKey(stamp - i * 86400000);
      out.push(daily.get(day) ?? emptyBucket());
    }
    return out;
  }

  /**
   * Read-only snapshot. `quota` carries the configured policy budgets,
   * `guard` the live auto-guard counters (owned by the guard module).
   */
  function snapshot({ quota = {}, guard = null, nowMs = undefined } = {}) {
    load();
    const stamp = typeof nowMs === "number" ? nowMs : now();
    const today = daily.get(dayKey(stamp)) ?? emptyBucket();
    const history = [];
    for (let i = historyDays - 1; i >= 0; i -= 1) {
      const day = dayKey(stamp - i * 86400000);
      const bucket = daily.get(day) ?? emptyBucket();
      history.push({ day, calls: bucket.calls, costUs: bucket.costUs, inputTokens: bucket.inputTokens });
    }

    const limits = {
      dailyCalls: Number(quota.dailyCallLimit) > 0 ? Math.round(Number(quota.dailyCallLimit)) : null,
      dailyCostUsd: Number(quota.dailyCostLimitUsd) > 0 ? Number(quota.dailyCostLimitUsd) : null,
      sessionCalls: Number(quota.sessionCallLimit) > 0 ? Math.round(Number(quota.sessionCallLimit)) : null,
    };
    // The session window is the in-memory ring's own accumulator: rebuild it
    // from `recent` so a long-lived session survives day rollover.
    const sessionTotals = emptyBucket();
    for (const e of recent) {
      if (e.kind === "guard") continue;
      sessionTotals.calls += e.calls;
      sessionTotals.inputTokens += e.inputTokens;
      sessionTotals.outputTokens += e.outputTokens;
      sessionTotals.costUs += e.costUs;
      sessionTotals.byTool[e.tool] = (sessionTotals.byTool[e.tool] ?? 0) + e.calls;
      sessionTotals.byKind[e.kind] = (sessionTotals.byKind[e.kind] ?? 0) + e.calls;
    }
    if (sessionTotals.latencyCount === 0) sessionTotals.latencyCount = 0;
    const session = {
      since: new Date(startedAt).toISOString(),
      calls: sessionTotals.calls,
      inputTokens: sessionTotals.inputTokens,
      outputTokens: sessionTotals.outputTokens,
      costUs: sessionTotals.costUs,
      medianLatencyMs: percentile(recent.filter((e) => e.kind !== "guard" && e.latencyMs).map((e) => e.latencyMs), 50),
      p95LatencyMs: percentile(recent.filter((e) => e.kind !== "guard" && e.latencyMs).map((e) => e.latencyMs), 95),
      maxLatencyMs: recent.reduce((m, e) => (e.latencyMs !== null && e.latencyMs > m ? e.latencyMs : m), 0) || null,
      byTool: sessionTotals.byTool,
      byKind: sessionTotals.byKind,
      sampleCount: recent.filter((e) => e.latencyMs !== null).length,
    };

    const resetAtMs = nextMidnight(stamp);
    const msSinceMidnight = stamp - (resetAtMs - 86400000);
    const hoursElapsed = Math.max(msSinceMidnight / 3600000, 1 / 60);
    const callsPerHour = today.calls / hoursElapsed;
    const elapsedHoursToLimit = limits.dailyCalls !== null && callsPerHour > 0 ? Math.max(0, limits.dailyCalls - today.calls) / callsPerHour : null;
    const projectedDailyCalls = Math.round(callsPerHour * 24);

    const percentages = {};
    if (limits.dailyCalls !== null) percentages.dailyCalls = (today.calls / limits.dailyCalls) * 100;
    if (limits.dailyCostUsd !== null) percentages.dailyCostUsd = (today.costUs / limits.dailyCostUsd) * 100;
    if (limits.sessionCalls !== null) percentages.sessionCalls = (session.calls / limits.sessionCalls) * 100;
    const warnAt = Number(quota.warnAtPercent) > 0 ? Number(quota.warnAtPercent) : 80;
    const worst = Math.max(0, ...Object.values(percentages));
    const status = worst >= 100 ? "exceeded" : worst >= warnAt ? "warn" : "ok";

    return {
      asOf: new Date(stamp).toISOString(),
      since: new Date(startedAt).toISOString(),
      // Windows over the persisted daily buckets; "all" is everything on file.
      windows: {
        today: windowFromBuckets([today]),
        d7: windowFromBuckets(bucketsFor(7)),
        d30: windowFromBuckets(bucketsFor(30)),
        all: windowFromBuckets([...daily.values()]),
        session,
      },
      quota: {
        enabled: quota.enabled !== false,
        enforce: quota.enforce === true,
        warnAtPercent: warnAt,
        limits,
        // 0.8.4: a panel must know whether ANY local budget exists. Without this
        // the UI printed "额度正常 / 额度重置还剩 13 小时" for a user who never set
        // a limit — a countdown to a budget that does not exist.
        budgetConfigured: limits.dailyCalls !== null || limits.dailyCostUsd !== null || limits.sessionCalls !== null,
        used: { dailyCalls: today.calls, dailyCostUsd: today.costUs, sessionCalls: session.calls },
        remaining: {
          dailyCalls: limits.dailyCalls === null ? null : Math.max(0, limits.dailyCalls - today.calls),
          dailyCostUsd: limits.dailyCostUsd === null ? null : Math.max(0, limits.dailyCostUsd - today.costUs),
          sessionCalls: limits.sessionCalls === null ? null : Math.max(0, limits.sessionCalls - session.calls),
        },
        percent: percentages,
        status,
        resetAt: new Date(resetAtMs).toISOString(),
        resetInMs: resetAtMs - stamp,
        projection: {
          callsPerHour: Math.round(callsPerHour * 100) / 100,
          projectedDailyCalls,
          hoursToDailyLimit: elapsedHoursToLimit,
          hitsDailyLimitAt: elapsedHoursToLimit === null ? null : new Date(stamp + elapsedHoursToLimit * 3600000).toISOString(),
        },
      },
      guard: guard === null || guard === undefined ? null : guard,
      history,
      historyDays,
      persistence: {
        enabled: persist,
        file: resolveFile(),
        writes: saveCount,
        lastError: lastSaveError,
      },
      // The one thing a panel must never fake.
      provider: {
        balanceApiAvailable: false,
        // Deliberately budget-agnostic: saying "与本地自设额度" when no limit is
        // configured is itself the kind of claim the panel must never make.
        note: "TypeSafe 未提供余额/额度接口（/v1/usage 等均 404），本面板只报本机实测用量；若你另外设了本地预算，也只是本机自设、不是供应商侧额度。",
      },
      recent: recent.slice(-40).map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
      priceUsdPerMTok: inputPriceUsdPerMTok,
    };
  }

  /** Opt-in hard stop. Display-only when quota.enforce is false (the default). */
  function checkBudget({ quota = {}, guard = null } = {}) {
    const snap = snapshot({ quota, guard });
    const q = snap.quota;
    if (!q.enabled || !q.enforce) return { allowed: true, reason: null, snapshot: snap };
    if (q.limits.dailyCalls !== null && q.used.dailyCalls >= q.limits.dailyCalls) {
      return { allowed: false, reason: "daily call budget reached (" + q.used.dailyCalls + "/" + q.limits.dailyCalls + ")", snapshot: snap };
    }
    if (q.limits.dailyCostUsd !== null && q.used.dailyCostUsd >= q.limits.dailyCostUsd) {
      return { allowed: false, reason: "daily cost budget reached ($" + q.used.dailyCostUsd.toFixed(6) + "/$" + q.limits.dailyCostUsd.toFixed(6) + ")", snapshot: snap };
    }
    if (q.limits.sessionCalls !== null && q.used.sessionCalls >= q.limits.sessionCalls) {
      return { allowed: false, reason: "session call budget reached (" + q.used.sessionCalls + "/" + q.limits.sessionCalls + ")", snapshot: snap };
    }
    return { allowed: true, reason: null, snapshot: snap };
  }

  function configure({ persist: persistFlag, historyDays: days, filePath: path } = {}) {
    if (typeof persistFlag === "boolean") persist = persistFlag;
    if (Number(days) > 0) historyDays = Math.max(1, Math.min(365, Math.round(Number(days))));
    if (typeof path === "string" || path === null) file = path;
    if (persist) save(true);
  }

  function reset() {
    daily.clear();
    recent.length = 0;
    loaded = true;
    save(true);
  }

  return { record, snapshot, checkBudget, configure, reset, dayKey: () => dayKey(now()), recent, daily };
}

/* ------------------------------------------------------------------ *
 * Text + UI formatting.                                             *
 * ------------------------------------------------------------------ */

const BAR_CELLS = 12;

export function bar(percent, cells = BAR_CELLS) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const filled = Math.round((clamped / 100) * cells);
  return "█".repeat(filled) + "░".repeat(Math.max(0, cells - filled));
}

const SPARK = "▁▂▃▄▅▆▇█";

export function sparkline(values) {
  const nums = (values ?? []).map((v) => (Number.isFinite(v) ? v : 0));
  if (nums.length === 0) return "";
  const max = Math.max(...nums);
  if (max <= 0) return "▁".repeat(nums.length);
  return nums.map((v) => SPARK[Math.min(SPARK.length - 1, Math.round((v / max) * (SPARK.length - 1)))]).join("");
}

export function fmtInt(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function fmtUsd(usd, digits = 6) {
  const v = Number(usd) || 0;
  if (v > 0 && v < 10 ** -digits) return "<$" + (10 ** -digits).toFixed(digits);
  return "$" + v.toFixed(digits);
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours <= 0) return minutes + "m";
  return hours + "h " + (minutes % 60) + "m";
}

function quotaLine(label, used, limit, percent, extra) {
  if (limit === null || limit === undefined) return label + "  未设上限（本机实测 " + used + "）";
  return label + "  [" + bar(percent) + "]  " + used + "/" + limit + "  " + Math.round(percent) + "%" + (extra ? "  " + extra : "");
}

export function formatUsage(snap, windowName = "all") {
  if (!snap || typeof snap !== "object") return "jev_usage: 无数据";
  const q = snap.quota ?? {};
  const win = (snap.windows ?? {})[windowName] ?? snap.windows?.all ?? {};
  const lines = [];
  const hasBudget = q.budgetConfigured === true || q.limits?.dailyCalls != null || q.limits?.dailyCostUsd != null || q.limits?.sessionCalls != null;
  lines.push("Jev 本机用量（本机实测" + (hasBudget ? " + 本地自设预算" : "，未设任何上限") + "，非供应商余额）");
  lines.push("");
  lines.push(hasBudget ? "### 今日（本地自设上限）" : "### 今日（未设上限，仅报实测）");
  lines.push(quotaLine("调用", fmtInt(q.used?.dailyCalls), q.limits?.dailyCalls === null || q.limits?.dailyCalls === undefined ? null : fmtInt(q.limits.dailyCalls), q.percent?.dailyCalls ?? 0, hasBudget ? "状态 " + (q.status ?? "ok") + " · 本地预算重置还剩 " + fmtDuration(q.resetInMs) : null));
  lines.push(quotaLine("成本", fmtUsd(q.used?.dailyCostUsd), q.limits?.dailyCostUsd === null || q.limits?.dailyCostUsd === undefined ? null : fmtUsd(q.limits.dailyCostUsd), q.percent?.dailyCostUsd ?? 0));
  lines.push(quotaLine("会话", fmtInt(q.used?.sessionCalls), q.limits?.sessionCalls === null || q.limits?.sessionCalls === undefined ? null : fmtInt(q.limits.sessionCalls), q.percent?.sessionCalls ?? 0, snap.windows?.session ? "自 " + String(snap.windows.session.since).slice(11, 16) + " UTC" : ""));
  if (hasBudget && q.projection && q.projection.callsPerHour > 0) {
    const proj = q.projection;
    lines.push("  按当前速率 " + proj.callsPerHour + " 次/时 → 全天预计 " + fmtInt(proj.projectedDailyCalls) + " 次" + (proj.hoursToDailyLimit === null ? "" : "，约 " + fmtDuration(proj.hoursToDailyLimit * 3600000) + "后触顶"));
  }
  lines.push("");
  lines.push("### 用量窗口");
  const order = ["today", "d7", "d30", "all", "session"];
  const labels = { today: "今日", d7: "近 7 天", d30: "近 30 天", all: "文件累计", session: "本插件实例" };
  for (const key of order) {
    const w = snap.windows?.[key];
    if (!w) continue;
    lines.push("- " + labels[key] + "：调用 " + fmtInt(w.calls) + " · 输入 " + fmtInt(w.inputTokens) + " tok · 输出 " + fmtInt(w.outputTokens) + " tok · 约 " + fmtUsd(w.costUs) + (w.medianLatencyMs === null ? "" : " · 中位 " + w.medianLatencyMs + " ms / p95 " + (w.p95LatencyMs ?? "—") + " ms"));
  }
  lines.push("");
  lines.push("### 当前窗口（" + labels[windowName] + "）分解");
  lines.push("- 调用 " + fmtInt(win.calls) + " · 输入 " + fmtInt(win.inputTokens) + " tok · 输出 " + fmtInt(win.outputTokens) + " tok · 约 " + fmtUsd(win.costUs));
  const byTool = Object.entries(win.byTool ?? {}).sort((a, b) => b[1] - a[1]);
  lines.push("- 按工具：" + (byTool.length ? byTool.map(([k, v]) => k + " " + v).join(" · ") : "暂无"));
  const byKind = Object.entries(win.byKind ?? {}).sort((a, b) => b[1] - a[1]);
  lines.push("- 按类型：" + (byKind.length ? byKind.map(([k, v]) => k + " " + v).join(" · ") : "暂无"));
  const types = Object.entries(win.typeCounts ?? {}).sort((a, b) => b[1] - a[1]);
  lines.push("- 按题型：" + (types.length ? types.map(([k, v]) => k + " " + v).join(" · ") : "暂无"));
  lines.push("- 护栏：拦截 " + (win.guards?.denied ?? 0) + " · 建议 " + (win.guards?.advised ?? 0) + (snap.guard ? " · 会话 Jev 预算剩 " + (snap.guard.budgetRemaining ?? "—") : ""));
  lines.push("- 时延：中位 " + (win.medianLatencyMs ?? "—") + " ms · p95 " + (win.p95LatencyMs ?? "—") + " ms · 最慢 " + (win.maxLatencyMs ?? "—") + " ms（" + fmtInt(win.sampleCount) + " 个样本）");
  lines.push("");
  const history = snap.history ?? [];
  lines.push("### 近 " + history.length + " 天趋势（调用次数）");
  lines.push("  " + sparkline(history.map((h) => h.calls)) + "   峰值 " + fmtInt(Math.max(0, ...history.map((h) => h.calls))) + " 次/日 · 合计 " + fmtInt(history.reduce((s, h) => s + h.calls, 0)) + " 次");
  lines.push("");
  lines.push("边界：" + (snap.provider?.note ?? ""));
  lines.push("存储：" + (snap.persistence?.enabled ? "已启用本地历史 → " + snap.persistence.file + "（保留 " + snap.historyDays + " 天）" : "仅内存（quota.persist 未开启，重启即归零）"));
  lines.push("如需强制上限，把 quota.enforce 设为 true；届时超额调用会明确报错，而不是悄悄继续。");
  return lines.join("\n");
}

/** Structured payload for the client tool view. */
export function usagePresentation(snap) {
  if (!snap || typeof snap !== "object") return { kind: "usage" };
  const q = snap.quota ?? {};
  const today = snap.windows?.today ?? {};
  return {
    kind: "usage",
    asOf: snap.asOf,
    status: q.status ?? "ok",
    budgetConfigured: q.budgetConfigured === true,
    allCalls: (snap.windows?.all ?? {}).calls ?? 0,
    allCostUs: (snap.windows?.all ?? {}).costUs ?? 0,
    warnAtPercent: q.warnAtPercent ?? 80,
    resetAt: q.resetAt ?? null,
    resetInMs: q.resetInMs ?? null,
    limits: q.limits ?? {},
    used: q.used ?? {},
    remaining: q.remaining ?? {},
    percent: q.percent ?? {},
    projection: q.projection ?? null,
    enforce: q.enforce === true,
    enabled: q.enabled !== false,
    today,
    session: snap.windows?.session ?? null,
    history: (snap.history ?? []).map((h) => ({ day: h.day, calls: h.calls, costUs: h.costUs })),
    byTool: today.byTool ?? {},
    byKind: today.byKind ?? {},
    typeCounts: today.typeCounts ?? {},
    guard: snap.guard ?? null,
    persistence: snap.persistence ?? null,
    provider: snap.provider ?? null,
    priceUsdPerMTok: snap.priceUsdPerMTok ?? null,
  };
}
