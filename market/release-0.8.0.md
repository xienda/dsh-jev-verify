# dsh-jev-verify v0.8.0

**Jev usage, measured — and an honest quota panel.**

## What's new

### `jev_usage`: a usage/quota panel you can call

Every `jev_decision`, `jev_choose`, `jev_verify` and guard event is now recorded locally with its
measured input/output tokens, estimated cost, latency, question-type mix and tool name. `jev_usage`
turns that into:

- rolling windows **today / 7 days / 30 days / all / session**;
- calls, input/output tokens, estimated cost, latency median and p95, per-question-type and per-tool mix;
- a **projected daily burn rate** — "at this pace the daily call limit is reached in N h";
- a **per-day sparkline** over the retained history;
- an optional **hard stop** (`quota.enforce`): a call that would cross a configured budget is refused
  *before* the API request, with a message naming the budget. Display-only by default.

### The honest boundary, stated everywhere

TypeSafe publishes **no balance or quota endpoint**. Reproduced 2026-10-05: `GET /v1/usage`,
`/v1/quota`, `/v1/account`, `/v1/me`, `/v1/balance`, `/v1/credits`, `/v1/limits`, `/v1/billing`,
`/v1/subscription`, `/v1/plan`, `/v1/user`, `/v1/health` and `/v1/` all return **404**; only
`/v1/models` answers (`jev-latest`, `jev-preview`). A panel that showed a number from nowhere would be
exactly the kind of surface this plugin refuses to ship, so the panel reports **only what this machine
measured**, against limits **you** set: `quota.dailyCallLimit`, `quota.dailyCostLimitUsd`,
`quota.sessionCallLimit` and `quota.warnAtPercent`. The boundary is printed in the tool description,
the text result, the in-chat card and the README.

### Four surfaces

- **In the conversation** — a `usage` tool view: status / threshold / reset-countdown chips, eight stats,
  three budget meters, the daily sparkline, the per-tool breakdown and the boundary note at the bottom.
- **`jev_overview`** — a usage chip row (status, today's calls against the limit, today's cost, whether
  the hard stop is armed).
- **The optional `/jev` board** (`dashboard.enabled: true`) — a quota section with bars, projections and a
  30-day trend.
- **Settings > Plugins** — a new "usage/quota" group for every option, with numeric validation.

### Persistence

In-memory by default (a 400-sample ring). Set `quota.persist: true` to keep up to `quota.historyDays`
(default 30, range 1–365) days of daily history in `$DSH_HOME/jev-usage.json` — written atomically
(tmp + rename) and fail-open: a panel problem can never break a judgment call.

### Also in this release

- `jev_verify` now records its 27 calls, tokens and cost in the ledger instead of only the accuracy text.
- Cost accounting uses one injected constant (`$0.042` per million input tokens, output free) everywhere,
  including the dashboard playground; no hard-coded copy remains.
- Six tools, all registered and covered by boot/compat tests: `jev_decision`, `jev_choose`, `jev_usage`,
  `jev_overview`, `jev_guard_status`, `jev_verify`.

## Verification

- `npm test` → **28/28 passing** (2,540 ms). New `test/usage.test.mjs` covers the empty state and its
  honest note, token-to-cost accounting, a 27-call batch (guard events counted separately, not as calls),
  quota status and all three hard-stop paths, persistence with day-boundary pruning, reload, reset, and
  every formatter.
- **Cost constant cross-checked against real measurements:** 8,696 input tokens × $0.042 / 1e6 =
  **$0.000365232** ≈ $0.000365 — the same figure the 0.7.5 live report published. The panel derives cost
  from measured tokens with that constant; it does not guess.
- **Live benchmark (2026-10-04, concurrency 6):** 96.3% (26/27), median 282 ms, p95 1468 ms, 8,696 input +
  822 output tokens ≈ $0.000365, wall **3999 ms** versus 10.07 s serial (2.52×); report
  `bench/results/2026-10-04T12-40-07-421Z.json`.
- The guard audit from 0.7.5 still holds: two deterministic tiers (7 hard, position-aware + 3 soft), a
  Jev backstop, `onSafetyDeny` / `onLoopAdvisory` reported with the tool name, fail-open on Jev failure.

## Upgrade notes

- **Server half needs one harness restart** (the tool, the settings group and the ledger live in the
  server plugin). The **client half only needs a page refresh**.
- Fully backwards compatible: all new options have defaults (`quota.enabled: true`, `quota.enforce: false`,
  `quota.persist: false`), so an existing config keeps working unchanged and the panel starts out
  display-only.
- Tier-9 pipeline patch: npm `dsh-jev-verify@0.8.0`.

## Links

- npm: https://www.npmjs.com/package/dsh-jev-verify
- Repository: https://github.com/xienda/dsh-jev-verify
- Verification report: [docs/verification.md](https://github.com/xienda/dsh-jev-verify/blob/main/docs/verification.md)