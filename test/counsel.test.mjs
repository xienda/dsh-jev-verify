/**
 * counsel.test.mjs — jev_choose (lib/counsel.js) unit tests over a mock
 * requestSystemOne that mimics the real API envelope ({ body, latencyMs }).
 * Covers ranking math, the high-fit/high-risk trap, validation errors,
 * parallelism, the null-recommendation fallback, and the formatted output.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCounselModule } from "../lib/counsel.js";

function makeMock({ responses, record }) {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  async function requestSystemOne(callOptions, body, signal) {
    calls.push(body);
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      const resp = typeof responses === "function"
        ? await responses(body)
        : delay(25).then(() => ({ model: body.model, answers: {}, usage: { input_tokens: 100, output_tokens: 10 } }));
      return { body: resp, latencyMs: 25 };
    } finally {
      active -= 1;
    }
  }
  return {
    requestSystemOne,
    stats: () => ({ calls, maxActive }),
  };
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function rankResponse(fitScore, fitConf, riskNoul) {
  return {
    answers: {
      fit: { type: "score", score: fitScore, confidence: fitConf, legend: { "0": "poor", "3": "excellent" } },
      risk: { type: "noul", noul: riskNoul },
    },
    usage: { input_tokens: 120, output_tokens: 8 },
  };
}

test("rankOptions: recommended picks the highest composite with the trap option down-weighted", async () => {
  const m = makeMock({
    responses: (body) => {
      const text = String(body.state);
      if (text.includes("方案甲")) return rankResponse(2, 0.8, 0.15);   // comp = 0.567
      if (text.includes("方案乙")) return rankResponse(3, 0.9, 0.9);    // trap: high fit, high risk -> 0.1
      return rankResponse(1, 0.6, 0.15);                                // comp = 0.283
    },
  });
  const counsel = createCounselModule({ requestSystemOne: m.requestSystemOne });
  const value = await counsel.rankOptions(
    { options: ["方案甲：直接实现", "方案乙：激进重写", "方案丙：渐进迁移"], context: "当前目标" },
    { model: "jev-1.13.0", inputPriceUsdPerMTok: 0.042 }
  );
  assert.equal(value.optionCount, 3);
  assert.equal(value.recommended, 0, "甲 wins: 0.567 > 0.283 > 0.1");
  const byIndex = Object.fromEntries(value.ranking.map((r) => [r.index, r]));
  assert.equal(byIndex[1].composite, 0.1, "trap option composite = (3/3)*(1-0.9)");
  assert.equal(byIndex[0].composite, 0.567);
  assert.equal(byIndex[2].composite, 0.283);
  assert.equal(value.inputTokens, 360);
  assert.ok(Math.abs(value.estimatedCostUs - (360 * 0.042) / 1e6) < 1e-12);
  assert.equal(value.endpoint, "https://api.typesafe.ai/v1/systemone");
  assert.equal(value.model, "jev-1.13.0");
});

test("rankOptions: per-option API calls run in parallel", async () => {
  const m = makeMock({ responses: () => delay(40).then(() => rankResponse(2, 0.8, 0.2)) });
  const counsel = createCounselModule({ requestSystemOne: m.requestSystemOne });
  const t0 = performance.now();
  await counsel.rankOptions({ options: ["A", "B", "C", "D"] }, {});
  const elapsed = performance.now() - t0;
  assert.equal(m.stats().calls.length, 4);
  assert.equal(m.stats().maxActive, 4, "all four requests must overlap (Promise.all)");
  assert.ok(elapsed < 120, "elapsed " + Math.round(elapsed) + "ms must stay near one 40ms round-trip");
});

test("rankOptions: validation rejects 1 or 11 options, empties and over-long texts", async () => {
  const m = makeMock({});
  const counsel = createCounselModule({ requestSystemOne: m.requestSystemOne });
  await assert.rejects(() => counsel.rankOptions({ options: ["only"] }, {}), /2..10/);
  await assert.rejects(() => counsel.rankOptions({ options: Array.from({ length: 11 }, (_, i) => "o" + i) }, {}), /2..10/);
  await assert.rejects(() => counsel.rankOptions({ options: ["  ", "B"] }, {}), /option 0 is empty/);
  await assert.rejects(() => counsel.rankOptions({ options: ["x".repeat(801), "B"] }, {}), /exceeds 800 chars/);
  await assert.rejects(() => counsel.rankOptions({ options: "not-an-array" }, {}), /2..10/);
});

test("rankOptions: context is clipped to 2000 chars", async () => {
  const m = makeMock({ responses: (body) => rankResponse(2, 0.8, 0.2).answers ? rankResponse(2, 0.8, 0.2) : rankResponse(2, 0.8, 0.2) });
  const counsel = createCounselModule({ requestSystemOne: m.requestSystemOne });
  await counsel.rankOptions({ options: ["A", "B"], context: "x".repeat(5000) }, {});
  const state = String(m.stats().calls[0].state);
  assert.ok(state.length <= 2000 + "\n\nCandidate option:\n".length + 80, "context clipped");
});

test("rankOptions: missing fit scores degrade to no recommendation instead of a fake pick", async () => {
  // 诚实路径 1：fit 缺失但 Jev 仍给了 risk → 显示真实风险，综合不给分
  const m = makeMock({ responses: () => ({ answers: { risk: { type: "noul", noul: 0.5 } }, usage: {} }) });
  const counsel = createCounselModule({ requestSystemOne: m.requestSystemOne });
  const value = await counsel.rankOptions({ options: ["A", "B"] }, {});
  assert.equal(value.recommended, null);
  const rendered = counsel.formatChoose(value);
  assert.match(rendered, /推荐：无（Jev 未能给出有效打分/);
  assert.match(rendered, /风险 50%/);
  assert.match(rendered, /综合 —/);
  // 诚实路径 2：fit 与 risk 均缺失 → 风险也不伪装默认值，显示 —
  const m2 = makeMock({ responses: () => ({ answers: {}, usage: {} }) });
  const counsel2 = createCounselModule({ requestSystemOne: m2.requestSystemOne });
  const value2 = await counsel2.rankOptions({ options: ["A", "B"] }, {});
  assert.equal(value2.recommended, null);
  const rendered2 = counsel2.formatChoose(value2);
  assert.match(rendered2, /风险 —/);
});

test("formatChoose: marks the recommended option and keeps the honesty footnote", async () => {
  const m = makeMock({ responses: () => rankResponse(2, 0.8, 0.2) });
  const counsel = createCounselModule({ requestSystemOne: m.requestSystemOne });
  const value = await counsel.rankOptions(
    { options: ["方案甲：直接实现", "方案乙：过度设计"], context: "" },
    { model: "jev-1.13.0", inputPriceUsdPerMTok: 0.042 }
  );
  const lines = counsel.formatChoose(value).split("\n");
  assert.ok(lines[0].startsWith("jev_choose | model="), "header line");
  assert.ok(lines.some((l) => l.includes("[推荐]") && l.includes("#" + value.recommended)), "recommendation marker");
  assert.ok(lines.some((l) => l.includes("综合") && l.includes("置信")), "composite and confidence shown");
  assert.ok(lines.some((l) => l.startsWith("> Jev 只做特征打分")), "honesty footnote present");
});

// for the null-fit fixture the mock above answers {} twice; also verify latencyMs is aggregated
test("rankOptions: aggregates latency and reports per-option times", async () => {
  const m = makeMock({ responses: () => delay(30).then(() => rankResponse(2, 0.8, 0.2)) });
  const counsel = createCounselModule({ requestSystemOne: m.requestSystemOne });
  const value = await counsel.rankOptions({ options: ["A", "B"] }, {});
  assert.ok(value.latencyMs >= 0);
  for (const r of value.ranking) assert.equal(typeof r.latencyMs, "number");
});
