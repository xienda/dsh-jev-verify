/**
 * Auto-triage tests (0.8.4): the pre-step router must be cheap, at most once
 * per (agent, turn), fail-open on every error, and it must never throw into the
 * agent loop. Runs offline against a fake requestSystemOne.
 */
import assert from "node:assert/strict";
import { createTriageModule } from "../lib/triage.js";

// ---- fakes ----------------------------------------------------------------
function fakeCtx() {
  const handlers = [];
  const warnings = [];
  return {
    handlers,
    warnings,
    logger: { warn: (m) => warnings.push(m), debug: () => {} },
    on(type, fn, opts) { handlers.push({ type, fn, opts }); },
  };
}

function fakeRequester(answers, failure) {
  const calls = [];
  const request = async (options, body, signal) => {
    calls.push({ options, body, signal });
    if (failure) throw new Error(failure);
    return { body: { answers, usage: { input_tokens: 1500, output_tokens: 20 } }, latencyMs: 123 };
  };
  return { request, calls };
}

const ANSWERS = {
  intent: { type: "choice", choice: "operate" },
  needs_judgment: { type: "noul", noul: 0.9 },
  judgment_kind: { type: "choice", choice: "rank" },
  recommended_tool: { type: "choice", choice: "jev_decision" },
};

const TEXT = "请把这段客服工单分类并给出优先级与严重度";
function decisionWith(text) {
  return { kind: "allow", messages: [{ role: "user", content: [{ type: "text", text }] }] };
}
const payload = () => ({ agent: {}, turn: 1, step: 1, signal: { aborted: false } });

function bind(answers, failure, config) {
  const ctx = fakeCtx();
  const requester = fakeRequester(answers, failure);
  const module = createTriageModule({ requestSystemOne: requester.request });
  // index.js always passes the flat autoTriage sub-config, never the wrapper.
  const events = [];
  const runtime = module.applyAutoTriage(ctx, config ?? { enabled: true, minChars: 12, timeoutMs: 3000 }, { model: "jev-latest", apiKey: "test-key" }, { onTriage: (e) => events.push(e) });
  const handler = ctx.handlers.find((h) => h.type === "agent/pre-step");
  return { ctx, requester, module, runtime, handler, events };
}

// ---- 1) pure helpers ------------------------------------------------------
{
  const ctx = fakeCtx();
  const { module } = bind(ANSWERS);
  const { TRIAGE_QUESTIONS: q, buildAdvice: mk, lastUserText: last } = module;
  assert.equal(Object.keys(q).length, 4, "four routing questions");
  assert.equal(Object.keys(q.intent.criteria).length, 7, "intent options");
  assert.equal(q.needs_judgment.type, "noul");
  assert.equal(q.recommended_tool.type, "choice");
  assert.equal(last([{ role: "assistant", content: [{ type: "text", text: "hi" }] }]), "", "assistant text is not the request");
  assert.equal(last([
    { role: "user", content: [{ type: "text", text: "第一个问题" }] },
    { role: "user", source: { kind: "plugin" }, content: [{ type: "text", text: "上一轮的建议" }] },
  ]), "第一个问题", "our own injected advice is never re-triaged");
  assert.equal(last([{ role: "user", content: "plain string content" }]), "plain string content");
  assert.equal(last(null), "");
  const advice = mk(TEXT, ANSWERS, 123);
  assert.match(advice, /\[Jev 自动预判 · 插件建议\]/);
  assert.match(advice, /本轮意图=operate/);
  assert.match(advice, /判定需求=90%/);
  assert.match(advice, /判定类型=rank/);
  assert.match(advice, /jev_decision（一次并行原子判定）/);
  assert.match(advice, /先调用 jev_decision/);
  assert.match(advice, /123 ms/);
  assert.match(mk(TEXT, { recommended_tool: { choice: "none" }, intent: { choice: "chat" } }, null), /没有必须由 Jev 完成的原子判定/);
  console.log("PASS 1: routing question shape and advice text");
}

// ---- 2) registers the pre-step waterfall, at most once per turn ------------
{
  const b = bind(ANSWERS);
  assert.equal(b.ctx.handlers.length, 1, "one handler");
  assert.equal(b.handler.type, "agent/pre-step");
  assert.deepEqual(b.handler.opts, { prepend: true }, "the advice precedes other pre-step work");
  const agent = {};
  const p2 = () => ({ agent, turn: 1, step: 1, signal: { aborted: false } });
  const first = await b.handler.fn(p2(), async () => decisionWith(TEXT));
  assert.equal(b.requester.calls.length, 1, "one metered call on the first step");
  assert.equal(first.messages.length, 2, "advice appended to the turn");
  const injected = first.messages[1];
  assert.equal(injected.source.kind, "plugin", "advice is plugin-sourced");
  assert.equal(injected.source.plugin, "dsh-jev-verify");
  assert.match(injected.content[0].text, /Jev 自动预判/);
  const again = decisionWith(TEXT);
  const same = await b.handler.fn(p2(), async () => again);
  assert.equal(b.requester.calls.length, 1, "same (agent, turn) is judged once");
  assert.equal(same, again, "a skipped step passes the decision through untouched");
  const other = await b.handler.fn({ agent, turn: 2, step: 1, signal: { aborted: false } }, async () => decisionWith(TEXT));
  assert.equal(b.requester.calls.length, 2, "a new turn is a new judgment");
  assert.equal(other.messages.length, 2);
  assert.equal(b.events.length, 2, "one ledger event per call, never two");
  assert.equal(b.events[1].tool, "jev_decision");
  assert.equal(b.events[1].latencyMs, 123);
  assert.deepEqual(b.events[1].usage, { input_tokens: 1500, output_tokens: 20 });
  assert.equal(b.events[1].injected, true);
  assert.equal(b.runtime.counters.calls, 2);
  assert.equal(b.runtime.counters.injected, 2);
  console.log("PASS 2: once per (agent, turn), advice injected, one ledger event per call");
}

// ---- 3) every skip path stays free and non-fatal --------------------------
{
  // step !== 1
  let b = bind(ANSWERS);
  const stale = { kind: "allow", messages: [] };
  assert.equal(await b.handler.fn(Object.assign(payload(), { step: 3 }), async () => stale), stale);
  assert.equal(b.requester.calls.length, 0, "later steps never call Jev");
  // rejected decision
  b = bind(ANSWERS);
  const rejected = { kind: "reject", reason: "nope" };
  assert.equal(await b.handler.fn(payload(), async () => rejected), rejected);
  assert.equal(b.requester.calls.length, 0, "a rejected step is not triaged");
  // aborted turn
  b = bind(ANSWERS);
  assert.ok(await b.handler.fn({ ...payload(), signal: { aborted: true } }, async () => decisionWith(TEXT)));
  assert.equal(b.requester.calls.length, 0, "an aborted turn is not triaged");
  // too short
  b = bind(ANSWERS);
  await b.handler.fn(payload(), async () => decisionWith("ok"));
  assert.equal(b.requester.calls.length, 0, "short requests are not worth a call");
  assert.equal(b.runtime.counters.skipped, 1);
  // hostile shapes
  b = bind(ANSWERS);
  assert.doesNotThrow(async () => { await b.handler.fn({}, async () => ({})); });
  await b.handler.fn({}, async () => ({ kind: "allow" }));
  assert.equal(b.requester.calls.length, 0, "no messages means no triage");
  console.log("PASS 3: step/reject/abort/short/hostile paths never call Jev and never throw");
}

// ---- 4) fail-open on API errors, missing key warned once ------------------
{
  let b = bind(ANSWERS, "TypeSafe requires a TypeSafe API key");
  const d = await b.handler.fn(payload(), async () => decisionWith(TEXT));
  assert.equal(d.messages.length, 1, "no advice on failure");
  assert.equal(b.runtime.counters.skipped, 1);
  await b.handler.fn(Object.assign(payload(), { turn: 2 }), async () => decisionWith(TEXT));
  assert.equal(b.ctx.warnings.length, 1, "a missing key is reported once, not per turn");
  assert.match(b.ctx.warnings[0], /TypeSafe API key/);
  b = bind(ANSWERS, "socket hang up");
  await b.handler.fn(payload(), async () => decisionWith(TEXT));
  assert.match(b.ctx.warnings[0], /fail-open/, "transport failures are logged as fail-open");
  assert.equal(b.events.length, 0, "a failed call is not metered");
  assert.equal(b.runtime.counters.calls, 0);
  console.log("PASS 4: API failures fail open, metered only on success");
}

// ---- 5) a "none" verdict is metered but not injected; the cap holds -------
{
  const noneAnswers = Object.assign({}, ANSWERS, { recommended_tool: { type: "choice", choice: "none" } });
  const b = bind(noneAnswers);
  const d = await b.handler.fn(payload(), async () => decisionWith(TEXT));
  assert.equal(b.requester.calls.length, 1, "the judgment is still a real metered call");
  assert.equal(d.messages.length, 1, "but no advice is injected");
  assert.equal(b.events.length, 1);
  assert.equal(b.events[0].tool, "none");
  assert.equal(b.events[0].injected, false);
  const capped = bind(ANSWERS, null, { enabled: true, minChars: 12, maxCallsPerSession: 1 });
  await capped.handler.fn(Object.assign(payload(), { turn: 1 }), async () => decisionWith(TEXT));
  await capped.handler.fn(Object.assign(payload(), { turn: 2 }), async () => decisionWith(TEXT));
  assert.equal(capped.requester.calls.length, 1, "maxCallsPerSession caps the router");
  const off = bind(ANSWERS, null, { enabled: false });
  assert.equal(off.runtime, null, "disabled means no handler at all");
  assert.equal(off.ctx.handlers.length, 0);
  console.log("PASS 5: 'none' is metered-not-injected, the session cap holds, disabled stays off");
}
console.log("ALL TRIAGE TESTS PASSED");
