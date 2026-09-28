/**
 * PRESENTATION CONTRACT test.
 *
 * Every Jev tool declares output.presentationMeta(args, value). dsh persists
 * that payload verbatim on tool/result as `meta`, and the client tool view
 * renders it (client/client.js). So this file pins the two things the UI
 * depends on: the payload keeps its `kind`, and it is lossless JSON on every
 * input shape (defineTool clones it, so a non-JSON value would be dropped).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apply, __internal } from "../lib/index.js";

function fakeCtx() {
  const tools = [];
  const ctx = {
    tools: { register: (t) => tools.push(t) },
    logger: { info() {}, warn() {}, error() {} },
    get: () => undefined,
    inject: (services, cb) => {
      const have = { settings: true, webServer: true, systemPrompt: true };
      if (services.every((s) => have[s] === true)) {
        cb({
          settings: { register: () => ({ get: () => ({}), watch: () => {} }) },
          webServer: { register() {} },
          systemPrompt: { section() {} },
        });
      }
    },
    on: () => {},
  };
  return { ctx, tools };
}

const { ctx, tools } = fakeCtx();
apply(ctx, { enabled: true, verifyEnabled: true, autoGuard: { enabled: true, statusTool: true } });
const byName = new Map(tools.map((t) => [t.name, t]));

const KINDS = {
  jev_decision: "decision",
  jev_overview: "overview",
  jev_guard_status: "guard",
  jev_verify: "verify",
};

for (const [toolName, kind] of Object.entries(KINDS)) {
  const tool = byName.get(toolName);
  assert.ok(tool, toolName + " is registered");
  assert.equal(typeof tool.output.presentationMeta, "function", toolName + " declares presentationMeta");
  assert.ok(typeof tool.output.render === "function", toolName + " still renders text for the model");
  // dsh persists meta verbatim; a non-JSON payload would be rejected/dropped.
  for (const value of [null, undefined, 42, "x", [], true, {}]) {
    const projected = tool.output.presentationMeta({}, value);
    assert.ok(projected && typeof projected === "object", toolName + " projects an object for " + JSON.stringify(value));
    assert.equal(projected.kind, kind, toolName + " keeps kind for " + JSON.stringify(value));
    assert.deepEqual(JSON.parse(JSON.stringify(projected)), projected, toolName + " payload is lossless JSON for " + JSON.stringify(value));
  }
}

// Real captured decision data must survive the projection intact.
const fixture = JSON.parse(readFileSync(new URL("../fixture-decision.json", import.meta.url), "utf8"));
const d = __internal.decisionPresentation(fixture.result);
assert.equal(d.model, fixture.result.model, "model preserved");
assert.equal(d.latencyMs, fixture.result.latencyMs, "latency preserved");
assert.equal(d.endpoint, fixture.result.endpoint, "endpoint preserved");
assert.ok(d.answers.is_urgent, "answers survive");
assert.equal(d.answers.is_urgent.type, "noul", "answer type survives");
assert.equal(typeof d.answers.is_urgent.value, "number", "noul keeps its yes-probability");
assert.deepEqual(JSON.parse(JSON.stringify(d)), d, "real decision payload is lossless JSON");

// Each projection is total and clamps oversized free text (meta is persisted
// per call, so an unbounded reasoning string would bloat every transcript).
const long = { answers: { q: { type: "choice", choice: "a", confidence: 0.9, reasoning: "x".repeat(5000) } } };
assert.ok(__internal.decisionPresentation(long).answers.q.reasoning.length <= 600, "reasoning is clamped");
const ov = __internal.overviewPresentation({ recent: Array.from({ length: 40 }, (_, i) => ({ questions: [{ name: "q" + i }] })) });
assert.ok(ov.recent.length <= 8, "overview keeps only the newest entries");
const g = __internal.guardPresentation({ enabled: true, safety: { lastVerdicts: new Map([["bash", "allow"]]) } });
assert.deepEqual(g.safety.lastVerdicts, { bash: "allow" }, "Map verdicts become plain objects");
assert.deepEqual(JSON.parse(JSON.stringify(g)), g, "guard payload is lossless JSON");
const v = __internal.verifyPresentation(null);
assert.equal(v.verified, false, "missing key is reported honestly");
assert.ok(/TYPESAFE_API_KEY/.test(v.reason), "reason names the missing key");

console.log("PASS: all four tools declare lossless-JSON presentationMeta payloads");