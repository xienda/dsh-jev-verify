## What this updates

Refreshes the `xienda/dsh-jev-verify` entry from the 0.7.x text that is currently on `main` to **v0.8.5** (published to npm as `dsh-jev-verify@0.8.5`, tagged `v0.8.5`).

Only `data/plugins/xienda__dsh-jev-verify.yml` changes. `url`, `name` and `category` are unchanged, and the description scalars stay single-quoted so the YAML parses (verified with js-yaml before pushing).

## What is actually new since the entry on main

- **Seven tools, not one.** `jev_decision` (1–25 parallel atomic verdicts in a single call), `jev_choose` (rank 2–10 approaches), the new `jev_batch` (one set of 1–5 judgments over 1–20 texts — one real call per text, bounded concurrency, paste-ready sortable table, built-in sentiment/priority/intent/pii/spam presets, failed rows reported as failed and never guessed), `jev_usage`, `jev_overview`, `jev_guard_status` and `jev_verify`.
- **The local usage ledger now persists by default** (`$DSH_HOME/jev-usage.json`), so the cumulative total no longer resets when the host restarts. Two real bugs were fixed for this: the ledger path only honoured `DSH_HOME` (absent in the host process, so persistence was silently disabled), and `save()` wrote an empty in-memory ring over the history file because it ran before the first `load()`.
- **Remaining balance is derived, never invented.** TypeSafe exposes no balance endpoint — `/v1/usage`, `/v1/quota`, `/v1/account`, `/v1/account/balance`, `/v1/balance`, `/v1/credits`, `/v1/billing`, `/v1/me`, `/v1/limits` and a dozen more all return 404, and only `/v1/models` answers, with no balance headers. So the panel shows `quota.declaredBalanceUsd` minus locally measured spend since `quota.balanceSince`, and says plainly that it cannot be fetched when nothing is declared.
- The composer pill re-reads every 20 s (was 60 s), the panel no longer implies a quota that does not exist, the auto-guard's own Jev verdicts are metered, and auto-triage judges each turn's first step.

## Verification

- `npm test` → **37/37** passing (~2.5 s), including the new `test/batch.test.mjs` (7 cases).
- Live end-to-end against the real API (`bench/batch-e2e.mjs`): 5 real calls, ≈$0.0000744; sentiment over three Chinese feedback lines returned 2/4 (100%) / 1.23/4 / 0.93/4 in 708 ms wall, and `has_pii` + `urgency` over two texts returned 100%/0.53 and 1%/0.01 in 261 ms.
- Published: npm `dsh-jev-verify@0.8.5`, git tag `v0.8.5`, GitHub release [v0.8.5](https://github.com/xienda/dsh-jev-verify/releases/tag/v0.8.5).

## Housekeeping

This supersedes the earlier entry PRs by the same author (**#6565**, **#6747**, **#6748**), which have been closed so the queue stays current. Happy to squash or amend anything a maintainer would prefer.
