/**
 * Config-resolution regression tests.
 *
 * v0.6.0 called credentialRef(config.apiKeyEnv) unguarded: whenever the field
 * arrived as anything but a bare identifier (the settings form can round-trip
 * credential-ref fields as objects) the call threw
 *   credential ref "[object Object]" must match /^[A-Za-z_][A-Za-z0-9_]*$/
 * which broke jev_overview outright and made the boot-time auto-guard setup
 * fail silently (guard stayed disarmed: tools [] / denyThreshold null).
 *
 * These tests lock in the contract: a malformed or foreign config shape never
 * throws out of the plugin, and a usable value still resolves.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Config, SettingsConfig, __internal } from "../lib/index.js";

const { credentialNameOf, toCredentialRef, resolveOptions, normalizeConfig, unwrapField, DEFAULT_API_KEY_ENV } = __internal;
const ctx = { get: () => void 0 };

test("credentialNameOf coerces object-shaped credential-ref fields", () => {
  assert.equal(credentialNameOf("MY_KEY"), "MY_KEY");
  assert.equal(credentialNameOf("  MY_KEY  "), "MY_KEY");
  assert.equal(credentialNameOf({ ref: "MY_KEY" }), "MY_KEY");
  assert.equal(credentialNameOf({ name: "MY_KEY" }), "MY_KEY");
  assert.equal(credentialNameOf({ value: "MY_KEY" }), "MY_KEY");
  assert.equal(credentialNameOf({ ref: "  " }), "");
  assert.equal(credentialNameOf({}), "");
  assert.equal(credentialNameOf(null), "");
  assert.equal(credentialNameOf(void 0), "");
  assert.equal(credentialNameOf(42), "");
  assert.equal(credentialNameOf([1, 2]), "");
});

test("resolveOptions never throws for damaged apiKeyEnv values", () => {
  for (const bad of [{ ref: "TYPESAFE_API_KEY" }, {}, { nested: { ref: "X" } }, "not a valid name!", "1BAD", 42, true, [1, 2]]) {
    const options = resolveOptions(ctx, { apiKeyEnv: bad });
    assert.equal(typeof options.baseURL, "string");
    assert.equal(typeof options.model, "string");
    assert.ok(options.timeoutMs > 0);
  }
  // and for a config that is not an object at all
  for (const bad of [null, void 0, "config", 7]) {
    assert.doesNotThrow(() => resolveOptions(ctx, bad));
  }
});

test("object-shaped apiKeyEnv still resolves an existing environment variable", async () => {
  const saved = process.env.MY_JEV_TEST_KEY;
  process.env.MY_JEV_TEST_KEY = "secret-from-env";
  try {
    const options = resolveOptions(ctx, { apiKeyEnv: { ref: "MY_JEV_TEST_KEY" } });
    assert.equal(await options.resolveApiKey(), "secret-from-env");
  } finally {
    if (saved === void 0) delete process.env.MY_JEV_TEST_KEY;
    else process.env.MY_JEV_TEST_KEY = saved;
  }
});

test("an illegal apiKeyEnv falls back to the documented default variable", async () => {
  const savedDefault = process.env.TYPESAFE_API_KEY;
  const savedOther = process.env.MY_JEV_OTHER_KEY;
  process.env.TYPESAFE_API_KEY = "default-env-key";
  process.env.MY_JEV_OTHER_KEY = "other-env-key";
  try {
    const illegal = resolveOptions(ctx, { apiKeyEnv: "not a valid name!" });
    assert.equal(await illegal.resolveApiKey(), "default-env-key");

    const hyphenated = resolveOptions(ctx, { apiKeyEnv: "MY-JEV" });
    assert.equal(await hyphenated.resolveApiKey(), "default-env-key");

    const good = resolveOptions(ctx, { apiKeyEnv: "MY_JEV_OTHER_KEY" });
    assert.equal(await good.resolveApiKey(), "other-env-key");
  } finally {
    if (savedDefault === void 0) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = savedDefault;
    if (savedOther === void 0) delete process.env.MY_JEV_OTHER_KEY;
    else process.env.MY_JEV_OTHER_KEY = savedOther;
  }
});

test("a literal apiKey wins over the environment", async () => {
  const options = resolveOptions(ctx, { apiKey: "literal-key", apiKeyEnv: { ref: "MY_JEV_TEST_KEY" } });
  assert.equal(options.apiKey, "literal-key");
  assert.equal(await options.resolveApiKey(), "literal-key");
});

test("toCredentialRef degrades to null instead of throwing", () => {
  assert.doesNotThrow(() => toCredentialRef({ ref: "X" }));
  assert.doesNotThrow(() => toCredentialRef("bad name!"));
  const branded = toCredentialRef("TYPESAFE_API_KEY");
  if (branded !== null) assert.equal(typeof branded, "object");
});

test("the entry-form schema marks GUI fields volatile", () => {
  assert.ok(Config, "@deepseek-ai/schemastery is installed");
  const parsed = Config({});
  // dsh marks GUI-editable fields volatile, so the raw field is a reference...
  assert.equal(typeof parsed.apiKeyEnv, "object");
  assert.equal(parsed.apiKeyEnv.get(), DEFAULT_API_KEY_ENV);
  assert.equal(parsed.autoGuard.denyThreshold.get(), 0.85);
  // ...and normalizeConfig is what turns it back into a plain value.
  const plain = normalizeConfig(parsed);
  assert.equal(plain.apiKeyEnv, DEFAULT_API_KEY_ENV);
  assert.equal(plain.enabled, true);
  assert.equal(plain.autoGuard.enabled, false);
  assert.equal(plain.autoGuard.denyThreshold, 0.85);
  assert.equal(plain.autoGuard.tools.length, 4);
  assert.equal(plain.dashboard.basePath, "/jev");
  assert.equal(plain.timeoutMs, 15000);
});

test("normalizeConfig unwraps explicit values and nested sections", () => {
  const plain = normalizeConfig(
    Config({
      apiKeyEnv: "MY_KEY",
      enabled: false,
      timeoutMs: 1234,
      autoGuard: { enabled: true, denyThreshold: 0.7 },
      dashboard: { enabled: true },
    }),
  );
  assert.equal(plain.apiKeyEnv, "MY_KEY");
  assert.equal(plain.enabled, false);
  assert.equal(plain.timeoutMs, 1234);
  assert.equal(plain.autoGuard.enabled, true);
  assert.equal(plain.autoGuard.denyThreshold, 0.7);
  assert.equal(plain.dashboard.enabled, true);
  // plain values pass through untouched
  assert.equal(unwrapField(plain), plain);
  assert.equal(normalizeConfig(null), null);
  assert.equal(normalizeConfig(7), 7);
  assert.equal(normalizeConfig("x"), "x");
});

test("a volatile config resolves end to end (regression: the jev_overview crash)", async () => {
  const saved = process.env.MY_JEV_VOLATILE_KEY;
  process.env.MY_JEV_VOLATILE_KEY = "volatile-secret";
  try {
    const options = resolveOptions(ctx, Config({ apiKeyEnv: "MY_JEV_VOLATILE_KEY", model: "jev-test", timeoutMs: 4321 }));
    assert.equal(options.model, "jev-test");
    assert.equal(options.timeoutMs, 4321);
    assert.equal(await options.resolveApiKey(), "volatile-secret");
  } finally {
    if (saved === void 0) delete process.env.MY_JEV_VOLATILE_KEY;
    else process.env.MY_JEV_VOLATILE_KEY = saved;
  }
});

/**
 * 0.7.3 … 0.8.0 regression: the schema registered with the settings service
 * marked every GUI field volatile, so schemastery resolved those fields to
 * Volatile references. dsh ships `registration.resolved` verbatim, JSON turns a
 * reference into {}, and the GUI's own bundled schemastery 3.18.2 rejected the
 * payload — "$.enabled expected boolean but got [object Object]" — so its card
 * kept an empty draft and rendered "未配置" with every field blank.
 */
test("the registered settings schema resolves to plain, JSON-safe values", () => {
  assert.ok(SettingsConfig, "settings schema present");
  const parsed = SettingsConfig({ autoGuard: { enabled: true, denyThreshold: 0.8 } });
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.apiKeyEnv, DEFAULT_API_KEY_ENV);
  assert.equal(parsed.timeoutMs, 15000);
  assert.equal(parsed.apiKey, void 0);
  assert.equal(typeof parsed.autoGuard.denyThreshold, "number");
  assert.equal(parsed.autoGuard.denyThreshold, 0.8);
  // the exact payload the server puts on the wire: plain JSON that must still
  // validate against the very schema the GUI rehydrates
  const wire = JSON.parse(JSON.stringify(parsed));
  for (const [key, val] of Object.entries(wire)) {
    assert.notDeepEqual(val, {}, key + " must not serialize to an empty object");
  }
  assert.doesNotThrow(() => SettingsConfig(wire), "the wire payload must re-validate");
  assert.equal(SettingsConfig(wire).autoGuard.denyThreshold, 0.8);
});

test("a registered-schema value stays plain through a save round-trip", () => {
  // The settings service re-resolves on every read, so a saved value reaches
  // the plugin without a restart — which only holds while the registered
  // schema hands back plain values instead of volatile references.
  const parsed = SettingsConfig({ enabled: false });
  assert.equal(parsed.enabled, false);
  assert.equal(normalizeConfig(parsed).enabled, false);
  assert.equal(SettingsConfig({ enabled: true }).enabled, true);
});

