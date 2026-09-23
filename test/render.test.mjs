/**
 * Answer-rendering test: readAnswer must decode the REAL wire shapes returned by
 * jev-latest (captured live, see fixture-decision.json), not an assumed one.
 * Verified live shapes:
 *   noul   -> { type:"noul", noul: 0.98 }        (no `confidence` field)
 *   choice -> { type:"choice", choice:"negative", confidence:1 }
 *   score  -> { type:"score", score:2.98, confidence:0.98, legend:{0..3} }
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const code = readFileSync(new URL("../client/client.js", import.meta.url), "utf8");
let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (rec) => { loaded = rec; } } };
const start = code.indexOf("factory: (require) => {") + "factory: (require) => {".length;
const end = code.lastIndexOf("return module.exports;");
const body = code.slice(start, end).replace(/^\s*/, "");
// Expose readAnswer for testing without changing the shipped surface.
const factory = new Function("require", body + "\nreturn module.exports;");
const bundle = factory((n) => (n === "react" ? {
  createElement: () => ({ __jsx: true }), useState: () => [undefined, () => {}],
  useEffect: () => {}, useSyncExternalStore: () => ({ value: {}, writable: true }),
} : {}));
const readAnswer = bundle.__internal && bundle.__internal.readAnswer;
assert.equal(typeof readAnswer, "function", "readAnswer reachable");

const fixture = JSON.parse(readFileSync(new URL("../fixture-decision.json", import.meta.url), "utf8"));
const answers = fixture.result.answers;

// noul: probability IS the confidence
const urgent = readAnswer(answers.is_urgent);
assert.equal(urgent.value, "yes", "noul 0.98 => yes");
assert.equal(urgent.confidence, 0.98, "noul confidence is the probability");

// choice
const sentiment = readAnswer(answers.sentiment);
assert.equal(sentiment.value, "negative");
assert.equal(sentiment.confidence, 1);

// score: the label must come from the probability distribution, not from
// rounding the raw score. Live data is score=2.98 with probabilities
// { "2": 0.02, "3": 0.98 }, so the decided level is 3/critical even though
// the fractional score alone is ambiguous.
const severity = readAnswer(answers.severity);
assert.ok(/critical/.test(severity.value), "score label follows the distribution peak, got " + severity.value);
assert.ok(/2\.98/.test(severity.value), "score still shows the numeric value");
assert.equal(severity.confidence, 0.98);

// A score whose distribution peaks lower must follow the distribution, not round up.
const skewed = readAnswer({ type: "score", score: 1.6, confidence: 0.7, legend: { 1: "minor", 2: "major" }, probabilities: { 1: 0.6, 2: 0.4 } });
assert.ok(/minor/.test(skewed.value), "distribution peak wins over rounding, got " + skewed.value);

// low-probability noul flips to "no"
assert.equal(readAnswer({ type: "noul", noul: 0.2 }).value, "no");
// unknown/missing shapes must not throw
assert.equal(readAnswer(null).value, "—");
assert.equal(readAnswer({}).value, "—");
console.log("PASS: readAnswer decodes real jev-latest noul/choice/score answers");
