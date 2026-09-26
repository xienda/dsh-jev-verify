/**
 * Settings-generation compatibility tests.
 *
 * dsh <= 0.1.5 exposes `ctx.settings.register(ns, schema, {base})` plus a
 * watched scope. dsh >= 0.1.7 removed it: the profile entry id IS the namespace
 * and the host generates the form from the plugin's own Config, but ONLY from
 * fields whose schema marks them volatile. These tests pin both paths down, so
 * a host upgrade can never silently cost the tools or the GUI form again.
 */
import assert from "node:assert/strict";
import { apply, Config, name, inject } from "../lib/index.js";

/**
 * Collect the paths whose schema marks meta.volatile, walking the LIVE schema
 * exactly the way the host's own `volatileForm` does (dict / inner / list).
 * `toJSON()` is deliberately not used: 3.18.x returns a uid/refs table there,
 * while the host reads the live nodes.
 */
function volatilePaths(node, prefix = "", out = []) {
  // The root schema is a callable builder, not a plain object.
  if (!node || (typeof node !== "object" && typeof node !== "function")) return out;
  if (node.meta?.volatile === true) out.push(prefix);
  for (const [key, child] of Object.entries(node.dict ?? {})) volatilePaths(child, prefix ? prefix + "." + key : key, out);
  if (node.inner) volatilePaths(node.inner, prefix + "[]", out);
  for (const child of node.list ?? []) volatilePaths(child, prefix + "[]", out);
  return out;
}

/** Fake host. `settings` selects the generation; `config` simulates a live fiber config. */
function fakeCtx({ settings = "none", config } = {}) {
  const tools = [];
  const settingsNamespaces = [];
  const ctx = {
    tools: { register: (t) => tools.push(t) },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get: () => undefined,
    on: () => {},
    inject: (services, cb) => {
      if (!services.includes("settings")) return;
      if (settings === "none") return; // host without the service at all
      if (settings === "legacy") {
        cb({ settings: { register(ns, schema, options) { settingsNamespaces.push(ns); assert.ok(schema, "schema required"); assert.ok(options?.base, "base required"); return { get: () => ({}), watch: () => {} }; } } });
        return;
      }
      // 0.1.7+: the service exists but carries no register()
      cb({ settings: {} });
    },
  };
  if (config !== undefined) ctx.config = config;
  return { ctx, tools, settingsNamespaces };
}

// --- 1) The GUI form prerequisite: user-facing fields must be volatile.
assert.ok(Config, "Config schema present");
const volatile = volatilePaths(Config);
for (const field of ["enabled", "apiKey", "apiKeyEnv", "baseURL", "model", "timeoutMs", "maxQuestionsPerCall", "verifyEnabled", "autoGuard.enabled", "autoGuard.denyThreshold", "autoGuard.statusTool", "dashboard.enabled"]) {
  assert.ok(volatile.includes(field), "field " + field + " must be volatile so dsh >= 0.1.7 renders it in the entry form");
}
console.log("PASS 1: " + volatile.length + " config fields are volatile (entry-form editable)");

// --- 2) New generation: no register() must not disturb tools or boot.
{
  const { ctx, tools } = fakeCtx({ settings: "modern" });
  assert.doesNotThrow(() => apply(ctx, {}), "apply must not throw when settings.register is absent");
  assert.deepEqual(tools.map((t) => t.name).sort(), ["jev_decision", "jev_guard_status", "jev_overview", "jev_verify"], "all four tools register on dsh >= 0.1.7");
  console.log("PASS 2: dsh >= 0.1.7 (no register) registers every tool without throwing");
}

// --- 3) No settings service at all (headless hosts) is equally fine.
{
  const { ctx, tools } = fakeCtx({ settings: "none" });
  assert.doesNotThrow(() => apply(ctx, {}), "apply must not throw without a settings service");
  assert.equal(tools.length, 4, "tools register without any settings service");
  console.log("PASS 3: host without a settings service still gets every tool");
}

// --- 4) Legacy generation keeps the registered namespace.
{
  const { ctx, settingsNamespaces } = fakeCtx({ settings: "legacy" });
  assert.doesNotThrow(() => apply(ctx, {}), "apply must not throw on the legacy generation");
  assert.ok(settingsNamespaces.includes("jev-verify"), "legacy host still gets the registered namespace");
  console.log("PASS 4: dsh <= 0.1.5 still registers the jev-verify namespace");
}

// --- 5) Live config on the entry-form generation: the host reconfigures this
//        fiber when the form is saved, so reads must follow ctx.config rather
//        than the apply-time snapshot.
{
  const { ctx, tools } = fakeCtx({ settings: "modern", config: { autoGuard: { enabled: true, maxJevCallsPerSession: 7 } } });
  apply(ctx, { autoGuard: { enabled: true, maxJevCallsPerSession: 50 } });
  const status = tools.find((t) => t.name === "jev_guard_status");
  assert.ok(status, "jev_guard_status registered");
  const snap = await status.execute({}, { signal: undefined });
  assert.equal(snap.budgetRemaining, 7, "budget must follow the live fiber config (7), not the apply-time value (50)");
  console.log("PASS 5: entry-form generation reads live config from the fiber");
}

console.log("ALL COMPAT TESTS PASSED");
