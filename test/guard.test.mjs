/**
 * Guard unit/functional tests: deterministic rules + Jev-backed risk/loop
 * paths against a LOCAL mock TypeSafe server (no real credentials needed).
 */
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { createGuardModule } from "../lib/guard.js";

const PORT = 38751;
const BASE = `http://127.0.0.1:${PORT}/v1`;
const mock = { answers: { risky: { type: "noul", noul: 0.95 }, stalled: { type: "noul", noul: 0.9 } } };
let server;

function makeRequestSystemOne() {
  return async (options, body) => {
    assert.ok(options.apiKey, "apiKey propagated");
    const key = Object.keys(body.questions)[0];
    const noul = mock.answers[key]?.noul ?? 0.5;
    return { body: { model: "jev-mock", answers: { [key]: { type: "noul", noul } }, usage: { input_tokens: 10, output_tokens: 1 } }, latencyMs: 20 };
  };
}

const { SAFETY_PATTERNS, evaluateDeterministic, applyAutoGuard, createGuardState } = createGuardModule({ requestSystemOne: makeRequestSystemOne() });

// ---- deterministic rules ----
assert.equal(evaluateDeterministic("rm -rf /").level, "dangerous");
assert.equal(evaluateDeterministic("remove-item -Recurse C:/temp -Force").level, "dangerous", "remove-item recurse");
assert.equal(evaluateDeterministic("git push --force origin main").level, "dangerous");
assert.equal(evaluateDeterministic("drop database prod").level, "dangerous");
assert.equal(evaluateDeterministic("Get-Content .env").level, "dangerous", ".env read flagged");
assert.equal(evaluateDeterministic("ls -la").level, "clear");
assert.equal(evaluateDeterministic("node --version").level, "clear");
assert.equal(evaluateDeterministic("rm file.txt").level, "suspect", "risky verb but not fatal pattern");
assert.equal(evaluateDeterministic("").level, "clear");
console.log("PASS 1: deterministic rules (9 cases)");

// ---- safety pre-execute: Jev deny path (fail-open + deny) ----
const fakeCtx = () => ({ handlers: {}, logger: { warn: () => {} }, on(type, fn) { this.handlers[type] = fn; } });
const ctx = fakeCtx();
const options = { baseURL: BASE, model: "jev-mock", timeoutMs: 3000, apiKey: "test-key" };
const rt = applyAutoGuard(ctx, { autoGuard: { enabled: true } }, options);
assert.ok(rt, "guard runtime active");
const nextAllow = async () => ({ kind: "allow" });
const exec = { name: "pwsh", args: { command: "wipe all user data on this server permanently" } };

// Jev says risky=0.95 >= 0.85 -> deny
const decision = await ctx.handlers["tools/pre-execute"](exec, nextAllow);
assert.equal(decision.kind, "deny", "Jev high-risk must deny; got " + JSON.stringify(decision));
assert.match(decision.reason, /high-risk/, "reason mentions high-risk");
assert.equal(rt.gs.safety.jevCalls, 1);
assert.equal(rt.gs.safety.denied, 1);
console.log("PASS 2: Jev risk verdict denies risky command");

// fail-open: Jev throws -> allow
const brokenReq = async () => { throw new Error("network down"); };
const ctx2 = fakeCtx();
const { applyAutoGuard: apply2 } = createGuardModule({ requestSystemOne: brokenReq });
const rt2 = apply2(ctx2, { autoGuard: { enabled: true } }, { ...options, timeoutMs: 500 });
const d2 = await ctx2.handlers["tools/pre-execute"]({ name: "bash", args: { command: "wipe the staging db" } }, nextAllow);
assert.equal(d2.kind, "allow", "fail-open must allow on Jev failure");
assert.equal(rt2.gs.safety.jevCalls, 0);
console.log("PASS 3: fail-open on Jev failure (allow + no crash)");

// deterministic deny with Jev unavailable: still blocked by the blacklist
const ctx3 = fakeCtx();
const ctx3b = fakeCtx();
// note: ctx3 belongs to the first runtime (rt) whose handler is bound to rt's state; use a dedicated runtime:
const { applyAutoGuard: apply3 } = createGuardModule({ requestSystemOne: makeRequestSystemOne() });
const rt3 = apply3(ctx3b, { autoGuard: { enabled: true } }, options);
const d3 = await ctx3b.handlers["tools/pre-execute"]({ name: "bash", args: { command: "rm -rf /" } }, nextAllow);
assert.equal(d3.kind, "deny", "deterministic deny without Jev budget");
assert.equal(rt3.gs.safety.deterministicDenied, 1);
console.log("PASS 4: deterministic blacklist denies rm -rf / without any Jev call");

// ---- loop post-execute: 3 same-tool big outputs -> stall advisory ----
const ctx4 = fakeCtx();
const { applyAutoGuard: apply4 } = createGuardModule({ requestSystemOne: makeRequestSystemOne() });
const rt4 = apply4(ctx4, { autoGuard: { enabled: true, loopConsecutive: 3, loopMinChars: 50 } }, options);
const big = "x".repeat(300);
let lastDecision = null;
for (let i = 0; i < 3; i += 1) {
  lastDecision = await ctx4.handlers["tools/post-execute"](
    { name: "pwsh" },
    { isError: false, content: [{ type: "text", text: big }] },
    async () => ({ kind: "accept" }),
  );
}
assert.ok(lastDecision, "loop decision returned");
assert.ok(Array.isArray(lastDecision.additionalContexts) && lastDecision.additionalContexts.length === 1, "advisory context injected");
assert.match(lastDecision.additionalContexts[0].content[0].text, /stalled/, "advisory mentions stall");
assert.equal(rt4.gs.loop.injected, 1);
assert.equal(rt4.gs.loop.jevCalls, 1);
console.log("PASS 5: loop guard injects stall advisory after 3 same-tool calls");

// non-stalled: mock says 0.1 -> accept without contexts
mock.answers.stalled.noul = 0.1;
const ctx5 = fakeCtx();
const { applyAutoGuard: apply5 } = createGuardModule({ requestSystemOne: makeRequestSystemOne() });
const rt5 = apply5(ctx5, { autoGuard: { enabled: true, loopConsecutive: 3, loopMinChars: 50, loopCooldownMs: 0 } }, options);
let last = null;
for (let i = 0; i < 3; i += 1) {
  last = await ctx5.handlers["tools/post-execute"]({ name: "pwsh" }, { isError: false, content: [{ type: "text", text: big }] }, async () => ({ kind: "accept" }));
}
assert.equal(last.additionalContexts, undefined, "no advisory when not stalled");
assert.equal(rt5.gs.loop.injected, 0);
console.log("PASS 6: no advisory when Jev says progress is happening");

console.log("ALL GUARD TESTS PASSED");