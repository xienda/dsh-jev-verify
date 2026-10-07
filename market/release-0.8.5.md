# dsh-jev-verify 0.8.5

**The ledger survives a restart, the remainder is honest, and a new tool does the paperwork.**

0.8.5 answers a real session complaint ("the panel still shows nothing, and there is
no remaining balance") and turns the plugin from something you must remember to call
into something that does a whole batch of judgments in one shot.

## 1. The ledger survives a restart

The local ledger now persists to `$DSH_HOME/jev-usage.json` **by default** (`quota.persist`
defaults to true), so the cumulative total no longer resets with the host.

Two real bugs behind the old silent zero were found and fixed:

- the ledger path only honoured `DSH_HOME`; the host process does not export it, so
  `defaultUsageFile()` returned `null` and persistence was **silently disabled**. It now
  falls back to `%USERPROFILE%\.dsh\jev-usage.json`.
- `save()` ran before the first `load()` (it is triggered by the first `record()` of a new
  process), so it wrote the still-empty in-memory ring over the real history file, and the
  follow-up write was then swallowed by the 3 s debounce. `save()` now loads first, and
  `configure()` only writes when it actually has data.

A restart round-trip probe (record 3 entries, build a new module, read back) returns
`today=3 / all=3` and the same per-tool and per-kind breakdown.

## 2. Remaining is derived, never invented

TypeSafe exposes **no balance endpoint**: `/v1/usage`, `/v1/quota`, `/v1/account`,
`/v1/account/balance`, `/v1/balance`, `/v1/credits`, `/v1/billing`, `/v1/me`, `/v1/limits`
and a dozen more all return 404, and only `/v1/models` answers — with no balance headers.
So the panel derives the remainder instead:

```
remaining = quota.declaredBalanceUsd - locally measured spend since quota.balanceSince
```

Set those two fields in Settings → Plugins → Jev and the pill leads with
`Jev · 剩余 $4.9997 · 今日 3 次`. Without them it says plainly that it cannot be fetched
instead of printing a number.

## 3. `jev_batch` — one set of judgments over many texts

New module `lib/batch.js`, and a seventh tool:

- 1–20 items × 1–5 questions, **one real API call per item**, 4-way concurrency by
  default (6 max)
- returns a paste-ready markdown table, sortable by a judged dimension
  (`auto` sorts descending only when the single question is a score)
- built-in `sentiment` / `priority` / `intent` / `pii` / `spam` presets, or your own
  questions in the `jev_decision` shape
- a failed row is reported as failed with the raw error — never guessed — and if every
  row fails the tool throws the first error
- every row is metered separately (`kind: "batch"`), so N items really are N calls and N costs

Live end-to-end (`bench/batch-e2e.mjs`, real API, 3 + 2 items, 5 calls, ≈$0.0000744):
sentiment over three Chinese feedback lines sorted 2/4 (100%), 1.23/4, 0.93/4 in 708 ms
wall; then `has_pii` + `urgency` over two texts gave 100%/0.53 and 1%/0.01 in 261 ms.

## 4. Smaller honest fixes

- the composer pill re-reads every **20 s** instead of 60 s
- the collapsed pill leads with the remainder once a balance is declared, and the
  cumulative row is renamed when the ledger is on disk
- tests are isolated from the real ledger (`test/_isolate.mjs` points `DSH_HOME` at a temp
  dir); 12 fixture lines a previous test run had appended to the real
  `~/.dsh/jev-roll.jsonl` were removed

## Tests

`npm test` → **37/37** (~2.5 s): new `test/batch.test.mjs` (7 cases), new balance and
restart assertions in `test/usage.test.mjs`, pill/balance cases in `test/client.test.mjs`,
and the tool count moved to seven across boot/compat/present/toolview.

## Scope

- **Client half** (pill, cards): refresh the page.
- **Server half** (persistence, remainder, `jev_batch`): restart the host.
