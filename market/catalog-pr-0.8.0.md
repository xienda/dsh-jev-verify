## What

Refreshes the entry for `xienda/dsh-jev-verify` to match the plugin as of **v0.8.0** (npm). One file changes: `data/plugins/xienda__dsh-jev-verify.yml` — no other entry is touched.

v0.8.0 adds a **usage/quota panel** and states its boundary precisely. The entry now lists **six** tools and the new surfaces:

- **`jev_usage` (new) — a usage/quota panel that reports only what this machine measured.** Every decision, choice, verification and guard event is recorded locally with measured input/output tokens, cost, latency, question-type mix and tool name. The tool returns rolling windows (today / 7 d / 30 d / all / session), a daily call and cost series, a projected daily burn rate ("at this pace the daily limit is reached in N h"), a per-day sparkline, the per-tool mix, and optional hard budgets (`quota.dailyCallLimit`, `quota.dailyCostLimitUsd`, `quota.sessionCallLimit` with `quota.warnAtPercent`). It reads local state only — it makes no API call.
- **The honest boundary is in the entry, not just the docs.** TypeSafe publishes no balance or quota endpoint: `GET /v1/usage`, `/v1/quota`, `/v1/account`, `/v1/me`, `/v1/balance`, `/v1/credits`, `/v1/limits`, `/v1/billing`, `/v1/subscription`, `/v1/plan`, `/v1/user`, `/v1/health` all return **404** (only `/v1/models` answers, with `jev-latest` and `jev-preview`). So the panel says exactly that it is locally measured usage against locally configured budgets, in the tool description, the text result, the card and the README — it never invents a provider-side balance.
- **`quota.enforce` is an opt-in hard stop.** With `quota.enabled` + `quota.enforce`, a call that would cross a configured budget is refused *before* the API request, naming the budget; default behaviour is display-only. History is in-memory (400 samples) unless `quota.persist: true`, then up to `quota.historyDays` (default 30) days are kept in `$DSH_HOME/jev-usage.json` (atomic tmp+rename, fail-open).
- **Surfaced in four places**: the in-chat `usage` view (status/threshold/reset chips, eight stats, three budget meters, sparkline, per-tool breakdown, boundary note at the bottom), a usage chip row inside `jev_overview`, a quota section on the optional `/jev` board (`dashboard.enabled`) with bars and a 30-day trend, and a fifth group in the Settings > Plugins card.
- **`jev_verify` accounting.** The 27-question run now records its 27 calls, input/output tokens and cost in the ledger, so a verification run finally shows up in the panel.

`url`, `name` and `category` are unchanged. The 0.7.5 claims (two-tier position-aware guard, honest always-on ledger, concurrency-6 verification, measured latency bands) stay as they were.

## Why

Users asked how much Jev has been used and what it cost, and the comparable DSH quotas panels all answer that question well. This entry describes the plugin’s answer with its real limit stated up front: there is no provider balance endpoint to read, so the panel measures locally and says so. The alternative — a panel that displays an invented or silently-stale number — is exactly the kind of dishonest surface this plugin refuses to ship.

## Verification of the claims

- `npm test` → **28/28 passing** (2540 ms). The new `test/usage.test.mjs` covers the empty state and the honest note, token-to-cost accounting, a 27-call batch (27 calls counted, guard events counted separately), quota status and all three hard-stop paths, persistence with day-boundary pruning, reload from the same file, reset, and every formatter; `test/toolview.test.mjs` renders the new `usage` view; boot/compat tests assert all six tools and the new volatile quota fields.
- **Cost constant cross-checked against real measured data:** the 0.7.5 live run measured 8,696 input tokens; at `$0.042 / 1e6` that is **$0.000365232** (≈$0.000365), matching the published report. The panel derives cost from measured tokens with that same constant — no estimation.
- **Live benchmark (2026-10-04, concurrency 6, `bench/bench.mjs` against `https://api.typesafe.ai/v1/systemone`):** 96.3% (26/27), median 282 ms, p95 1468 ms, 8696 input + 822 output tokens ≈ $0.000365, wall 3999 ms (serial 10.07 s); report `bench/results/2026-10-04T12-40-07-421Z.json`. The plugin’s verification numbers were not changed by this release.
- **Endpoint boundary reproduced on 2026-10-05:** `POST /v1/systemone` without a `model` field returns 422 (`missing: [body, model]`) and returns 200 with it (response carries `x-typesafe-request-id`); `GET /v1/models` returns `jev-latest` and `jev-preview`; every account/usage/quota/credit/billing path tested returned 404.
- The in-chat, overview, board and settings surfaces were exercised by the render test suite, plus a real-profile restart check after the release (the server half needs one harness restart; the client half only a refresh).

Update to an existing entry, submitted by the plugin author.