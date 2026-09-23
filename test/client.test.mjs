/**
 * Client-card tests: the browser half must register the settings.plugin.item
 * slot keyed "jev-verify" without throwing, under a stubbed browser + services.
 */
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const code = readFileSync(new URL("../client/client.js", import.meta.url), "utf8");
let loaded = null;
globalThis.window = { __ModuleLoader__: { load: (rec) => { loaded = rec; } } };

// parse the factory out and run it with a stub require
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
let moduleExports;
assert.doesNotThrow(() => {
  moduleExports = factory((name) => (name === "react" ? reactStub : {}));
}, "factory must run without throwing");
assert.ok(moduleExports && typeof moduleExports.apply === "function", "apply exported");
// The client runner gates service access on the plugin's OWN inject declaration
// (dsh-cordis-client-runner: 'service "x" is not declared by your plugin').
// Without this export the card registration throws and is swallowed -> no card.
assert.ok(Array.isArray(moduleExports.inject), "inject declared (runner service gate)");
assert.ok(moduleExports.inject.includes("slots"), "inject declares slots");
assert.ok(moduleExports.inject.includes("settingsScope"), "inject declares settingsScope");
console.log("PASS 1: factory loads and exports apply");

// drive apply with stubbed browser services
const slotInjects = [];
let registeredCard = null;
const registeredEntries = [];
const fakeClientCtx = {
  settingsScope: {
    bind: (spec) => {
      assert.equal(spec.namespace, "jev-verify");
      return {
        subscribe: () => () => {},
        getSnapshot: () => ({ value: { model: "jev-latest" }, writable: true }),
        set: async () => {},
      };
    },
  },
  slots: {
    inject: (name, fn) => { slotInjects.push({ name, fn }); },
    register: (opts, Comp) => {
      registeredCard = { opts, Comp };
      registeredEntries.push(registeredCard);
      return registeredCard;
    },
  },
  logger: { warn: (m) => console.log("CLIENT WARN:", m) },
};
assert.doesNotThrow(() => moduleExports.apply(fakeClientCtx), "apply must not throw");
const slotInject = slotInjects.find((s) => s.name === "settings.plugin.item");
assert.ok(slotInject, "settings.plugin.item injected");
const iter = slotInject.fn();
const first = iter.next().value;
assert.ok(first, "card registered");
assert.equal(first.opts.name, "settings.plugin.item");
assert.equal(first.opts.key, "jev-verify");
assert.doesNotThrow(() => first.Comp({}), "card renders without throwing");
// The inject face must NOT carry primitive hook values.
// dsh-client-ui-renderer's observableHook does WeakMap.set(source) per hook, so a
// primitive like `true` throws "Invalid value used as weak map key", the entry
// crashes during render, and the card silently never appears. Regression guard:
assert.ok(first.opts.inject && typeof first.opts.inject === "function");
const face = first.opts.inject();
assert.ok(face && typeof face === "object", "inject face is an object");
for (const [name, source] of Object.entries(face.hooks ?? {})) {
  assert.ok(
    source && typeof source === "object" && typeof source.getSnapshot === "function" && typeof source.subscribe === "function",
    `hook "${name}" must be an observable { getSnapshot, subscribe }, not a primitive`,
  );
}
console.log("PASS 2: settings.plugin.item card registered keyed jev-verify");

// hostile ctx (missing services) must never throw either
assert.doesNotThrow(() => moduleExports.apply({}), "apply with empty ctx must not throw");
// The inline tool view must be registered for every Jev tool name, keyed by the
// wire tool name (tool.call.toolview dispatch), so calls render in the turn.
const tvInject = slotInjects.find((s) => s.name === "tool.call.toolview");
assert.ok(tvInject, "tool.call.toolview injected");
const tvKeys = [];
for (const entry of tvInject.fn()) {
  assert.equal(entry.opts.name, "tool.call.toolview");
  tvKeys.push(entry.opts.key);
  assert.ok(entry.opts.inject && typeof entry.opts.inject === "function");
  const tvFace = entry.opts.inject();
  for (const [n, source] of Object.entries(tvFace.hooks ?? {})) {
    assert.ok(
      source && typeof source === "object" && typeof source.getSnapshot === "function",
      `toolview hook "${n}" must be observable, not a primitive`,
    );
  }
}
for (const required of ["jev_decision", "jev_overview"]) {
  assert.ok(tvKeys.includes(required), `toolview registered for ${required}`);
}
console.log("PASS 4: inline tool views registered for " + tvKeys.join(", "));

console.log("PASS 3: apply is defensive on hostile hosts");
console.log("ALL CLIENT TESTS PASSED");