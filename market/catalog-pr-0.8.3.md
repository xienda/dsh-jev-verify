## What

Refreshes the entry for `xienda/dsh-jev-verify` to match the plugin as of **v0.8.3** (npm). One file
changes: `data/plugins/xienda__dsh-jev-verify.yml` — no other entry is touched.

v0.8.3 fixes a silent settings bug and the entry now describes it.

- **Saving settings did nothing.** The Settings > Plugins card handed dotted field names to the settings
  scope, whose `set(field)` stores a single-segment path, so `dashboard.basePath` was written as one
  literal key that no schema resolves — the save reported success and every reader kept using the schema
  default. Observed live: the `user` layer held `"autoGuard.maxJevCallsPerSession": 60` and
  `"dashboard.basePath": "jev"` while the resolved document still showed `50` and `/jev`.
- **Nested, atomic writes.** The card now commits `{op:"set", path:[<segment>, …]}` operations in one
  `scope.mutate(ops)` call, with a chained-`set` fallback for hosts that expose no `mutate`.
- **One-time repair.** Opening the card rewrites documents written by <= 0.8.2 that contain literal dotted
  keys (set the nested path, unset the literal key, one atomic mutation, once per scope, wrapped so a
  failure cannot break the card).
- Client-only change: a page refresh applies it, no harness restart.

This PR also repairs a YAML defect in the 0.8.2 revision of this entry that shipped earlier: the `en`
scalar had lost its closing quote, which folded the `zh` key into the English string. Both scalars are
properly quoted here.

`url`, `name` and `category` are unchanged, and every earlier claim (six tools, two-tier
position-aware guard, always-on ledger, concurrency-6 verification, usage/quota panel with its stated
boundary, measured latency bands, the 0.8.1 settings-card fix, the 0.8.2 status page and composer pill)
stays exactly as written.

## Why

A settings surface that accepts a value, reports success and silently discards it is worse than one that
refuses: the user has no way to tell. The fix is small, but the entry should say that saves now land, and
that documents written by older versions are repaired on first open.

## Verification of the claims

- `npm test` → **29/29 passing** (2725.8 ms). `test/client.test.mjs` PASS 7 asserts path splitting, the
  generated nested operations with numeric coercion, exactly one atomic repair mutation and its operation
  order, no repeat on a second render, and zero writes for an already-nested document.
- Live host evidence (2026-10-07): `/jev` → 200 status page, `/jev/` → 200, `/jev/api/usage` → 200
  pill payload, `/jev/api` → 404 as designed with the board off; the served bundle carried 0.8.2, so the
  client half updates on a page refresh.
- The settings document was read over the `settings/describe` RPC; the decoded value contains no
  empty-object paths and reports `apiKeyEnv: "TYPESAFE_API_KEY"`, which is what the 0.8.1 fix claimed.
- The 0.7.5 live benchmark (96.3%, 26/27, median 282 ms, p95 1468 ms, ~$0.000365) is unaffected.

Update to an existing entry, submitted by the plugin author.
