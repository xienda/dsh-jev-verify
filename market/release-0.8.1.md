# dsh-jev-verify v0.8.1

**The Settings > Plugins card now tells the truth: a configured key is never reported as "unconfigured".**

## The bug

Symptom: `~/.dsh/.env` holds `TYPESAFE_API_KEY`, and the in-chat `jev_overview` reports
`API Key 已配置`, but Settings > Plugins > Jev showed a **未配置 (unconfigured)** badge with every
field blank — as if nothing had ever been saved. Saving from the card looked like it did nothing.

Root cause, located layer by layer on a live host (dsh 0.1.5-rc.2):

1. The settings service publishes the resolved value verbatim
   (`@deepseek-ai/dsh-settings/lib/index.js:364` `value: registration.resolved`); nothing simplifies it.
2. The schema this plugin registered marked its GUI fields with the `volatile` marker. The host resolves
   `@deepseek-ai/schemastery` at **3.18.4**, whose resolver (`src/index.ts:769`) turns every marked field
   into a live reference object: `schema.meta.volatile ? createVolatile(...) : default`.
3. So the value on the wire was `{"enabled":{},"apiKey":{},"apiKeyEnv":{},"quota":{"enabled":{},…}}`.
4. The GUI carries its own older, vendored schemastery (**3.18.2**) with no `volatile` support at all, so
   `decode()` (`dsh-client-ui-settings/lib/client.js:1107-1117`) failed its validation — the real error was
   `$.enabled expected boolean but got [object Object]` — returned `undefined`, and the draft stayed empty.
5. The card therefore read `value === {}` and had no key to show.

The plugin's own config reads were never affected: `normalizeConfig` unwraps those references, which is
why judgments, the guard and `jev_usage` kept working the whole time. Only the human-facing card was blind.

## The fix

- **One field definition, two schemas.** `buildConfig()` builds both `Config` (entry form; keeps the
  volatile marker for hosts that understand it) and `SettingsConfig` (plain — the one registered with the
  settings service). The 23 fields cannot drift apart.
- **The card no longer depends on a single decode path.** If the decoded value comes back empty it reads the
  raw `base`/`user` layers the service already sends, shows an explicit note that the server value could
  not be decoded (schema-generation skew), and stays fully editable and savable.
- **A credential reference is not the same as "configured".** The badge has three honest states: a literal
  key that was saved, `环境变量 <NAME>` (a reference, unverified), or none.

## Verification

Wire probe against the **deployed** module (`_wire_probe.mjs`, 2026-10-06):

| schema | empty-object fields on the wire | `apiKeyEnv` | GUI decode |
| --- | --- | --- | --- |
| `Config` (entry form only) | 8 + every `quota.*` | `{}` | **FAILS** — `$.enabled expected boolean but got [object Object]` |
| `SettingsConfig` (registered) | none | `"TYPESAFE_API_KEY"` | **passes** |

- `test/config.test.mjs` — the registered schema resolves to plain, JSON-safe values; a save round-trip
  stays plain.
- `test/compat.test.mjs` PASS 1b — `volatilePaths(SettingsConfig)` must be empty; wire probe asserts
  `enabled === true` and `apiKeyEnv === "TYPESAFE_API_KEY"`.
- `test/client.test.mjs` PASS 4 — a mini-renderer drives the real card against a snapshot whose decoded
  value is empty; the badge text must be `环境变量 TYPESAFE_API_KEY` and the tree must never contain
  `未配置`.
- `npm test` → **29/29 passing** (2473 ms).

Nothing else changed: six tools, the guard tiers, the prompt section, the usage/quota panel and every
measured number from 0.7.5/0.8.0 are exactly as published.

## Upgrading

`npm i dsh-jev-verify@0.8.1`. The server half (the registered schema) needs a harness restart; the client
half only needs a page refresh.
