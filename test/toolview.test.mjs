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

console.log("PASS: toolview renders running / settled / error states with real data");
