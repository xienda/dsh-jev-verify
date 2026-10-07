/**
 * Client-half tests across BOTH settings generations.
 *
 * Regression history this file pins down:
 *   1. dsh-client-ui-renderer's observableHook WeakMap.set(source)-s every hook,
 *      so a primitive hook value kills the entry -> hooks must be observable.
 *   2. apply() used to register the legacy settings card FIRST and unguarded, so
 *      a throw there aborted apply() before the inline tool views registered.
 *   3. dsh >= 0.1.7 ships neither the `settingsScope` service nor the
 *      `settings.plugin.item` slot: requiring that service would leave the whole
 *      client plugin unapplied, tool views included.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const code = readFileSync(new URL("../client/client.js", import.meta.url), "utf8");
let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (rec) => { loaded = rec; } } };

// DOM stub: only the attribute writes apply() performs are observable.
const attrs = new Map();
globalThis.document = {
  documentElement: { setAttribute: (k, v) => attrs.set(k, v) },
  querySelector: () => null,
  createElement: () => ({ dataset: {}, style: {}, setAttribute: () => {} }),
  head: { appendChild: () => {} },
  body: { appendChild: () => {} },
};

const start = code.indexOf("factory: (require) => {") + "factory: (require) => {".length;
const end = code.lastIndexOf("return module.exports;");
const body = code.slice(start, end).replace(/^\s*/, "");
// createElement keeps the children so a render can be searched for the exact
// badge text the user sees; snapshotRef lets a test feed the scope snapshot.
const reactStub = {
  createElement: (type, props, ...kids) => ({ __jsx: true, type, props, kids }),
  useState: () => [undefined, () => {}],
  // Effects are captured so a test can run them once, the way a mount would.
  useEffect: (fn) => { effects.push(fn); },
  useSyncExternalStore: () => snapshotRef,
};
let snapshotRef = { value: {}, writable: true };
/** Mount-time effects produced by the last render(s). */
const effects = [];
function runEffects() {
  const pending = effects.splice(0, effects.length);
  for (const fn of pending) fn();
}
const factory = new Function("require", body + "\nreturn module.exports;");
const moduleExports = factory((name) => (name === "react" ? reactStub : {}));
assert.ok(moduleExports && typeof moduleExports.apply === "function", "apply exported");

// --- PASS 1: the declared service surface must stay loadable on dsh >= 0.1.7.
assert.ok(Array.isArray(moduleExports.inject), "inject declared (runner service gate)");
assert.ok(moduleExports.inject.includes("slots"), "inject declares slots");
assert.ok(
  !moduleExports.inject.includes("settingsScope"),
  "settingsScope must NOT be a required service: dsh >= 0.1.7 does not provide it, and a required-but-absent service keeps the whole plugin (tool views included) from applying",
);
console.log("PASS 1: declares only the services every generation provides");

/**
 * Drive apply against one generation.
 * @param withSettingsScope - legacy generation (service + card slot present).
 */
function runApply(withSettingsScope, scopeExtra = {}) {
  const slotInjects = [];
  const registered = [];
  const writes = [];
  const ctx = {
    settingsScope: withSettingsScope
      ? {
          bind: (spec) => {
            assert.equal(spec.namespace, "jev-verify");
            return Object.assign({
              subscribe: () => () => {},
              getSnapshot: () => ({ value: { model: "jev-latest" }, writable: true }),
              set: async (path, value) => { writes.push({ via: "set", path, value }); },
              mutate: async (ops) => { writes.push({ via: "mutate", ops }); },
            }, scopeExtra);
          },
          describe: () => ({ getSnapshot: () => ({ status: "ready", view: { namespaces: [{ ns: "jev-verify" }] } }) }),
        }
      : undefined,
    get: (n) => (n === "settingsScope" ? ctx.settingsScope : undefined),
    // cordis conditional injection: fire only when every service is present.
    inject: (services, cb) => {
      const have = { settingsScope: withSettingsScope === true };
      if (services.every((s) => have[s] === true)) cb(ctx);
    },
    slots: {
      inject: (name, fn) => slotInjects.push({ name, fn }),
      register: (opts, Comp) => { const e = { opts, Comp }; registered.push(e); return e; },
    },
    logger: { warn: (m) => console.log("CLIENT WARN:", m) },
  };
  assert.doesNotThrow(() => moduleExports.apply(ctx), "apply must not throw");
  return { slotInjects, registered, writes };
}

// --- PASS 2: legacy generation registers both the card and the tool views.
{
  attrs.clear();
  const { slotInjects } = runApply(true);
  const slotInject = slotInjects.find((s) => s.name === "settings.plugin.item");
  assert.ok(slotInject, "settings.plugin.item injected on the legacy generation");
  const first = slotInject.fn().next().value;
  assert.ok(first, "card registered");
  assert.equal(first.opts.name, "settings.plugin.item");
  assert.equal(first.opts.key, "jev-verify");
  assert.doesNotThrow(() => first.Comp({}), "card renders without throwing");
  assert.ok(first.opts.inject && typeof first.opts.inject === "function");
  const face = first.opts.inject();
  for (const [n, source] of Object.entries(face.hooks ?? {})) {
    assert.ok(
      source && typeof source === "object" && typeof source.getSnapshot === "function" && typeof source.subscribe === "function",
      `hook "${n}" must be an observable { getSnapshot, subscribe }, not a primitive`,
    );
  }
  const tv = slotInjects.find((s) => s.name === "tool.call.toolview");
  assert.ok(tv, "tool views registered on the legacy generation");
  assert.match(String(attrs.get("data-dsh-jev-card")), /toolview/);
  console.log("PASS 2: legacy generation registers card + tool views");
}

// --- PASS 3 (the 0.1.7 regression): without settingsScope the tool views must
// still register — this is exactly what used to be lost.
{
  attrs.clear();
  const { slotInjects } = runApply(false);
  assert.equal(
    slotInjects.find((s) => s.name === "settings.plugin.item"),
    undefined,
    "no legacy card is attempted when the service is absent",
  );
  const tv = slotInjects.find((s) => s.name === "tool.call.toolview");
  assert.ok(tv, "tool.call.toolview injected even without settingsScope");
  const keys = [];
  for (const entry of tv.fn()) {
    assert.equal(entry.opts.name, "tool.call.toolview");
    keys.push(entry.opts.key);
    assert.ok(entry.opts.inject && typeof entry.opts.inject === "function");
    const tvFace = entry.opts.inject();
    for (const [n, source] of Object.entries(tvFace.hooks ?? {})) {
      assert.ok(
        source && typeof source === "object" && typeof source.getSnapshot === "function",
        `toolview hook "${n}" must be observable, not a primitive`,
      );
    }
  }
  for (const required of ["jev_decision", "jev_overview", "jev_guard_status", "jev_verify"]) {
    assert.ok(keys.includes(required), `toolview registered for ${required}`);
  }
  assert.equal(attrs.get("data-dsh-jev-ns"), JSON.stringify({ mode: "entry-form", ns: "jev-verify" }));
  console.log("PASS 3: dsh >= 0.1.7 (no settingsScope) keeps the inline tool views");
}

/**
 * Evaluate a react-stub element tree, calling function components the way a
 * real renderer would (the stub's hooks are stateless, so one pass suffices).
 * @param node - element / array / primitive returned by the react stub
 */
function render(node, depth = 0) {
  if (depth > 40 || node == null || node === false) return null;
  if (typeof node === "string" || typeof node === "number") return node;
  if (Array.isArray(node)) return node.map((kid) => render(kid, depth + 1));
  if (!node.__jsx) return null;
  const kids = (node.kids || []).map((kid) => render(kid, depth + 1));
  if (typeof node.type === "function") {
    const props = Object.assign({}, node.props, { children: kids.length === 1 ? kids[0] : kids });
    return render(node.type(props), depth + 1);
  }
  return Object.assign({}, node, { kids });
}

/**
 * Collect every text node a rendered tree carries.
 * @param node - rendered element / array / primitive
 */
function textOf(node, acc = []) {
  if (node == null || node === false) return acc;
  if (typeof node === "string" || typeof node === "number") { acc.push(String(node)); return acc; }
  if (Array.isArray(node)) { for (const kid of node) textOf(kid, acc); return acc; }
  if (node.kids) for (const kid of node.kids) textOf(kid, acc);
  return acc;
}

// --- PASS 4 (the 0.8.1 regression): when the settings scope cannot decode the
// value (the wrapped-schema bug), the card gets value === {} — it must still
// advertise the key that is really configured instead of "未配置".
{
  const { keySourceOf, rawLayersOf, layerGet } = moduleExports.__internal;
  // settings.yaml stores flat dotted keys; both shapes must resolve.
  assert.equal(layerGet({ autoGuard: { maxJevCallsPerSession: 60 } }, "autoGuard.maxJevCallsPerSession"), 60);
  assert.equal(layerGet({ "autoGuard.maxJevCallsPerSession": 60 }, "autoGuard.maxJevCallsPerSession"), 60);
  assert.equal(layerGet(undefined, "apiKey"), undefined);
  assert.equal(layerGet({ apiKey: "sk-live" }, "apiKey"), "sk-live");

  assert.deepEqual(
    keySourceOf({}, { apiKeyEnv: "TYPESAFE_API_KEY" }),
    { keyState: "env", envName: "TYPESAFE_API_KEY" },
    "a key configured in the raw layers must not read as an unconfigured card",
  );
  assert.equal(keySourceOf({}, { apiKey: "sk-live" }).keyState, "literal");
  assert.equal(keySourceOf({}, {}).keyState, "none");
  assert.equal(keySourceOf({ apiKeyEnv: "A" }, { apiKeyEnv: "B" }).envName, "A", "the decoded value wins over the layer");
  assert.equal(keySourceOf({ apiKey: "sk-x", apiKeyEnv: "A" }).keyState, "literal");
  assert.equal(rawLayersOf(null), null);
  assert.deepEqual(rawLayersOf({ base: { model: "a" }, user: { model: "b" } }), { model: "b" });
  assert.deepEqual(rawLayersOf({ base: { model: "a" } }), { model: "a" });

  attrs.clear();
  snapshotRef = { value: {}, base: { apiKeyEnv: "TYPESAFE_API_KEY" }, writable: true };
  const { slotInjects } = runApply(true);
  const card = slotInjects.find((s) => s.name === "settings.plugin.item").fn().next().value;
  let tree = null;
  assert.doesNotThrow(() => { tree = render(card.Comp({})); }, "an undecodable snapshot must not break the card");
  const text = textOf(tree).join(" | ");
  assert.ok(text.length > 0, "the card rendered text");
  assert.match(text, /环境变量 TYPESAFE_API_KEY/, "the badge must name the configured credential reference");
  assert.ok(!/未配置/.test(text), 'the card must not claim "未配置" while a key is configured');
  console.log("PASS 4: an undecodable snapshot still advertises the configured key");
}

// --- PASS 5: a hostile host must never throw.
assert.doesNotThrow(() => moduleExports.apply({}), "apply with empty ctx must not throw");
console.log("PASS 5: apply is defensive on hostile hosts");
// --- PASS 6 (0.8.2): the composer usage pill shows real numbers and degrades
// quietly. The route is read-only and same-origin; a missing route, a 401, bad
// JSON or a host without fetch must never surface as an error in the composer.
{
  const { pillFromRaw, pillLabel, pillTone, PillBody, PILL_ROUTES } = moduleExports.__internal;
  assert.deepEqual(PILL_ROUTES, ["/jev/api/usage", "/jev/api"], "the pill prefers the dedicated route");

  const snapshot = {
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
    },
    history: [ { day: "2026-10-06", calls: 29 } ],
  };
  const pill = pillFromRaw(snapshot);
  assert.equal(pill.ok, true);
  assert.equal(pill.today.calls, 29);
  assert.equal(pill.today.medianLatencyMs, 933);
  assert.equal(pill.today.guards.denied, 2);
  assert.equal(pill.used.dailyCalls, 29);
  assert.equal(pill.limits.dailyCalls, 200);
  assert.deepEqual(pill.history, [ { day: "2026-10-06", calls: 29 } ]);
  // The full dashboard API wraps the same snapshot under `usage`.
  assert.equal(pillFromRaw({ usage: snapshot }).today.calls, 29);
  // A ready-made projection passes straight through; junk becomes null.
  assert.equal(pillFromRaw({ kind: "jev-usage-pill", ok: true, today: { calls: 1 } }).today.calls, 1);
  assert.equal(pillFromRaw({ usage: null }), null);
  assert.equal(pillFromRaw(null), null);
  assert.equal(pillFromRaw("nope"), null);

  assert.equal(pillLabel(pill), "Jev · 今日 $0.000534 · 29 次");
  assert.equal(pillLabel(null), "Jev · 额度不可用");
  assert.equal(pillLabel({ ok: false }), "Jev · 额度不可用");
  assert.equal(pillLabel({ ok: true, enabled: false }), "Jev · 额度已关闭");
  assert.equal(pillTone(pill), "");
  assert.equal(pillTone({ ok: true, enabled: true, percent: { dailyCalls: 85 }, warnAtPercent: 80 }), "Warn");
  assert.equal(pillTone({ ok: true, enabled: true, status: "warn", percent: {} }), "Warn");
  assert.equal(pillTone({ ok: true, enabled: true, status: "exceeded", percent: {} }), "Bad");
  assert.equal(pillTone(null), "Bad");

  const body = render(PillBody({ pill, at: Date.parse("2026-10-06T12:00:00.000Z"), busy: false, onRefresh: () => {} }));
  const bodyText = textOf(body).join(" | ");
  assert.match(bodyText, /Jev 本机用量 · 额度正常/);
  assert.match(bodyText, /今日调用/);
  assert.match(bodyText, /29 \/ 200/);
  assert.match(bodyText, /\$0\.000534/);
  assert.match(bodyText, /中位 933 ms/);
  assert.match(bodyText, /护栏拦截/);
  assert.match(bodyText, /本机实测，非账户余额/);
  assert.match(bodyText, /本地预算重置/);
  assert.match(bodyText, /今日成本/);
  assert.match(bodyText, /累计（本插件实例）/);
  // 0.8.4: without a local budget there is no "额度正常", no meter and no reset.
  const noBudget = pillFromRaw(Object.assign({}, snapshot, {
    quota: Object.assign({}, snapshot.quota, { limits: { dailyCalls: null, dailyCostUsd: null, sessionCalls: null }, percent: {}, budgetConfigured: false }),
    windows: Object.assign({}, snapshot.windows, { all: { calls: 29, costUs: 0.000534 } }),
  }));
  assert.equal(noBudget.budgetConfigured, false);
  const flat = textOf(render(PillBody({ pill: noBudget, at: 0, busy: false, onRefresh: () => {} }))).join(" | ");
  assert.doesNotMatch(flat, /额度正常/);
  assert.doesNotMatch(flat, /额度重置/);
  assert.doesNotMatch(flat, /本地自设上限/);
  assert.match(flat, /按量计费/);
  assert.match(flat, /今日成本/);
  assert.match(flat, /累计（本插件实例）/);
  const broken = render(PillBody({ pill: { ok: false, error: "HTTP 404" } }));
  assert.match(textOf(broken).join(" | "), /HTTP 404/);

  // The slot contract the renderer sorts on: name + id + order.
  attrs.clear();
  const { slotInjects } = runApply(false);
  const pillSlot = slotInjects.find((s) => s.name === "conversation.input.right");
  assert.ok(pillSlot, "conversation.input.right injected");
  const entry = pillSlot.fn().next().value;
  assert.equal(entry.opts.id, "jev-usage");
  assert.equal(entry.opts.order, 900);
  assert.equal(entry.opts.name, "conversation.input.right");
  assert.match(String(attrs.get("data-dsh-jev-card")), /pill/);
  let pillTree = null;
  assert.doesNotThrow(() => { pillTree = render(entry.Comp({})); }, "an unloaded pill must not throw");
  assert.match(textOf(pillTree).join(" | "), /Jev · 额度不可用/, "without data the pill stays a quiet label");
  console.log("PASS 6: composer usage pill renders numbers and degrades quietly");
}
// --- PASS 7 (0.8.3): a save must reach the schema as NESTED paths, and a
// document written by <= 0.8.2 (literal dotted keys) must be repaired on mount.
// SettingsScope.set(field) stores path: [field], so the dotted field name used
// to land as one unknown key: the card said "saved" and nothing changed.
{
  const { buildOps, pathSegments, legacyFlatPaths } = moduleExports.__internal;
  assert.deepEqual(pathSegments("autoGuard.denyThreshold"), ["autoGuard", "denyThreshold"]);
  assert.deepEqual(pathSegments("apiKey"), ["apiKey"]);
  assert.deepEqual(pathSegments(""), []);
  assert.deepEqual(legacyFlatPaths({ "dashboard.basePath": "jev", enabled: true }), ["dashboard.basePath"]);
  assert.deepEqual(legacyFlatPaths(null), []);
  assert.deepEqual(legacyFlatPaths({ nested: { a: 1 } }), []);

  const ops = buildOps({ "autoGuard.maxJevCallsPerSession": "60", model: "jev-latest" });
  assert.deepEqual(ops, [
    { op: "set", path: ["autoGuard", "maxJevCallsPerSession"], value: 60 },
    { op: "set", path: ["model"], value: "jev-latest" },
  ], "a saved field becomes one nested segment path, with numeric text coerced");
  assert.deepEqual(buildOps(null), []);

  // The mount repair: both flat keys rewritten in ONE atomic mutation.
  effects.length = 0;
  snapshotRef = {
    value: { enabled: true, apiKeyEnv: "TYPESAFE_API_KEY" },
    writable: true,
    user: { "dashboard.basePath": "jev", "autoGuard.maxJevCallsPerSession": 60 },
  };
  const { slotInjects, writes } = runApply(true);
  const card = slotInjects.find((s) => s.name === "settings.plugin.item").fn().next().value;
  render(card.Comp({}));
  runEffects();
  assert.equal(writes.length, 1, "exactly one repair mutation");
  assert.equal(writes[0].via, "mutate");
  assert.deepEqual(writes[0].ops, [
    { op: "set", path: ["dashboard", "basePath"], value: "jev" },
    { op: "unset", path: ["dashboard.basePath"] },
    { op: "set", path: ["autoGuard", "maxJevCallsPerSession"], value: 60 },
    { op: "unset", path: ["autoGuard.maxJevCallsPerSession"] },
  ]);

  // A second render/effect pass must not repeat it, and a clean document is a no-op.
  effects.length = 0;
  render(card.Comp({}));
  runEffects();
  assert.equal(writes.length, 1, "the repair runs once per scope");
  snapshotRef = { value: { enabled: true }, writable: true };
  const clean = runApply(true);
  const cleanCard = clean.slotInjects.find((s) => s.name === "settings.plugin.item").fn().next().value;
  effects.length = 0;
  render(cleanCard.Comp({}));
  runEffects();
  assert.equal(clean.writes.length, 0, "a nested document needs no repair");
  console.log("PASS 7: settings writes use nested paths and legacy flat keys are repaired");
}
// --- PASS 8 (0.8.5): the collapsed pill leads with 剩余 when the user declared
// a balance, and the popover derives it as 自报 - 本机实测. TypeSafe has no
// balance endpoint, so without a declaration the pill must say so, not guess.
{
  const { pillFromRaw, pillLabel, PillBody } = moduleExports.__internal;
  const build = (balance) => pillFromRaw({
    windows: {
      today: { calls: 3, costUs: 0.0001, inputTokens: 100, outputTokens: 20, guards: { denied: 0, advised: 0 } },
      all: { calls: 9, costUs: 0.0003 },
      session: { calls: 3, since: "2026-10-06T11:00:00.000Z" },
    },
    quota: Object.assign({
      enabled: true, enforce: false, status: "ok", resetInMs: 0, budgetConfigured: false,
      limits: { dailyCalls: null, dailyCostUsd: null, sessionCalls: null },
      used: { dailyCalls: 3, dailyCostUsd: 0.0001, sessionCalls: 3 }, percent: {},
    }, balance ? { balance } : {}),
    persistence: { enabled: true, file: "C:/Users/x/.dsh/jev-usage.json" },
  });
  const declared = build({ declaredUsd: 5, since: "2026-10-01", spendUsd: 0.0003, remainingUsd: 4.9997, source: "declared" });
  assert.equal(declared.balance.declaredUsd, 5);
  assert.equal(pillLabel(declared), "Jev · 剩余 $4.9997 · 今日 3 次", "剩余 leads the collapsed pill");
  const withBal = textOf(render(PillBody({ pill: declared, at: 0, busy: false, onRefresh: () => {} }))).join(" | ");
  assert.match(withBal, /剩余/);
  assert.match(withBal, /\$4\.9997/);
  assert.match(withBal, /自报 \$5\.00/);
  assert.match(withBal, /累计（本机实测）/, "a persistent ledger is named honestly");
  assert.doesNotMatch(withBal, /未自报余额/);
  const none = build(null);
  assert.equal(none.balance, null);
  assert.equal(pillLabel(none), "Jev · 今日 $0.000100 · 3 次");
  const noBal = textOf(render(PillBody({ pill: none, at: 0, busy: false, onRefresh: () => {} }))).join(" | ");
  assert.match(noBal, /未自报余额/);
  assert.match(noBal, /TypeSafe 无余额接口/);
  assert.match(noBal, /累计（本机实测）/);
  console.log("PASS 8: remaining is the declared balance minus locally measured spend");
}
console.log("ALL CLIENT TESTS PASSED");
