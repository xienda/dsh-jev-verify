/**
 * Batch tests (0.8.5): the high-level "judge + organize" tool. Proves that one
 * call really issues one request per item (never a fabricated row), that the
 * table is paste-ready, that sorting is by a real numeric answer, that a failed
 * item is reported as failed instead of guessed, and that the argument
 * validation refuses nonsensical batches before spending any call.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createBatchModule } from "../lib/batch.js";

const PRICE = 42; // USD per million input tokens

function makeStub(opts = {}) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  async function requestSystemOne(options, body, signal) {
    calls.push({ options, body });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs ?? 5));
      if (typeof opts.fail === "function" && opts.fail(body.state)) {
        throw new Error("jev_batch API error: HTTP 500: boom");
      }
      const answers = {};
      const score = Number((String(body.state).match(/SCORE=(\d)/) ?? [])[1] ?? 0);
      for (const [name, q] of Object.entries(body.questions ?? {})) {
        if (q.type === "noul") answers[name] = { type: "noul", noul: String(body.state).includes("YES") ? 0.9 : 0.1 };
        else if (q.type === "score") answers[name] = { type: "score", score, confidence: 0.88, legend: { 0: "a", 1: "b", 2: "c", 3: "d", 4: "e" } };
        else answers[name] = { type: "choice", choice: Object.keys(q.criteria)[0], confidence: 0.7, probabilities: {} };
      }
      return { body: { model: "jev-stub", answers, usage: { input_tokens: 100, output_tokens: 10 } }, latencyMs: 7 };
    } finally {
      inFlight -= 1;
    }
  }
  return { requestSystemOne, calls, maxInFlight: () => maxInFlight };
}

const CTX = { model: "jev-latest", baseURL: "https://api.typesafe.ai/v1", timeoutMs: 5000, toolName: "jev_batch" };
const N1 = [{ name: "is_spam", type: "noul", instructions: "The text is spam" }];

test("jev_batch: one real call per item, measured token cost, paste-ready table", async () => {
  const stub = makeStub();
  const mod = createBatchModule({ requestSystemOne: stub.requestSystemOne, inputPriceUsdPerMTok: PRICE });
  const value = await mod.runBatch({ items: ["a YES", "b", "c"] , questions: N1 }, CTX);
  assert.equal(stub.calls.length, 3, "three items must mean three real calls");
  assert.equal(stub.calls[0].body.state, "a YES", "the item IS the state");
  assert.equal(stub.calls[0].options.toolName, "jev_batch", "errors must name the tool");
  assert.equal(value.rows.length, 3);
  assert.equal(value.failed, 0);
  assert.equal(value.questionCount, 1);
  assert.equal(value.inputTokens, 300);
  assert.equal(value.outputTokens, 30);
  assert.equal(value.estimatedCostUs, (300 * PRICE) / 1e6);
  assert.equal(value.rows[0].answers.is_spam.value, 0.9);
  assert.equal(value.rows[1].answers.is_spam.value, 0.1);
  assert.equal(value.rows[0].answers.is_spam.confidence, null, "noul carries the probability, not a confidence");
  assert.equal(value.endpoint, "https://api.typesafe.ai/v1/systemone");
  const text = mod.formatBatch(value);
  assert.match(text, /^jev_batch \| model=jev-latest \| 3 条 x 1 问 \| \d+ ms \| est\. cost \$0\.0126/, "header carries model, shape, ms and cost");
  assert.match(text, /\| # \| 文本 \| is_spam \(noul\) \| ms \|/);
  assert.match(text, /\| 0 \| a YES \| 90% \| 7 \|/);
  assert.match(text, /\| 1 \| b \| 10% \| 7 \|/);
  assert.match(text, /usage: 300 input tokens, 30 output tokens（每行一次真实调用，共 3 次）/);
});

test("jev_batch: score rows sort desc by default and asc on request", async () => {
  const stub = makeStub();
  const mod = createBatchModule({ requestSystemOne: stub.requestSystemOne, inputPriceUsdPerMTok: PRICE });
  const questions = [{ name: "quality", type: "score", instructions: "How good", criteria: ["a", "b", "c", "d", "e"] }];
  const items = ["x SCORE=1", "y SCORE=3", "z SCORE=2"];
  const desc = await mod.runBatch({ items, questions }, CTX);
  assert.equal(desc.sortedBy, "quality", "a single score question sorts on auto");
  assert.equal(desc.sortDirection, "desc");
  assert.deepEqual(desc.rows.map((r) => r.index), [1, 2, 0]);
  assert.match(mod.formatBatch(desc), /排序：按 quality 降序/);
  assert.match(mod.formatBatch(desc), /\| 2 \| z SCORE=2 \| 2\/4 \(88%\) \|/);
  const asc = await mod.runBatch({ items, questions, sort: "asc" }, CTX);
  assert.deepEqual(asc.rows.map((r) => r.index), [0, 2, 1]);
  assert.equal(asc.sortDirection, "asc");
  const none = await mod.runBatch({ items, questions, sort: "none" }, CTX);
  assert.equal(none.sortedBy, null);
  assert.deepEqual(none.rows.map((r) => r.index), [0, 1, 2]);
});

test("jev_batch: a failed item is reported as failed, never guessed", async () => {
  const stub = makeStub({ fail: (state) => state.includes("BOOM") });
  const mod = createBatchModule({ requestSystemOne: stub.requestSystemOne, inputPriceUsdPerMTok: PRICE });
  const value = await mod.runBatch({ items: ["ok YES", "BOOM", "also ok"], questions: N1 }, CTX);
  assert.equal(value.failed, 1);
  assert.equal(value.rows[1].error !== null, true);
  assert.match(String(value.rows[1].error), /HTTP 500/);
  assert.equal(value.rows[1].answers, null, "a failed row carries no answers");
  const text = mod.formatBatch(value);
  assert.match(text, /1 条失败/);
  assert.match(text, /失败 #1 BOOM/);
  assert.equal(value.inputTokens, 200, "only the two successful calls are counted");
});

test("jev_batch: when every item fails the tool throws instead of returning an empty table", async () => {
  const stub = makeStub({ fail: () => true });
  const mod = createBatchModule({ requestSystemOne: stub.requestSystemOne, inputPriceUsdPerMTok: PRICE });
  await assert.rejects(() => mod.runBatch({ items: ["a", "b"], preset: "spam" }, CTX), /HTTP 500/);
});

test("jev_batch: presets expand to real questions and share one context", async () => {
  const stub = makeStub();
  const mod = createBatchModule({ requestSystemOne: stub.requestSystemOne, inputPriceUsdPerMTok: PRICE });
  assert.deepEqual(mod.presetNames().sort(), ["intent", "pii", "priority", "sentiment", "spam"]);
  const pii = await mod.runBatch({ items: ["call me on 138"], preset: "pii", context: "以下是客服工单" }, CTX);
  assert.equal(pii.preset, "pii");
  assert.equal(pii.questionCount, 2);
  assert.deepEqual(Object.keys(stub.calls[0].body.questions), ["has_personal_data", "has_secret"]);
  assert.match(stub.calls[0].body.state, /^以下是客服工单\n\nItem:\ncall me on 138$/);
  const text = mod.formatBatch(pii);
  assert.match(text, /has_personal_data \(noul\)/);
  assert.match(text, /has_secret \(noul\)/);
  const intent = await mod.runBatch({ items: ["how do I reset it?"], preset: "intent" }, CTX);
  const shown = mod.batchPresentation(intent);
  assert.equal(shown.kind, "batch");
  assert.deepEqual(shown.columns, [{ name: "intent", type: "choice" }]);
  assert.equal(shown.rows[0].cells[0].startsWith("question (70%)"), true);
});

test("jev_batch: argument validation spends no call", async () => {
  const stub = makeStub();
  const mod = createBatchModule({ requestSystemOne: stub.requestSystemOne, inputPriceUsdPerMTok: PRICE });
  const bad = [
    [{ items: [], questions: N1 }, /items must be a non-empty array/],
    [{ items: ["a", "  "], questions: N1 }, /item 1 is empty/],
    [{ items: ["a"], questions: N1, preset: "spam" }, /either questions or preset/],
    [{ items: ["a"] }, /pass questions .* or preset/],
    [{ items: ["a"], preset: "nope" }, /unknown preset "nope"/],
    [{ items: ["a"], preset: "spam", sortBy: "bogus" }, /is not one of the questions/],
    [{ items: ["a"], questions: [{ name: "1bad", type: "noul", instructions: "x" }] }, /must match/],
    [{ items: ["a"], questions: [{ name: "q", type: "score", instructions: "x", criteria: ["only-one"] }] }, /needs an array criteria/],
    [{ items: ["a"], questions: [{ name: "q", type: "choice", instructions: "x", criteria: { one: "y" } }] }, /criteria with >=2 options/],
    [{ items: ["a"], questions: new Array(6).fill(null).map((_v, i) => ({ name: "q" + i, type: "noul", instructions: "x" })) }, /at most 5 questions/],
    [{ items: new Array(21).fill("x"), questions: N1 }, /at most 20 items/],
  ];
  for (const [args, pattern] of bad) {
    await assert.rejects(() => mod.runBatch(args, CTX), pattern, "expected " + pattern);
  }
  assert.equal(stub.calls.length, 0, "no invalid batch may spend a call");
});

test("jev_batch: concurrency is bounded and every item still runs", async () => {
  const stub = makeStub({ delayMs: 8 });
  const mod = createBatchModule({ requestSystemOne: stub.requestSystemOne, inputPriceUsdPerMTok: PRICE });
  const items = new Array(12).fill(0).map((_v, i) => "item " + i + (i % 2 === 0 ? " YES" : ""));
  const value = await mod.runBatch({ items, questions: N1, concurrency: 3 }, CTX);
  assert.equal(stub.calls.length, 12);
  assert.equal(value.rows.length, 12);
  assert.equal(value.failed, 0);
  assert.ok(stub.maxInFlight() <= 3, "never more than the requested concurrency (saw " + stub.maxInFlight() + ")");
  assert.ok(stub.maxInFlight() > 1, "a batch of 12 must actually run in parallel");
  const huge = await mod.runBatch({ items: ["a"], questions: N1, concurrency: 99 }, CTX);
  assert.equal(huge.itemCount, 1);
});
