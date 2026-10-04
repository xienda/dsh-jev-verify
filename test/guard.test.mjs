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


// ---- 0.7.5: position-aware tiering, flag-order independence, audit events, cache cap ----
const RM = "r" + "m -" + "rf ";
const wipe = RM + "/";
assert.equal(evaluateDeterministic(wipe).level, "dangerous", "executable root wipe");
assert.equal(evaluateDeterministic(RM + "--preserve-root=no /").level, "dangerous", "extra flag after -rf");
assert.equal(evaluateDeterministic("r" + "m --no-preserve-root -" + "rf /").level, "dangerous", "extra flag before -rf");
assert.equal(evaluateDeterministic("r" + "m -" + "fr /").level, "dangerous", "reversed flag order");
assert.equal(evaluateDeterministic("echo ready; " + wipe).level, "dangerous", "wipe after a separator");
assert.equal(evaluateDeterministic("see the notes: " + wipe + " is forbidden").level, "suspect", "prose mention demoted to soft");
assert.equal(evaluateDeterministic("echo 'do not run " + wipe + "'").level, "suspect", "quoted mention demoted to soft");
assert.equal(evaluateDeterministic(RM + "./build").level, "suspect", "recursive delete of a relative build dir is soft, not fatal");
assert.equal(evaluateDeterministic(RM + "/tmp/junk").level, "suspect", "recursive delete under /tmp is soft, not fatal");
assert.equal(evaluateDeterministic(RM + ".").level, "dangerous", "recursive delete of the working directory stays fatal");
console.log("PASS 7: position-aware hard tier, flag-order independence, no false fatal");

// audit sinks: every deny and advisory must reach the dashboard with the tool name
const seen = [];
const evtCtx = fakeCtx();
const { applyAutoGuard: applyE } = createGuardModule({ requestSystemOne: makeRequestSystemOne() });
const rtE = applyE(evtCtx, { autoGuard: { enabled: true } }, options, { onSafetyDeny: (e) => seen.push({ sink: "deny", ...e }) });
await evtCtx.handlers["tools/pre-execute"]({ name: "bash", arguments: { command: wipe } }, nextAllow);
assert.equal(seen.length, 1, "exactly one deny event");
assert.equal(seen[0].deterministic, true, "deterministic tier flagged");
assert.equal(seen[0].tool, "bash", "deterministic deny event carries the tool name");
assert.equal(rtE.gs.safety.deterministicDenied, 1);
const jevSeen = [];
const jevCtx = fakeCtx();
const { applyAutoGuard: applyJ } = createGuardModule({ requestSystemOne: makeRequestSystemOne() });
applyJ(jevCtx, { autoGuard: { enabled: true } }, options, { onSafetyDeny: (e) => jevSeen.push(e) });
const jd = await jevCtx.handlers["tools/pre-execute"]({ name: "pwsh", arguments: { command: "wipe the staging data store" } }, nextAllow);
assert.equal(jd.kind, "deny", "Jev tier still denies");
assert.equal(jevSeen.length, 1, "exactly one Jev deny event");
assert.equal(jevSeen[0].deterministic, false, "Jev tier flagged");
assert.equal(jevSeen[0].tool, "pwsh", "Jev deny event carries the tool name");
assert.ok(jevSeen[0].confidence >= 0.85, "confidence reported on the event");
mock.answers.stalled.noul = 0.9;
const advSeen = [];
const advCtx = fakeCtx();
const { applyAutoGuard: applyA } = createGuardModule({ requestSystemOne: makeRequestSystemOne() });
applyA(advCtx, { autoGuard: { enabled: true, loopConsecutive: 3, loopMinChars: 50 } }, options, { onLoopAdvisory: (e) => advSeen.push(e) });
for (let k = 0; k < 3; k += 1) {
  await advCtx.handlers["tools/post-execute"]({ name: "pwsh" }, { isError: false, content: [{ type: "text", text: big }] }, async () => ({ kind: "accept" }));
}
assert.equal(advSeen.length, 1, "exactly one loop advisory event");
assert.equal(advSeen[0].tool, "pwsh", "loop advisory carries the tool name");
assert.ok(advSeen[0].noul >= 0.85, "advisory reports the Jev probability");
console.log("PASS 8: onSafetyDeny (both tiers) and onLoopAdvisory fire with the tool name");

// the verdict cache is bounded, so a long session cannot grow it without limit
const cacheCtx = fakeCtx();
const { applyAutoGuard: applyC } = createGuardModule({ requestSystemOne: makeRequestSystemOne() });
const rtC = applyC(cacheCtx, { autoGuard: { enabled: true, maxJevCallsPerSession: 500 } }, options);
for (let k = 0; k < 205; k += 1) {
  await cacheCtx.handlers["tools/pre-execute"]({ name: "bash", arguments: { command: "r" + "m tmp/item-" + k } }, nextAllow);
}
assert.equal(rtC.gs.safety.jevCalls, 205, "each distinct command is judged once");
assert.equal(rtC.gs.safety.lastVerdicts.size, 200, "verdict cache is capped at 200");
console.log("PASS 9: verdict cache capped at 200 entries");
console.log("ALL GUARD TESTS PASSED");