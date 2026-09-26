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
const reactStub = {
  createElement: () => ({ __jsx: true }),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useSyncExternalStore: () => ({ value: {}, writable: true }),
};
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
function runApply(withSettingsScope) {
  const slotInjects = [];
  const registered = [];
  const ctx = {
    settingsScope: withSettingsScope
      ? {
          bind: (spec) => {
            assert.equal(spec.namespace, "jev-verify");
            return {
              subscribe: () => () => {},
              getSnapshot: () => ({ value: { model: "jev-latest" }, writable: true }),
              set: async () => {},
            };
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
  return { slotInjects, registered };
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

// --- PASS 4: a hostile host must never throw.
assert.doesNotThrow(() => moduleExports.apply({}), "apply with empty ctx must not throw");
console.log("PASS 4: apply is defensive on hostile hosts");
console.log("ALL CLIENT TESTS PASSED");
