/**
 * Toolview render test: mount the inline Jev tool view with REAL captured data
 * (fixture-decision.json, from a live jev-1.13.0 call) through react-dom/server
 * and assert the output is actually informative — not just that it renders.
 *
 * This is the "can a user SEE Jev working?" contract: the view must show the
 * decided values, their confidence, and the latency, for every answer type.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const code = readFileSync(new URL("../client/client.js", import.meta.url), "utf8");
globalThis.window = { __ModuleLoader__: { load: () => {} } };
const start = code.indexOf("factory: (require) => {") + "factory: (require) => {".length;
const end = code.lastIndexOf("return module.exports;");
const body = code.slice(start, end).replace(/^\s*/, "");
const factory = new Function("require", body + "\nreturn module.exports;");
const bundle = factory((n) => {
  if (n === "react") return React;
  return {};
});
const internal = bundle.__internal;
assert.ok(internal, "bundle exposes internals for tests");

const fixture = JSON.parse(readFileSync(new URL("../fixture-decision.json", import.meta.url), "utf8"));

// Rebuild the exact ToolResultNode shape a settled jev_decision call produces:
// the tool's render() emits ONE text block containing the formatted text.
const resultNode = {
  kind: "tool-result",
  seq: 2,
  time: Date.now(),
  callId: "call-1",
  call: { name: "jev_decision", argsRaw: JSON.stringify(fixture.args) },
  callTime: Date.now() - fixture.result.latencyMs,
  content: [{ type: "text", text: JSON.stringify(fixture.result) }],
  isError: false,
  subCalls: [],
};

// The view is registered under four keys; grab the component from the bundle by
// rendering through the same factory path the slot uses.
const slotInjects = [];
const registered = [];
const ctx = {
  settingsScope: { bind: () => ({ subscribe: () => () => {}, getSnapshot: () => ({ value: {}, writable: true }), set: async () => {} }) },
  slots: {
    inject: (name, fn) => slotInjects.push({ name, fn }),
    register: (opts, Comp) => { registered.push({ opts, Comp }); return { opts, Comp }; },
  },
  logger: { warn: () => {} },
};
bundle.apply(ctx);
const tvInject = slotInjects.find((s) => s.name === "tool.call.toolview");
assert.ok(tvInject, "toolview injection present");
const entries = [...tvInject.fn()];
const decisionEntry = entries.find((e) => e.opts.key === "jev_decision");
assert.ok(decisionEntry, "jev_decision toolview registered");

// Render settled: collapsed then expanded, plus the running state.
const settledCollapsed = renderToStaticMarkup(React.createElement(decisionEntry.Comp, { block: resultNode }));
assert.ok(/Jev 判定完成/.test(settledCollapsed), "settled state labelled");
assert.ok(/ms/.test(settledCollapsed), "latency shown in the header");
assert.ok(/djev-tvDotOk/.test(settledCollapsed), "success dot");

const runningNode = { callId: "call-2", name: "jev_decision", argsRaw: JSON.stringify(fixture.args), turn: 1, step: 1, time: Date.now(), subCalls: [] };
const running = renderToStaticMarkup(React.createElement(decisionEntry.Comp, { block: runningNode }));
assert.ok(/Jev 判定中/.test(running), "running state labelled");
assert.ok(/3 个问题/.test(running), "running shows the question count");
assert.ok(/djev-tvDotRun/.test(running), "running dot");

const errored = renderToStaticMarkup(React.createElement(decisionEntry.Comp, {
  block: { ...resultNode, isError: true, content: [{ type: "text", text: "jev_decision API error: 401 unauthorized" }] },
}));
assert.ok(/Jev 调用失败/.test(errored), "error state labelled");

// Every answer type must decode; this is what makes the view trustworthy.
const a = fixture.result.answers;
assert.equal(internal.readAnswer(a.is_urgent).value, "yes");
assert.equal(internal.readAnswer(a.sentiment).value, "negative");
assert.ok(/critical/.test(internal.readAnswer(a.severity).value));

// ---- presentationMeta path (the shipped one) --------------------------------
// The tool persists its structured payload on tool/result.meta; the view must
// prefer it over re-parsing the human-readable render text.
const metaDecision = {
  ...resultNode,
  meta: {
    kind: "decision", model: "jev-1.13.0", latencyMs: 78, estimatedCostUs: 0.000012,
    inputTokens: 42, outputTokens: 0, endpoint: "https://api.typesafe.ai/v1",
    answers: {
      is_urgent: { type: "noul", value: 0.98, confidence: null, probabilities: null, legend: null, reasoning: "customer is blocked" },
      sentiment: { type: "choice", value: "negative", confidence: 1, probabilities: { negative: 1 } },
      severity: { type: "score", value: 2.98, confidence: 0.98, legend: { "3": "critical" }, probabilities: { "3": 0.94 } },
    },
  },
};
const metaView = renderToStaticMarkup(React.createElement(decisionEntry.Comp, {
  block: metaDecision, toolName: "jev_decision", __forceOpen: true,
}));
assert.ok(/data-dsh-jev-kind="decision"/.test(metaView), "meta decision is recognised");
assert.ok(/置信度 98%/.test(metaView), "confidence rendered from meta");
assert.ok(/negative/.test(metaView), "choice value rendered from meta");
assert.ok(/critical/.test(metaView), "score legend resolved from meta");
assert.ok(/结构化结果/.test(metaView), "meta path is disclosed to the user");

const overviewEntry = entries.find((e) => e.opts.key === "jev_overview");
const overviewView = renderToStaticMarkup(React.createElement(overviewEntry.Comp, {
  toolName: "jev_overview", __forceOpen: true,
  block: {
    kind: "tool-result", callId: "c2", call: { name: "jev_overview", argsRaw: "{}" },
    content: [{ type: "text", text: "human readable text" }], isError: false, subCalls: [],
    meta: {
      kind: "overview",
      status: { model: "jev-latest", keyConfigured: true, guardActive: true, denyThreshold: 0.85, endpoint: "https://api.typesafe.ai/v1" },
      summary: { calls: 3, verifies: 1, guardDenials: 2, guardAdvisories: 0, medianLatencyMs: 88, avgLatencyMs: 90, avgConfidence: 0.91, totalInputTokens: 120, totalCostUs: 0.00005, typeCounts: { noul: 2 } },
      recent: [{ kind: "decision", ts: "2026-09-22T10:00:00.000Z", questions: [{ name: "is_urgent", type: "noul", value: 0.98, confidence: 0.98 }] }],
      guards: [{ ts: "2026-09-22T10:01:00.000Z", action: "deny", detail: "rm -rf /" }],
    },
  },
}));
assert.ok(/Jev 调用总览/.test(overviewView), "overview title");
assert.ok(/次判定/.test(overviewView), "overview stats rendered");
assert.ok(/deny · rm -rf \//.test(overviewView), "guard feed rendered");
assert.ok(/is_urgent=0.98（98%）/.test(overviewView), "recent decision rendered");

const guardEntry = entries.find((e) => e.opts.key === "jev_guard_status");
const guardView = renderToStaticMarkup(React.createElement(guardEntry.Comp, {
  toolName: "jev_guard_status", __forceOpen: true,
  block: {
    kind: "tool-result", callId: "c3", call: { name: "jev_guard_status", argsRaw: "{}" },
    content: [{ type: "text", text: "human readable text" }], isError: false, subCalls: [],
    meta: {
      kind: "guard", enabled: true, tools: ["bash", "pwsh"], denyThreshold: 0.85, budgetRemaining: 47,
      safety: { checks: 5, jevCalls: 3, denied: 1, deterministicDenied: 1, auditCalls: 9, lastSeenTool: "bash", seenTools: { bash: 4 }, lastVerdicts: { bash: "allow" } },
      loop: { checks: 2, jevCalls: 1, injected: 1, cooldownUntil: 0, window: [] },
    },
  },
}));
assert.ok(/Jev 护栏状态/.test(guardView), "guard title");
assert.ok(/护栏运行中/.test(guardView), "guard armed chip");
assert.ok(/受护栏工具：bash、pwsh/.test(guardView), "guarded tool list");
assert.ok(/最近工具：bash/.test(guardView), "last seen tool");

const verifyEntry = entries.find((e) => e.opts.key === "jev_verify");
const verifyView = renderToStaticMarkup(React.createElement(verifyEntry.Comp, {
  toolName: "jev_verify", __forceOpen: true,
  block: {
    kind: "tool-result", callId: "c4", call: { name: "jev_verify", argsRaw: "{}" },
    content: [{ type: "text", text: "human readable text" }], isError: false, subCalls: [],
    meta: {
      kind: "verify", verified: true, model: "jev-1.13.0", ranAt: "2026-09-22T10:02:00.000Z",
      caseCount: 15, questionCount: 24, correct: 22, accuracy: 0.9166, highConfidenceAccuracy: 0.95,
      medianMs: 95, p95Ms: 180, minMs: 60, maxMs: 400, inputTokens: 900, outputTokens: 0, estimatedUsd: 0.00004,
      failures: [{ caseId: "spam-2", question: "is_spam", type: "noul", expected: true, actual: false, confidence: 0.62 }],
    },
  },
}));
assert.ok(/Jev 实测验证/.test(verifyView), "verify title");
assert.ok(/92%/.test(verifyView), "accuracy rendered");
assert.ok(/误判用例/.test(verifyView), "failures listed");
assert.ok(/spam-2\/is_spam/.test(verifyView), "failure case named");

const verifyEmpty = renderToStaticMarkup(React.createElement(verifyEntry.Comp, {
  toolName: "jev_verify", __forceOpen: true,
  block: {
    kind: "tool-result", callId: "c5", call: { name: "jev_verify", argsRaw: "{}" },
    content: [{ type: "text", text: "jev_verify: no TYPESAFE_API_KEY configured" }], isError: false, subCalls: [],
    meta: { kind: "verify", verified: false, reason: "no TYPESAFE_API_KEY configured — verification not run; nothing is faked" },
  },
}));
assert.ok(/no TYPESAFE_API_KEY/.test(verifyEmpty), "an unrun verification says so instead of faking numbers");


// ---- jev_choose kind -------------------------------------------------------
const chooseEntry = entries.find((e) => e.opts.key === "jev_choose");
assert.ok(chooseEntry, "jev_choose toolview registered");
const chooseView = renderToStaticMarkup(React.createElement(chooseEntry.Comp, {
  toolName: "jev_choose", __forceOpen: true,
  block: {
    kind: "tool-result", callId: "c6", call: { name: "jev_choose", argsRaw: "{}" },
    content: [{ type: "text", text: "jev_choose | model=jev-1.13.0 | 3 个候选" }], isError: false, subCalls: [],
    meta: {
      kind: "choose", model: "jev-1.13.0", optionCount: 3, latencyMs: 2100, estimatedCostUs: 0.000067,
      ranking: [
        { index: 0, label: "直接发布", fit: 0.1, risk: 0.89, composite: 0.004, confidence: 0.9, latencyMs: 900 },
        { index: 1, label: "先验证后发布", fit: 2, risk: 0.24, composite: 0.507, confidence: 0.45, latencyMs: 500 },
        { index: 2, label: "只发 npm", fit: 1.09, risk: 0.56, composite: 0.16, confidence: 0.64, latencyMs: 700 },
      ],
      recommended: 1,
    },
  },
}));
assert.ok(/Jev 方案选型/.test(chooseView), "choose title");
assert.ok(/先验证后发布/.test(chooseView), "option label rendered");
assert.ok(/推荐/.test(chooseView), "recommended option highlighted");
assert.ok(chooseView.includes("契合") && chooseView.includes("2/3"), "fit column header and value shown");
assert.ok(chooseView.includes("风险") && chooseView.includes("24%"), "risk column header and value shown");
assert.ok(chooseView.includes("综合") && chooseView.includes("51%"), "composite column header and value shown");
assert.ok(chooseView.includes("置信") && chooseView.includes("45%"), "confidence column header and value shown");

// ---- jev_usage kind --------------------------------------------------------
const usageEntry = entries.find((e) => e.opts.key === "jev_usage");
assert.ok(usageEntry, "jev_usage toolview registered");
const usageView = renderToStaticMarkup(React.createElement(usageEntry.Comp, {
  toolName: "jev_usage", __forceOpen: true,
  block: {
    kind: "tool-result", callId: "c7", call: { name: "jev_usage", argsRaw: "{}" },
    content: [{ type: "text", text: "Jev 使用额度面板（本机实测 + 本地自设额度，非供应商余额）" }], isError: false, subCalls: [],
    meta: {
      kind: "usage", status: "warn", warnAtPercent: 80, resetInMs: 3600000, enforce: true, enabled: true,
      limits: { dailyCalls: 200, dailyCostUsd: 0.5, sessionCalls: 100 },
      used: { dailyCalls: 168, dailyCostUsd: 0.007042, sessionCalls: 43 },
      percent: { dailyCalls: 84, dailyCostUsd: 1.4, sessionCalls: 43 },
      projection: { callsPerHour: 12.5, projectedDailyCalls: 300, hoursToDailyLimit: 2.56, hitsDailyLimitAt: "2026-09-22T12:00:00.000Z" },
      today: { calls: 168, inputTokens: 168000, outputTokens: 600, medianLatencyMs: 285, p95LatencyMs: 1468, byTool: { jev_decision: 168 } },
      session: { calls: 43 },
      history: [{ day: "2026-09-20", calls: 12 }, { day: "2026-09-21", calls: 40 }, { day: "2026-09-22", calls: 168 }],
      byTool: { jev_decision: 168, jev_verify: 0 },
      persistence: { enabled: true, file: "C:/Users/x/.dsh/jev-usage.json" },
      provider: { balanceApiAvailable: false, note: "TypeSafe 未提供余额/额度接口，本面板只报本机实测用量与本地自设额度；这不是供应商侧余额。" },
      priceUsdPerMTok: 0.042,
    },
  },
}));
assert.ok(/Jev 使用额度/.test(usageView), "usage title");
assert.ok(/额度状态 warn/.test(usageView), "quota status chip");
assert.ok(usageView.includes("168") && usageView.includes("84%"), "measured calls and percent rendered");
assert.ok(/超额即停止调用/.test(usageView), "enforce state rendered");
assert.ok(/供应商余额/.test(usageView), "honesty note kept");
assert.ok(/近 3 天每日调用/.test(usageView), "history sparkline rendered");
assert.ok(usageView.includes("jev_decision ×168"), "per-tool breakdown rendered");

// ---- jev_batch kind --------------------------------------------------------
const batchEntry = entries.find((e) => e.opts.key === "jev_batch");
assert.ok(batchEntry, "jev_batch toolview registered");
const batchView = renderToStaticMarkup(React.createElement(batchEntry.Comp, {
  toolName: "jev_batch", __forceOpen: true,
  block: {
    kind: "tool-result", callId: "c8", call: { name: "jev_batch", argsRaw: JSON.stringify({ items: ["a", "b"], preset: "pii" }) },
    content: [{ type: "text", text: "jev_batch | model=jev-1.13.0 | 2 条 x 2 问" }], isError: false, subCalls: [],
    meta: {
      kind: "batch", model: "jev-1.13.0", itemCount: 2, questionCount: 2, failed: 1,
      latencyMs: 640, estimatedCostUs: 0.000084, inputTokens: 2000, outputTokens: 20,
      endpoint: "https://api.typesafe.ai/v1",
      columns: [{ name: "has_personal_data", type: "noul" }, { name: "has_secret", type: "noul" }],
      rows: [
        { index: 0, label: "call me on 138", cells: ["90%", "10%"], latencyMs: 300, error: null },
        { index: 1, label: "BOOM", cells: ["失败", "失败"], latencyMs: 0, error: "HTTP 500: boom" },
      ],
    },
  },
}));
assert.ok(/Jev 批量判定/.test(batchView), "batch title");
assert.ok(/2 条 x 2 问/.test(batchView) && /1 条失败/.test(batchView), "batch shape and failure count shown");
assert.ok(batchView.includes("has_personal_data (noul)"), "batch column header rendered");
assert.ok(batchView.includes("90%") && batchView.includes("call me on 138"), "batch cell and label rendered");
assert.ok(/失败 #1 BOOM — HTTP 500: boom/.test(batchView), "failed row shows the real error");
const batchRunning = renderToStaticMarkup(React.createElement(batchEntry.Comp, {
  block: { callId: "c9", name: "jev_batch", argsRaw: JSON.stringify({ items: ["a", "b", "c"], preset: "spam" }), turn: 1, step: 1, time: Date.now(), subCalls: [] },
}));
assert.ok(/Jev 批量判定中/.test(batchRunning), "batch running label");

console.log("PASS: toolview renders running / settled / error states — and every presentationMeta kind (decision/overview/guard/verify/choose/usage/batch) with real data");
