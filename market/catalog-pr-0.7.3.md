## What

Refreshes the entry for `xienda/dsh-jev-verify` so it matches the plugin as of **v0.7.3** (npm). One file changed: `data/plugins/xienda__dsh-jev-verify.yml` — no other entry is touched.

The description now also covers:

- `jev_choose`, the new tool in v0.7.3: rank 2-10 candidate approaches with calibrated per-option scores (fit score 0-3 + risk noul) issued in parallel, sorted by an explicit composite and returned with a recommended pick;
- `jev_overview` and `jev_guard_status` (usage + auto-guard auditing), alongside `jev_decision` / `jev_verify` (now five tools with structured in-chat views each: answers, confidence, latency, cost, guard counters, benchmark report);
- the full Settings > Plugins card covering every option (credentials, tool toggles, the whole auto-guard block, dashboard);
- the benchmark claim restated against the code: `lib/cases.js` holds **27 labeled questions** (27 cases, guard verdicts included), 96.3% (26/27), measured 2026-09-21 and re-measured 2026-09-28.

## Why

The previous wording predated `jev_choose` (and still predated the in-chat views / settings-card wording from 0.7.2). `url`, `name` and `category` are unchanged.

## Verification of the claims

- `dsh-jev-verify@0.7.3` is on npm; `npm test` → 26/26 passing (7 new `counsel` cases + a new `toolview` choose-rendering case on top of the previous 19).
- Live E2E for `jev_choose` (2026-09-29): three real candidate options scored against `https://api.typesafe.ai/v1/systemone`; the high-risk option correctly crushed (fit 0.1/3, risk 89%, composite 0.4%) and the recommended pick reproduced consistently across runs — see `docs/verification.md` (2026-09-29 section).
- Live benchmark (2026-09-28): 96.3% (26/27, the same single recorded boundary miss as the 2026-09-21 run), 8,696 input tokens ≈ $0.000365, median 484 ms (network-dependent; 283 ms on 2026-09-21) — terminal log `bench/run4.log`, report `docs/verification.md`.
- Reproduce with `TYPESAFE_API_KEY=... node bench/bench.mjs` (zero-dependency CLI); `bench/choose-e2e.mjs` for the choose flow.

Update to an existing entry, submitted by the plugin author (fork branch `chore/jev-desc-0.7.3`, based on current `main`).
