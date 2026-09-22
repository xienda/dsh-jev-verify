/**
 * Dashboard tests: route registration, HTML page, JSON API, playground POST
 * and ledger recording — all against a fake webServer + mock Jev client.
 */
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { createDashboardModule } from "../lib/dashboard.js";

function fakeReq(method, body) {
  const req = new EventEmitter();
  req.method = method;
  req.url = "/";
  setImmediate(() => {
    if (body !== undefined) {
      req.emit("data", Buffer.from(body));
      req.emit("end");
    } else {
      req.emit("end");
    }
  });
  return req;
}
function fakeRes() {
  return {
    status: null, headers: null, body: "",
    writeHead(s, h) { this.status = s; this.headers = h; },
    end(b) { this.body = String(b); },
  };
}

let calls = 0;
const mockRso = async (options, body, _signal) => {
  calls += 1;
  assert.ok(options.apiKey, "apiKey propagated");
  const answers = {};
  for (const [k, q] of Object.entries(body.questions ?? {})) {
    answers[k] = q.type === "noul" ? { type: "noul", noul: 0.98 } : { type: "choice", choice: "billing", confidence: 0.9 };
  }
  return { body: { model: "jev-mock", answers, usage: { input_tokens: 100, output_tokens: 3 } }, latencyMs: 42 };
};

const routes = [];
const fakeHost = { webServer: { register: (r) => routes.push(r) } };
const mod = createDashboardModule({ requestSystemOne: mockRso });
mod.registerRoutes(fakeHost, { dashboard: { enabled: true } }, () => ({
  model: "jev-mock", baseURL: "https://api.typesafe.ai/v1", apiKey: "k", resolveApiKey: async () => "k",
}), () => ({ guardActive: true, denyThreshold: 0.8, budgetRemaining: 9 }));

assert.equal(routes.length, 3, "three routes registered");
const [page, api, tryRoute] = routes;
assert.equal(page.path, "/jev");
assert.equal(api.path, "/jev/api");
assert.equal(tryRoute.path, "/jev/api/try");

// GET page
const pr = fakeRes();
await page.handler({ method: "GET" }, pr);
assert.equal(pr.status, 200);
assert.match(pr.body, /Jev/, "page contains title");
assert.match(pr.body, /决策仪表盘/, "page in zh");
assert.ok(pr.headers["content-type"].includes("text/html"), "html content type");
console.log("PASS 1: /jev HTML page");

// GET api before records
const ar = fakeRes();
await api.handler({ method: "GET" }, ar);
const snap0 = JSON.parse(ar.body);
assert.equal(snap0.status.model, "jev-mock");
assert.equal(snap0.status.keyConfigured, true);
assert.equal(snap0.status.guardActive, true);
assert.equal(snap0.summary.calls, 0);
console.log("PASS 2: /jev/api snapshot");

// record + summary
mod.record({ kind: "decision", ts: new Date().toISOString(), source: "agent", stateHead: "hi", questions: [{ name: "is_urgent", type: "noul", value: 0.98, confidence: 0.9 }], latencyMs: 40, costUs: 0.0000042, inputTokens: 100 });
const ar2 = fakeRes();
await api.handler({ method: "GET" }, ar2);
const snap1 = JSON.parse(ar2.body);
assert.equal(snap1.summary.calls, 1);
assert.equal(snap1.roll.length, 1);
assert.equal(snap1.latencySeries[0], 40);
console.log("PASS 3: ledger recorded into /jev/api summary and roll");

// POST try (playground)
const tr = fakeRes();
await tryRoute.handler(
  fakeReq("POST", JSON.stringify({ state: "I was double charged", questions: [{ name: "dept", type: "choice", instructions: "Which team", criteria: { billing: "x", sales: "y" } }] })),
  tr,
);
const tryout = JSON.parse(tr.body);
assert.equal(tr.status, 200);
assert.equal(tryout.model, "jev-mock");
assert.equal(tryout.latencyMs, 42);
assert.equal(tryout.answers.dept.choice, "billing");
assert.equal(calls, 1, "requestSystemOne invoked once");
const ar3 = fakeRes();
await api.handler({ method: "GET" }, ar3);
assert.equal(JSON.parse(ar3.body).summary.calls, 2, "playground call recorded");
console.log("PASS 4: POST /jev/api/try evaluates and records");

// POST bad body
const br = fakeRes();
await tryRoute.handler(fakeReq("POST", "not json"), br);
assert.equal(br.status, 400);
const br2 = fakeRes();
await tryRoute.handler(fakeReq("POST", JSON.stringify({ state: "", questions: [] })), br2);
assert.equal(br2.status, 400);
console.log("PASS 5: invalid playground requests -> 400 with clear error");

// disabled dashboard registers nothing
const routes2 = [];
mod.registerRoutes({ webServer: { register: (r) => routes2.push(r) } }, { dashboard: { enabled: false } }, () => ({}), () => ({}));
assert.equal(routes2.length, 0, "disabled dashboard adds no routes");
console.log("PASS 6: dashboard can be disabled via config");

console.log("ALL DASHBOARD TESTS PASSED");