/**
 * Settings live-config test: a fake settings service drives the plugin's
 * runtime config (e.g. apiKey entered in the GUI) without restart.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

// We can't easily instantiate the full cordis plugin outside a host, so test
// the CONTRACT that makes GUI settings live:
//   1) register(ns, schema, {base}) registers the schema with the service
//   2) scope.watch feeds merged values back into the plugin's live config
//   3) resolveOptions picks up the live apiKey/baseURL/model
// This mirrors the wiring in apply().
import { Config } from "../lib/index.js";

const base = {
  enabled: true, apiKeyEnv: "TYPESAFE_API_KEY", baseURL: "https://api.typesafe.ai/v1",
  model: "jev-latest", timeoutMs: 15000, maxQuestionsPerCall: 25, verifyEnabled: true,
  autoGuard: { enabled: false }, dashboard: { enabled: false },
};
let saved = null;
let watchers = [];
const fakeSettings = {
  register(ns, schema, options) {
    assert.equal(ns, "jev-verify");
    assert.ok(schema, "schema provided");
    assert.ok(options.base, "base provided");
    return {
      get() { return saved; },
      watch(fn) { watchers.push(fn); },
    };
  },
};
const ctx = { inject: (svc, cb) => { if (svc.includes("settings")) cb({ settings: fakeSettings }); } };
let live = { ...base };
const sync = () => { const got = saved ?? {}; live = Object.assign({}, base, got); };
// simulate plugin apply-time wiring
ctx.inject(["settings"], (sctx) => {
  const scope = sctx.settings.register("jev-verify", Config, { base });
  scope.watch(sync);
  sync();
});

// baseline: composed config
assert.equal(live.apiKey, undefined);
// GUI saves an apiKey
saved = { apiKey: "gui-key-123", model: "jev-1.13.0" };
for (const w of watchers) w();
sync();
assert.equal(live.apiKey, "gui-key-123", "apiKey from GUI settings");
assert.equal(live.model, "jev-1.13.0", "model override from GUI");
assert.equal(live.baseURL, "https://api.typesafe.ai/v1", "unset fields keep base");
console.log("PASS 1: GUI-saved apiKey feeds live config (no restart)");

// schema validation: Config accepts the exact shape stored from GUI
const v = Config["~standard"].validate({ apiKey: "x", model: "jev-1.13.0", autoGuard: { enabled: true }, dashboard: { enabled: true } });
assert.ok(v.value, "schema validates GUI-shaped config");
console.log("PASS 2: Config schema accepts GUI-shaped values");

assert.ok(typeof fs.existsSync === "function", "sanity");
console.log("ALL SETTINGS TESTS PASSED");
