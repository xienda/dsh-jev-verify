## What

Refreshes the entry for `xienda/dsh-jev-verify` so it matches the plugin as of **v0.7.2** (npm). One file changed: `data/plugins/xienda__dsh-jev-verify.yml` — no other entry is touched.

The description now also covers:

- `jev_overview` and `jev_guard_status` (usage + auto-guard auditing), alongside `jev_decision` / `jev_verify`;
- structured in-chat views for all four tools (a `presentationMeta` projection: answers, confidence bars, latency, cost, guard counters, benchmark report);
- the full Settings > Plugins card covering every option (credentials, tool toggles, the whole auto-guard block, dashboard);
- the benchmark claim restated against the code: `lib/cases.js` holds **27 labeled questions** (27 cases, guard verdicts included), 96.3% (26/27), measured 2026-09-21 and re-measured 2026-09-28.

## Why

The previous wording predated `jev_overview` / `jev_guard_status`, the in-chat views and the full settings card, and its latency figure came from the 2026-09-21 run only. `url`, `name` and `category` are unchanged.

## Verification of the claims

- `dsh-jev-verify@0.7.2` is on npm; `npm test` → 19/19 passing.
- Live benchmark (2026-09-28): 96.3% (26/27, the same single recorded boundary miss as the 2026-09-21 run), 8,696 input tokens ≈ $0.000365, median 484 ms (network-dependent; 283 ms on 2026-09-21) — terminal log `bench/run4.log`, report `docs/verification.md`.
- Reproduce with `TYPESAFE_API_KEY=... node bench/bench.mjs` (zero-dependency CLI).

Update to an existing entry, submitted by the plugin author (fork branch `chore/jev-desc-0.7.2`, based on current `main`).
