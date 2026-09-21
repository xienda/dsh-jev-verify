/**
 * Functional tests for the plugin's HTTP + grading logic using a LOCAL mock
 * TypeSafe server (no real credentials needed). Proves:
 *  - request construction (auth header, JSON body, endpoint path)
 *  - response mapping + latency measurement
 *  - 401/error mapping with readable messages
 *  - timeout handling
 *  - verification grading (accuracy, mislabels)
 */
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { verifyAgainstLiveApi } from "../lib/index.js";
import { VERIFY_CASES } from "../lib/cases.js";

const PORT = 38741;
const BASE = `http://127.0.0.1:${PORT}/v1`;
let mode = "all-correct";
const received = [];

/** Guess the expected answer for a question of a case (mirrors lib judge). */
function expectedAnswer(testCase, key) {
  return testCase.questions.find((x) => x.key === key)?.expected;
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    received.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    if (req.method === "POST" && req.url === "/v1/systemone") {
      if (mode === "http401") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "invalid api key" } }));
        return;
      }
      if (mode === "unprocessable") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("NOT JSON {{{");
        return;
      }
      if (mode === "timeout") {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
        }, 2000);
        return;
      }
      const testCase = VERIFY_CASES.find((c) => c.state === body.state);
      const answers = {};
      let wrongCount = 0;
      for (const [key, q] of Object.entries(body.questions)) {
        const expected = testCase ? expectedAnswer(testCase, key) : void 0;
        if (mode === "flip-noul" && q.type === "noul") wrongCount += 1;
        const flip = mode === "flip-noul" && q.type === "noul";
        if (q.type === "noul") {
          const val = flip ? (expected === true ? 0.1 : 0.9) : (expected === true ? 0.95 : 0.05);
          answers[key] = { type: "noul", noul: val };
        } else if (q.type === "choice") {
          answers[key] = { type: "choice", choice: expected, confidence: 0.9, probabilities: { [expected]: 0.9 } };
        } else {
          answers[key] = { type: "score", score: expected, confidence: 0.99, probabilities: { [expected]: 0.99 }, legend: [] };
        }
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ model: "jev-mock", answers, usage: { input_tokens: 94, output_tokens: 3 } }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
});

await new Promise((resolve) => server.listen(PORT, resolve));
const key = { apiKey: "test-key-123" };
const baseOptions = { baseURL: BASE, model: "jev-mock", timeoutMs: 2000 };

try {
  // 1. perfect mock: 100% accuracy
  mode = "all-correct";
  const ok = await verifyAgainstLiveApi({ ...baseOptions, ...key });
  assert.equal(ok.accuracy, 1, "expected 100% accuracy, got " + ok.accuracy);
  assert.equal(ok.questionCount, 25, "expected 25 questions");
  assert.ok(ok.std.medianMs > 0, "latency measured");
  assert.ok(ok.cost.totalInputTokens > 0, "tokens recorded");
  assert.equal(ok.mislabeled.length, 0, "no mislabels on perfect mock");
  assert.equal(ok.highConfidenceAccuracy, 1, "calibration 1.0 when everything high-conf correct");
  assert.equal(received[0].auth, "Bearer test-key-123", "auth header");
  assert.equal(received[0].url, "/v1/systemone", "path");
  assert.ok(received[0].body.state && received[0].body.questions, "body shape");
  assert.equal(Object.keys(received[0].body.questions).length, 1, "one question per case call (25 calls)");
  console.log("PASS 1: perfect mock -> accuracy=1.0, 25/25 graded, latency+tokens measured, auth/body correct");

  // 2. flipped noul answers: accuracy must drop, mislabels reported
  mode = "flip-noul";
  const bad = await verifyAgainstLiveApi({ ...baseOptions, ...key });
  const expectedWrong = 10; // 10 noul questions flipped
  const expectedAccuracy = (25 - expectedWrong) / 25;
  assert.ok(Math.abs(bad.accuracy - expectedAccuracy) < 1e-9, "accuracy should be " + expectedAccuracy + ", got " + bad.accuracy);
  assert.equal(bad.mislabeled.length, expectedWrong, "10 mislabeled reported");
  assert.ok(bad.mislabeled.every((m) => m.ok === false), "mislabels flagged ok=false");
  console.log("PASS 2: flipped answers -> accuracy drops to " + bad.accuracy.toFixed(2) + ", 10 mislabels listed");

  // 3. 401 mapping
  mode = "http401";
  let err = null;
  try { await verifyAgainstLiveApi({ ...baseOptions, ...key }); } catch (e) { err = e; }
  assert.ok(err, "401 must throw");
  assert.match(err.message, /invalid api key/, "API detail surfaces; got: " + err.message);
  assert.match(err.message, /HTTP 401/, "status in message");
  console.log("PASS 3: HTTP 401 surfaces API detail + status");

  // 4. unprocessable body
  mode = "unprocessable";
  err = null;
  try { await verifyAgainstLiveApi({ ...baseOptions, ...key }); } catch (e) { err = e; }
  assert.ok(err, "bad body must throw");
  assert.match(err.message, /unprocessable/, "unprocessable message");
  console.log("PASS 4: unprocessable body -> clear error");

  // 5. timeout
  mode = "timeout";
  err = null;
  try { await verifyAgainstLiveApi({ ...baseOptions, ...key, timeoutMs: 300 }); } catch (e) { err = e; }
  assert.ok(err, "timeout must throw");
  assert.match(err.message, /timed out/, "timeout message; got: " + err.message);
  console.log("PASS 5: timeout -> clear error");

  // 6. no key -> null (honest not-verified)
  mode = "all-correct";
  const noKey = await verifyAgainstLiveApi({ ...baseOptions });
  assert.equal(noKey, null, "no key -> null report");
  console.log("PASS 6: missing key -> null (honest 'not verified' path)");

  console.log("ALL FUNCTIONAL TESTS PASSED");
} finally {
  server.close();
}