/**
 * Dashboard tests: route registration, HTML page, JSON API, playground POST,
 * ledger recording and the 0.8.2 composer-pill route — all against a fake
 * webServer + mock Jev client.
 *
 * Regression history this file pins down:
 *   1. `dashboard.basePath: jev` (no leading slash) mounted the literal path
 *      "jev", so http://127.0.0.1:3080/jev answered with a browser 404.
 *   2. The web half was mounted only while dashboard.enabled was true, which
 *      ALSO took the always-on composer pill offline.
 */
import "./_isolate.mjs";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { createDashboardModule, normalizeBasePath, PILL_ROUTE } from "../lib/dashboard.js";

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

function sampleSnapshot() {
  return {
    asOf: "2026-10-06T12:00:00.000Z",
    windows: {
      today: {
        calls: 29, costUs: 0.000534, inputTokens: 8700, outputTokens: 900,
        medianLatencyMs: 933, p95LatencyMs: 3999,
        guards: { denied: 2, advised: 1 },
        byTool: { jev_verify: 27, jev_decision: 1, jev_choose: 1 },
      },
      session: { calls: 29, since: "2026-10-06T11:00:00.000Z" },
    },
    quota: {
      enabled: true, enforce: false, warnAtPercent: 80, status: "ok", resetInMs: 3600000,
      limits: { dailyCalls: 200, dailyCostUsd: 0.5, sessionCalls: null },
      used: { dailyCalls: 29, dailyCostUsd: 0.000534, sessionCalls: 29 },
      percent: { dailyCalls: 14.5, dailyCostUsd: 0.11 },
      projection: { calls: 41 },
    },
    history: [ { day: "2026-10-05", calls: 8 }, { day: "2026-10-06", calls: 29 } ],
    provider: "typesafe",
    priceUsdPerMTok: 0.042,
    persistence: false,
  };
}

const routes = [];
const fakeHost = { webServer: { register: (r) => routes.push(r) } };
const mod = createDashboardModule({ requestSystemOne: mockRso });
mod.registerRoutes(fakeHost, { dashboard: { enabled: true } }, () => ({
  model: "jev-mock", baseURL: "https://api.typesafe.ai/v1", apiKey: "k", resolveApiKey: async () => "k",
}), () => ({ guardActive: true, denyThreshold: 0.8, budgetRemaining: 9, usage: sampleSnapshot() }));

const paths = routes.map((r) => r.path);
assert.deepEqual(
  paths,
  ["/jev", "/jev/", PILL_ROUTE, "/jev/api", "/jev/api/try"],
  "enabled dashboard registers the page (both spellings), the pill route and the full API",
);
const page = routes.find((r) => r.path === "/jev");
const api = routes.find((r) => r.path === "/jev/api");
const tryRoute = routes.find((r) => r.path === "/jev/api/try");
const pillRoute = routes.find((r) => r.path === PILL_ROUTE);

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
assert.equal(snap0.usage.quota.used.dailyCalls, 29, "the usage panel rides along with the roll");
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

// --- PASS 6 (the 0.8.2 regression): with the dashboard OFF the mount path must
// still answer, and the pill route must exist. This is the user-reported 404.
{
  const off = [];
  mod.registerRoutes({ webServer: { register: (r) => off.push(r) } }, { dashboard: { enabled: false, basePath: "jev" } }, () => ({}), () => ({ usage: sampleSnapshot() }));
  const offPaths = off.map((r) => r.path);
  assert.deepEqual(offPaths, ["/jev", "/jev/", PILL_ROUTE], "a bare basePath still mounts /jev");
  const statusRes = fakeRes();
  await off[0].handler({ method: "GET" }, statusRes);
  assert.equal(statusRes.status, 200, "/jev must not 404 while the dashboard is off");
  assert.match(statusRes.body, /Jev 本机用量/);
  assert.match(statusRes.body, /29/, "the status page shows today's calls");
  assert.ok(!/决策仪表盘/.test(statusRes.body), "the full page stays behind dashboard.enabled");
  const pillRes = fakeRes();
  await off.find((r) => r.path === PILL_ROUTE).handler({ method: "GET" }, pillRes);
  assert.equal(JSON.parse(pillRes.body).today.calls, 29);
  console.log("PASS 6: disabled dashboard serves a status page and still feeds the pill");
}

// --- PASS 7: the mount path is normalized.
assert.equal(normalizeBasePath("jev"), "/jev");
assert.equal(normalizeBasePath("/jev"), "/jev");
assert.equal(normalizeBasePath("/jev/"), "/jev");
assert.equal(normalizeBasePath("  /custom/dash//  "), "/custom/dash");
assert.equal(normalizeBasePath(""), "/jev");
assert.equal(normalizeBasePath(undefined), "/jev");
// "/" is the GUI's own root: a value that normalizes to nothing falls back to the
// default mount rather than hijacking the app shell.
assert.equal(normalizeBasePath("/"), "/jev");
assert.equal(normalizeBasePath("///"), "/jev");
console.log("PASS 7: base path normalization");

// --- PASS 8: the pill payload is compact, JSON-safe and honest.
{
  const res = fakeRes();
  await pillRoute.handler({ method: "GET" }, res);
  const pill = JSON.parse(res.body);
  assert.equal(pill.kind, "jev-usage-pill");
  assert.equal(pill.ok, true);
  assert.equal(pill.today.calls, 29);
  assert.equal(pill.today.costUs, 0.000534);
  assert.equal(pill.today.medianLatencyMs, 933);
  assert.equal(pill.today.guards.denied, 2);
  assert.equal(pill.used.dailyCalls, 29);
  assert.equal(pill.limits.dailyCalls, 200);
  assert.equal(pill.percent.dailyCalls, 14.5);
  assert.equal(pill.status, "ok");
  assert.equal(pill.enforce, false);
  assert.equal(pill.session.calls, 29);
  assert.deepEqual(pill.byTool, { jev_verify: 27, jev_decision: 1, jev_choose: 1 });
  assert.deepEqual(pill.history, [ { day: "2026-10-05", calls: 8 }, { day: "2026-10-06", calls: 29 } ]);
  assert.ok(!("roll" in pill), "the pill never ships the decision roll");
  assert.equal(pill.balance, null, "no declared balance → null, never a guessed number");
  // 0.8.5: a declared balance and the on-disk ledger both ride the pill; the
  // status page derives 剩余 = 自报 - 本机实测 instead of implying a provider one.
  const balRoutes = [];
  const balMod = createDashboardModule({ requestSystemOne: mockRso });
  const balSnap = () => Object.assign(sampleSnapshot(), {
    persistence: { enabled: true, file: "C:/Users/x/.dsh/jev-usage.json" },
    quota: Object.assign(sampleSnapshot().quota, {
      balance: { declaredUsd: 5, since: "2026-10-01", spendUsd: 0.0003, remainingUsd: 4.9997, source: "declared" },
    }),
  });
  balMod.registerRoutes({ webServer: { register: (r) => balRoutes.push(r) } }, { dashboard: { enabled: false } }, () => ({}), () => ({ usage: balSnap() }));
  const balPillRes = fakeRes();
  await balRoutes.find((r) => r.path === PILL_ROUTE).handler({ method: "GET" }, balPillRes);
  const balPill = JSON.parse(balPillRes.body);
  assert.equal(balPill.balance.remainingUsd, 4.9997, "the declared balance reaches the pill");
  assert.equal(balPill.persistence.enabled, true);
  const balPageRes = fakeRes();
  await balRoutes[0].handler({ method: "GET" }, balPageRes);
  assert.match(balPageRes.body, /剩余（自报余额 - 本机实测）/, "the status page shows the derived remaining");
  assert.doesNotMatch(balPageRes.body, /额度状态/);
  console.log("PASS 8: pill route projects a compact JSON payload");
}

// --- PASS 9: a broken or missing snapshot degrades to ok:false, never a 5xx.
{
  const host = [];
  const boom = () => { throw new Error("usage module exploded"); };
  mod.registerRoutes({ webServer: { register: (r) => host.push(r) } }, { dashboard: { enabled: false } }, {}, boom);
  const pillRes = fakeRes();
  await host.find((r) => r.path === PILL_ROUTE).handler({ method: "GET" }, pillRes);
  assert.equal(pillRes.status, 200, "the pill route must never 5xx");
  assert.equal(JSON.parse(pillRes.body).ok, false);
  const pageRes = fakeRes();
  await host[0].handler({ method: "GET" }, pageRes);
  assert.equal(pageRes.status, 200, "the status page must survive a broken snapshot");
  assert.match(pageRes.body, /Jev 本机用量/);
  console.log("PASS 9: a broken snapshot degrades instead of 5xx");
}

// --- PASS 10: a custom base path keeps every surface.
{
  const host = [];
  mod.registerRoutes({ webServer: { register: (r) => host.push(r) } }, { dashboard: { enabled: true, basePath: "/custom/" } }, () => ({
    model: "jev-mock", baseURL: "https://api.typesafe.ai/v1", apiKey: "k",
  }), () => ({ usage: sampleSnapshot() }));
  const customPaths = host.map((r) => r.path);
  for (const path of ["/custom", "/custom/", "/custom/api", "/custom/api/try", "/custom/api/usage", PILL_ROUTE]) {
    assert.ok(customPaths.includes(path), "registers " + path);
  }
  const pageRes = fakeRes();
  await host.find((r) => r.path === "/custom").handler({ method: "GET" }, pageRes);
  assert.match(pageRes.body, /决策仪表盘/, "the full page is served on the custom base");
  console.log("PASS 10: custom base path keeps page, API and pill");
}

console.log("ALL DASHBOARD TESTS PASSED");