## What

Refreshes the entry for `xienda/dsh-jev-verify` to match the plugin as of **v0.8.1** (npm). One file changes:
`data/plugins/xienda__dsh-jev-verify.yml` — no other entry is touched.

v0.8.1 fixes a real, user-visible defect in the plugin's own Settings > Plugins card, and the entry now
states how the card resolves credentials.

- **The card no longer reports a configured key as "unconfigured".** The schema registered with the settings
  service used to carry `volatile` markers meant only for the entry-form generation. On a host whose
  schemastery understands that marker (3.18.4) each marked field resolves to a live reference object, and the
  settings service publishes the resolved value verbatim — so the value on the wire was
  `{"enabled":{},"apiKeyEnv":{},"quota":{"enabled":{},…}}`. The GUI's own, older bundled schemastery (3.18.2)
  could not decode it (`$.enabled expected boolean but got [object Object]`), the card fell back to an empty
  draft, and the user saw `未配置` over a key that was configured and in active use.
- **One field definition, two schemas.** `Config` (entry form, keeps the marker) and `SettingsConfig`
  (plain — the registered one) are both produced by `buildConfig()`, so the 23 fields cannot drift.
- **The card also survives decode skew.** When the decoded value is unavailable it reads the raw
  `base`/`user` layers the service already sends, says so on the card, and stays editable/savable.
- **Three honest credential states** in the badge: a literal saved key, `环境变量 <NAME>` (a reference —
  unverified), or none.

`url`, `name` and `category` are unchanged, and every 0.7.5 / 0.8.0 claim (two-tier position-aware guard,
always-on ledger, concurrency-6 verification, usage/quota panel with its boundary, measured latency bands)
stays exactly as written.

## Why

The card is how a human configures the plugin, and it was lying about its own state: with a working key the
badge said `未配置` and every field looked empty. The plugin's honest-design rule is that it never claims
more — or less — than what it can verify; a status badge that contradicts the tools' own `API Key 已配置`
readout is a bug of that same kind, so it is fixed rather than described around.

## Verification of the claims

- `npm test` → **29/29 passing** (2473 ms). `test/config.test.mjs` asserts the registered schema resolves to
  plain, JSON-safe values through a save round-trip; `test/compat.test.mjs` PASS 1b asserts
  `volatilePaths(SettingsConfig)` is empty and that `enabled === true` / `apiKeyEnv === "TYPESAFE_API_KEY"` on
  the wire; `test/client.test.mjs` PASS 4 renders the real card through a mini-renderer against a snapshot
  whose decoded value is empty and asserts the badge names the configured reference while `未配置` appears
  nowhere in the tree.
- **Wire probe against the deployed module (2026-10-06, dsh 0.1.5-rc.2):** the entry-form `Config` still
  wraps 8 fields plus every `quota.*` (GUI decode FAILS as before, unchanged and not registered); the
  registered `SettingsConfig` produces **no** empty-object field, with `apiKeyEnv="TYPESAFE_API_KEY"`,
  `enabled=true`, `autoGuard.denyThreshold=0.8`, and the GUI decode **passes**.
- The in-chat, overview, board and settings surfaces remain covered by the render suite; the 0.7.5 live
  benchmark (96.3%, 26/27, median 282 ms, p95 1468 ms, ≈$0.000365) is unaffected by this release.

Update to an existing entry, submitted by the plugin author.
