# dsh-jev-verify

Jev — TypeSafe AI's **System One** decision model — as a first-class plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

Jev does not generate text. Given a `state` plus typed questions it returns
**typed answers with calibrated probabilities** in one parallel API call
(~70–500 ms published; in our runs median 266–484 ms and p95 825–1468 ms; single-run maxima reach ~1.5 s and ~5 s under a loaded network). This plugin exposes that as agent tools, adds an
opt-in **auto-guard** (risk + loop checks), an honest local
**usage/quota panel**, and makes sure the claims are
*verified, not trusted blindly*:

| Tool | What it does | Call it when |
| --- | --- | --- |
| `jev_decision` | Up to 25 typed questions (`choice` / `score` / `noul`) about one `state`, answered **in parallel in one call** (published ~70–500 ms; measured median 266–484 ms and p95 825–1468 ms across our runs, with single-run maxima of ~1.5–5 s depending on network load). Every answer carries a calibrated confidence and probabilities; the result also reports model, latency, token usage and estimated cost. | You need fast, repeatable **verdicts** instead of prose: classification/labeling, routing or triage, priority/severity/satisfaction scoring, spam/toxicity/PII checks, intent or truth checks, extracting structured tags. Batch related judgments into one call — parallel, no extra latency. |
| `jev_choose` | Ranks 2–10 candidate options/approaches: each gets a fit score 0–3 and a risk noul, combined into a composite `fit/3 × (1−risk)`; returns an ordered table, a recommended pick, and per-option latency/cost. | Several independent approaches are on the table at a fork and you want a calibrated tiebreaker before deciding. Jev scores, it never explains — the reasoning stays yours. |
| `jev_batch` | Runs **one set** of 1–5 judgments over 1–20 texts: one real call per text (4-way concurrency by default, 6 max), returning a paste-ready markdown table sortable by a judged dimension; built-in `sentiment` / `priority` / `intent` / `pii` / `spam` presets, or your own questions in the `jev_decision` shape. | A batch of tickets/comments/logs/feedback needs labeling, classification, prioritization or PII/spam screening, or several candidates need ranking on one dimension — the tool for "many texts, same judgments"; never hand-roll one `jev_decision` per item. Each text is its own real call, and a failed row says 失败 with the raw error instead of guessing. |
| `jev_verify` | Runs the frozen 27-question labeled benchmark (urgency, spam, toxicity, personal data, routing, intent, search type, priority, severity, satisfaction, guard verdicts) against the **live** API at concurrency 6 (measured 4.96 s wall for all 27 calls in 0.7.5 and 3.999 s on a re-run, versus 10.1 s serial): accuracy overall and on the high-confidence subset, median/p95/min/max latency, calibration, tokens, cost, and every mislabeled case (total plus the high-confidence ones). | Endpoint health check, model-version comparison, or a regression check — never routinely: one run is 27 real API calls (~8.7K input tokens, ≈$0.0004). |
| `jev_guard_status` | Read-only audit of the auto-guard: deterministic rules and the Jev backstop counted separately (`checks` / `jevCalls` / `denied` / `deterministicDenied` / `auditCalls`), guarded tool names, `denyThreshold`, loop-check counts, remaining session budget. | Confirm the guard is armed, see how often it actually fired, or explain why a command was blocked. When the guard is off it says so instead of reporting zeros. |
| `jev_overview` | Read-only snapshot of this session's Jev ledger: recent decisions and choices with confidence, latency median & p95, question-type mix, guard events, cumulative tokens and cost, plus key/guard/threshold status. | The user asks what Jev has done, blocked or spent — or you need endpoint and budget state without restarting the session. The ledger starts at plugin-instance lifetime; guard counts live in `jev_guard_status`. |
| `jev_usage` | Locally measured Jev usage and (optional) local budgets: rolling windows (today / 7 d / 30 d / all / session), calls, input/output tokens, estimated cost, latency median & p95, question-type and per-tool mix, a projected daily burn rate, and — with `quota.enabled` + `quota.enforce` — a hard stop before the API call. | The user asks how much Jev has been used or what it cost, or you want to check a budget before a batch of judgments. Reads only local state — no API call. TypeSafe has no balance endpoint, so this is measured local usage, not provider credit. |

**Auto-guard mode** (opt-in `autoGuard.enabled`): before shell-like tool calls
(`bash`/`pwsh`/`run_code`/`terminal`), a free deterministic layer runs first.
Seven **hard** rules block catastrophic, irreversible operations — recursive
deletion of a filesystem, drive or directory tree, disk formatting, database
destruction, credential exfiltration, force-pushed git history — and three
**soft** rules (host restart / power-off, git-history rewrites short of a force
push, always-true DELETE/UPDATE conditions) are handed to **Jev** (risk noul ≥
threshold ⇒ deny). Hard patterns only fire in *executable position*, so quoting
or documenting a dangerous command is never blocked, and a hard match found
elsewhere is downgraded to a Jev-judged hint. Jev failure is fail-open with a
warning. A loop guard evaluates repeated same-tool calls for semantic stalls and
injects advice instead of blocking. Every verdict is recorded in the session
ledger and auditable via `jev_guard_status`.

**Honest by design** — no mock mode, no silent fallback:

- without a `TYPESAFE_API_KEY`, tools and guard fail with explicit setup instructions (the guard fails open with a warning — it never silently pretends to have checked);
- every `jev_decision` result includes the model, latency and token usage, so each call is auditable;
- `jev_verify` refuses to report numbers it did not measure;
- the benchmark CLI (`bench/bench.mjs`) is dependency-free and reproducible with any key.

## What's new in 0.8.5

"Remaining" finally has an honest source — the balance you declare, minus locally measured spend — instead of a number something made up.

- **A restart no longer zeroes the total.** `quota.persist` now defaults to **true**: the ledger is written to `$DSH_HOME/jev-usage.json`, falling back to `~/.dsh/jev-usage.json` when the host leaves `DSH_HOME` empty (that missing fallback was the root cause of the cumulative total always reading 0).
- **Remaining = declared − measured.** TypeSafe exposes no balance endpoint at all (`/v1/usage`, `/v1/quota`, `/v1/account`, `/v1/balance`, `/v1/credits`, `/v1/billing`, `/v1/me`, `/v1/limits`, `/v1/wallet`, even `/v1/openapi.json` all 404, and `/v1/models` carries no quota/credit headers), so the provider side cannot be read. Set `quota.declaredBalanceUsd` and `quota.balanceSince` (e.g. `2026-10-01`) and the panel prints `剩余 = 自报 $5.00 - 本机实测 $0.000004（2026-10-01 起）`; leave them empty and it says the balance was not declared rather than guessing one.
- **The pill re-reads every 20 s** (was 60 s), so a call you just made shows up while you are still looking at it.
- **The collapsed pill leads with 剩余** once a balance is declared (`Jev · 剩余 $4.9997 · 今日 3 次`), and the popover renames the cumulative row when the ledger is on disk.
- **New `jev_batch` — one call, one set of judgments, over a batch of texts, returned as a table.** 1–20 items × 1–5 questions, one real Jev call per item (4-way concurrency by default, 6 max), returning a paste-ready markdown table; `sort=auto|desc|asc|none` orders rows by a judged dimension (`auto` only when the single question is a score, descending). Built-in `sentiment` / `priority` / `intent` / `pii` / `spam` presets, or your own questions in the `jev_decision` shape. A failed row is marked 失败 with the raw error — never guessed — and every row is metered separately (`kind: "batch"`), so N items really are N calls and N costs.
- The settings card gained the two declaration fields; `npm test` is 37/37 (the new `test/batch.test.mjs` adds 7 cases: one real call per item with measured cost, the three sort modes, an unguessed failed row, a whole-batch failure that throws, preset expansion with the shared context prefix, 11 rejected argument shapes that spend no call, and the concurrency cap).
## What's new in 0.8.4

The panel stops implying a quota that does not exist, the guard's own Jev calls
finally reach the ledger, and the plugin now participates on its own.

- **No fabricated quota.** TypeSafe is a metered API with no balance endpoint. With
  no local budget configured, the pill and the status page no longer print a
  "额度正常" verdict, no longer draw percentage bars against "∞", and no longer
  show "额度重置 13 小时 41 分后" — a countdown to a budget that was never set. Without
  a budget the panel states one thing: pay-as-you-go, nothing resets, only locally
  measured usage is reported. A "本地预算重置" countdown appears only when a local
  limit really exists, and it is labelled local.
- **Money first.** The collapsed pill reads `Jev · 今日 $0.000534 · 29 次`, and the
  popover leads with today's cost and cumulative cost; call counts are secondary
  rows. Cost is what a pay-as-you-go user actually pays.
- **The guard's Jev calls are metered.** `judgeRisky`/`judgeStall` used to answer the
  guard and vanish: a session could report `safety.jevCalls: 2` in
  `jev_guard_status` while the usage ledger still read "今日调用 0 次". Both verdicts
  now report latency and token usage through an `onJevCall` event and are recorded
  as `kind: "judge"` ledger entries (`tool: "auto-guard"`).
- **Auto-triage (`autoTriage`, on by default).** On the first step of every turn one
  small Jev call (4 routing questions, ~1.5K input tokens, bounded by
  `autoTriage.timeoutMs`) classifies the request — intent, whether an atomic
  judgment is really needed, which kind, and which Jev tool serves it — and the
  advice is injected back as a plugin-sourced user message. It runs at most once
  per (agent, turn), never blocks a step, and fails open on an unknown host shape,
  a missing key, a timeout or any API error. Being metered, it is visible in the
  panel, so a working plugin no longer shows zero calls.
- **Harder guidance.** The system-prompt section now carries mandatory-trigger
  rules (classification/routing, priority/severity/satisfaction scoring, truth and
  compliance checks, structured extraction, choosing among 2-10 options), forbids
  bypassing Jev "because I already know the answer", and states the real cost
  magnitude (~$0.00002-0.0001 per call; 25 questions cost the same as 1).
- Tests: new `test/triage.test.mjs` plus extended assertions in
  `test/usage.test.mjs`, `test/client.test.mjs` and `test/guard.test.mjs`;
  `npm test` is 30/30. The client half takes effect on a page refresh; the server
  half (guard metering, auto-triage, guidance, status page) needs a host restart.

## What's new in 0.8.3

Settings you save now actually take effect.

- **Root cause.** The card handed dotted field names to `scope.set(field)`, and that
  call stores `path: [field]` — one segment. A field such as `dashboard.basePath` was
  therefore written into the settings document as a single literal key named
  `dashboard.basePath`, which no schema ever resolves. Saving reported success and
  changed nothing: on a live host `~/.dsh/settings.yaml` held the flat keys
  `autoGuard.maxJevCallsPerSession: 60` and `dashboard.basePath: jev` while the resolved
  document still showed the schema defaults (`50` and `/jev`). Found by reading the live
  document over the `settings/describe` RPC after the 0.8.2 restart.
- **Fix.** The card builds `{ op: "set", path: [<segment>, …] }` operations and commits
  them in one atomic `scope.mutate(ops)` call; it only falls back to chained
  `scope.set` on hosts that expose no `mutate`.
- **Repair on open.** A one-time mount effect rewrites documents written by <= 0.8.2 that
  contain literal dotted keys: for each one, set the nested path and unset the literal
  key, in one atomic mutation, guarded by a `WeakSet` so it runs once per scope and
  wrapped so a failed repair can never break the card.
- Client-only: **refresh the page** — no host restart. `test/client.test.mjs` PASS 7
  covers path splitting, the generated operations, the atomic repair and its idempotence.
  `npm test` is 29/29.
## What's new in 0.8.2

Two things the board got wrong, plus a usage surface that does not need the board at all.

- **`/jev` never 404s again.** `dashboard.basePath` used to be taken verbatim, so a
  value such as `jev` (no leading slash) registered the literal path `jev`, which no
  browser request ever matches. Paths are now normalized (leading slash added, trailing
  slashes trimmed, empty or `/` falls back to `/jev`) and both `/jev` and `/jev/` are
  registered. With `dashboard.enabled: false` the path still answers with a live status
  page — today's calls, cost, this instance, today's tokens and latency, quota state —
  that points at the composer pill and says how to turn the full board on, instead of a
  bare host 404.
- **`/jev/api/usage` — a small read-only JSON route** that always mounts (it does not
  wait for `dashboard.enabled`) and projects the same locally measured snapshot the
  `jev_usage` tool returns.
- **A composer usage pill** (`conversation.input.right`, beside the submit button),
  modeled on `dsh-opencode-go`: `Jev · 今日 29 次 · $0.000534` with a warn/danger tone
  dot, expanding into a 270 px popover — today's calls and cost against their limits,
  this instance's calls, today's tokens, median and p95 latency, guard denials, the top
  three tools, time to reset, last refresh and a manual refresh. It polls every 60 s and
  on tab focus, falls back to the full board API when the pill route is absent, and
  degrades to `Jev · 额度不可用` carrying the exact error — it never throws. It reports
  local measurements only, never a vendor balance; `jev_usage` in the conversation stays
  the full panel.
- Regression tests: `test/dashboard.test.mjs` covers the path normalizer, the route table
  with the board on, off and on a custom `basePath`, the 200 status page and a failing
  snapshot; `test/client.test.mjs` covers the pill payload's three shapes, the label and
  tone states, and the rendered popover text. `npm test` is 29/29.
## What's new in 0.8.1

Fixes the Settings > Plugins card that showed **未配置 / unconfigured** and blank
fields while a key *was* configured.

Root cause: the schema registered with the settings service marked the GUI fields
with the `volatile` marker. On a host whose schemastery understands it (3.18.4),
`resolve()` replaces every marked field with a live reference object, and the
settings service publishes `registration.resolved` verbatim — so the wire value
was `{"enabled":{},"apiKey":{},"apiKeyEnv":{},"quota":{"enabled":{},…}}`. The GUI
ships its own older schemastery (3.18.2), which cannot decode that
(`$.enabled expected boolean but got [object Object]`), so the card silently fell
back to an empty draft: badge "未配置", every field blank. The plugin's own reads
were unaffected (it unwraps those references), which is why judgments, the guard
and `jev_usage` kept working throughout.

- **One field definition, two schemas.** `buildConfig()` builds both `Config`
  (entry form; keeps the marker for hosts that understand it) and
  `SettingsConfig` (plain — the one registered with the settings service), so the
  23 fields cannot drift apart.
- **The card no longer trusts a single decode path.** When the decoded value is
  empty it reads the raw `base`/`user` layers the service already sends, says so
  on the card ("服务端配置值未能解码…"), and stays editable and savable.
- **A credential reference is not "configured".** The badge has three honest
  states: literal key / `环境变量 <NAME>` (unverified) / none.
- Regression tests: `test/config.test.mjs` asserts the registered schema is plain
  and JSON-safe on the wire; `test/client.test.mjs` renders the card against an
  undecodable snapshot and asserts the badge names the configured reference and
  never says 未配置. `npm test` is 29/29.

Reproduced on the wire (deployed plugin, dsh 0.1.5-rc.2, 2026-10-06):

| schema | empty-object fields on the wire | GUI decode |
| --- | --- | --- |
| `Config` (entry-form only) | 8 + every `quota.*` | FAILS — `$.enabled expected boolean but got [object Object]` |
| `SettingsConfig` (registered) | none | passes; `apiKeyEnv="TYPESAFE_API_KEY"`, `enabled=true`, `autoGuard.denyThreshold=0.8` |

## What's new in 0.8.0

The usage/quota panel: Jev usage is now measured, stored and surfaced — as a
tool view, in the overview card, and on the standalone board.

- **`jev_usage` — a usage/quota panel you can call.** Every decision, choice,
  verification and guard event is recorded locally with its measured input
  tokens, cost, latency, question-type mix and tool name. The tool returns
  rolling windows (today / 7 days / 30 days / all / session), a daily call and
  cost series, a projected daily burn rate ("at this pace the daily limit is
  reached in N h"), and an optional hard stop.
- **Local budgets, not invented provider balances.** TypeSafe publishes no
  balance or quota endpoint (`GET /v1/usage`, `/v1/quota`, `/v1/account`,
  `/v1/balance`, `/v1/credits`, `/v1/limits`, `/v1/billing` … all 404; only
  `/v1/models` answers). So the panel reports only what this machine actually
  measured, against limits you set yourself: `quota.dailyCallLimit`,
  `quota.dailyCostLimitUsd`, `quota.sessionCallLimit`, plus `warnAtPercent`.
  The boundary is printed in both the text result and the card — never a
  fabricated balance.
- **Optional hard stop (`quota.enforce`).** With `enabled` + `enforce`, a call
  that would cross a configured limit is refused *before* the API request, with
  a message naming the budget. Display-only by default.
- **Persistence (on by default since 0.8.5; opt-in in 0.8.0–0.8.4).** 0.8.0–0.8.4 kept
  everything in memory (400 samples) unless you set `quota.persist: true`; since 0.8.5 up to
  `quota.historyDays` (default 30) of daily history is written to `$DSH_HOME/jev-usage.json`
  by default (atomic tmp+rename, fail-open), so the cumulative total survives a restart.
- **Surfaced everywhere.** `jev_overview` gained a usage block, the standalone
  board (`dashboard.enabled`) gained a quota section with bars, projections and
  a 30-day sparkline, the settings card gained a "usage/quota" group, and
  `jev_verify` now records its 27 calls, tokens and cost instead of only the
  accuracy string.
- **Tests: 28 passing** — the new `test/usage.test.mjs` covers the empty state,
  token accounting, batch calls, quota status and the hard stop, persistence
  across a day boundary, reload, reset and every formatter.

## What's new in 0.7.5

The audited release: a three-way review (server, client, packaging) turned up
a batch of correctness and honesty bugs, all fixed and pinned by tests — and
`jev_verify` now runs its 27 cases concurrently.

**Server**

- **The session ledger records even when the dashboard is off.** `record()` used
  to return early unless the standalone page was mounted, so `jev_overview`
  reported 0 calls / 0 tokens / $0 forever while `jev_guard_status` counted the
  same events. The in-memory ring now always records; only the HTTP page and the
  `$DSH_HOME/jev-roll.jsonl` append stay behind `dashboard.enabled` (this README
  and the setting text now say exactly that).
- **The guard reports the events it already knew about.** The Jev denial path now
  emits `onSafetyDeny` (with `confidence` and the tool name) and the loop path
  emits `onLoopAdvisory`, so the dashboard advisory counter and the Jev-verdict
  branch of the ledger are no longer dead code.
- **Auto-guard rebuilt in two deterministic tiers with position awareness** (see
  *Auto-guard* below): scanning a whole argument list with regular expressions is
  gone; the root-wipe finder walks flag tokens one by one, so extra flags,
  `--flag=value` forms and reversed flag order can no longer slip a root wipe
  past; a recursive delete of an ordinary relative directory (for example a build
  output folder) is a Jev-judged soft hint instead of a hard block; and a hard
  pattern that only appears in quoted prose is downgraded the same way.
- **`TYPESAFE_BASE_URL` / `TYPESAFE_MODEL` overrides work.** The schema defaults
  were being read as if they were user settings, so the environment variables
  never won and self-hosted endpoints were silently sent to the official base URL.
- **`jev_verify` runs in batches of 6** (`VERIFY_CONCURRENCY`): measured 4.96 s (3.999 s on a re-run)
  wall for the same 27 calls that took 10.1 s serially, and it no longer flirts
  with the tool own timeout.
- **`mislabeled` is complete again** and a new `mislabeledHighConfidence` lists
  which misses were high-confidence (previously one high-confidence miss hid
  every low-confidence one).
- **Errors name the tool that failed.** `missingKeyError()` and the abort /
  timeout / HTTP messages were hardcoded to `jev_decision` even when `jev_choose`
  or the playground raised them.
- **Registration failures surface instead of scrolling past.** `safe()` now
  accumulates `regFailures`, and `jev_guard_status` returns them as
  `registrations.failures` / `failureCount` — the failure class that shipped
  two broken releases.
- **Cost is injected, not hardcoded** (`inputPriceUsdPerMTok`), and the Jev
  verdict cache is bounded at 200 entries.

**Client (in-chat views and the settings card)**

- **`noul` confidence is no longer inverted.** A "no" verdict with `noul: 0.02`
  used to display as "no · confidence 2%" in an alarm colour; it now shows the
  decision-side confidence (98%), matching the overview board.
- **The overview card shows average latency and the question-type mix** that the
  presentation projection had been sending all along.
- **`jev_choose` is auditable**: the tool view keeps the ranked options *and* the
  submitted candidate text plus the selection context, instead of only a count.
- **The running chip is honest**: only `jev_decision` / `jev_choose` claim
  "0 questions" / "0 candidates" while a call is in flight; other tools show none.
- **Dead CSS variables fixed** (`--dsw-alias-bg-l2` →
  `--dsw-alias-bg-layer-2`): the recommendation row and chips were invisible in
  the dark theme.
- **The dashboard page reports its own failures** instead of swallowing them into
  a permanent "loading…", and tolerates events without a timestamp.
- **The credential badge is three-state**: a literal key shows "configured", an
  environment-variable reference shows "environment variable (not yet verified)",
  and neither shows "not configured" — an env name is no longer mistaken for a
  working credential.

**Packaging and docs**

- `test/functional.mjs` → `test/functional.test.mjs`, so the real HTTP-contract
  and grading tests actually run under `npm test` (they never did: the glob only
  matched `*.test.mjs`).
- `bench/choose-e2e.mjs` no longer hardcodes a developer home directory and reads
  the key from `TYPESAFE_API_KEY` or the DSH env file.
- `bench/bench.mjs` takes `--concurrency` (default 6) and reports wall time; the
  user agent is versioned.
- README: latency tail percentiles and the test count are stated as measured,
  `engines.dsh` is marked advisory, and the file no longer advertises a blacklist
  that scanned text it had never inspected.
- Optional peer dependencies declared (`dsh-credentials`, `dsh-client-locale`,
  `dsh-client-ui-settings`, `dsh-api-remotes`).

## What's new in 0.7.4

- **`jev_choose` finally registers — in 0.7.3 the tool did not exist in any host.** Its `options` array parameter declared `minItems`/`maxItems`, keywords the host's value-schema DSL rejects (`JsonSchemaError: unsupported JSON schema: parameters.options.minItems is not supported by the value schema DSL`). `defineTool` threw, the per-tool quarantine swallowed the throw, and the release shipped a headline feature that no host could call — the boot test only asserted four tools, so nothing failed. 0.7.4 drops the unsupported keywords (the 2–10 option count, the ≤800-character options and the ≤2000-character context stay enforced at runtime by `validateOptions` in `lib/counsel.js`) and `test/boot.test.mjs` now asserts all five tools register through the real `defineTool` schema compiler.
- **The guidance section now actually registers — this is what makes the harness call Jev on its own.** Until 0.7.3 the plugin asked the host for a section order via `getSectionOrder("TOOL_JEV")`, a slot that does not exist in the current DSH generation; the lookup returned `undefined` and the host's `systemPrompt.section()` rejects a non-finite order (`TypeError: prompt section "<name>" order must be a finite number`). The throw was swallowed by the same quarantine that protects the profile, so the prompt section silently never existed and the model only ever saw the tool descriptions. 0.7.4 resolves the order as `getSectionOrder("TOOL_JEV")` → `guidance.order` → `3000`, logs the outcome (`system prompt: guidance registered | section tool:jev | order N | chars M`), and `test/boot.test.mjs` now fails if the registered order is not a finite number.
- **Sharper functional descriptions (what / when / when not).** All five tool descriptions now state the measured latency, the question-type rules, the batch-in-one-call advice, the cost of `jev_verify`, and an explicit *do not use for* boundary (`jev_decision` is verdicts, never prose; `jev_choose` scores without explaining). The system-prompt guidance is generated from the same wording, so the prompt and the tool list cannot drift apart.
- **New `guidance` config group**: `guidance.enabled` (default true), `guidance.order` (default 3000), `guidance.extra` (deployment-specific rules appended verbatim) — editable in the GUI settings card.

## What's new in 0.7.3

- **`jev_choose` — multi-option counsel.** New tool that ranks 2–10 candidate approaches in one call: each option is scored by Jev (fit score 0–3 with calibrated confidence + risk noul), combined into a composite (`fit/3 × (1−risk)`); returns an ordered table, a recommended pick and honest per-option latency/cost. Rendered in-conversation as a ranking table (ChooseBody); its guidance text was *intended* for the agent system prompt, but that registration silently failed until 0.7.4 (see below), and included in the dashboard/decision-board stats (`kind: choose` merged into decisions). **Caveat: 0.7.3 shipped this tool broken** — see the registration fix in 0.7.4 below.
- **Deployed 0.7.3** to `D:\lab\jev` (vendor) and the web profile pnpm store with byte-identical MD5 on all five changed files; `node --check` green; `rankOptions` unit-verified against a mock transport.

## What's new in 0.7.2

- **Benchmark claims now match the code.** `jev_verify`'s tool description said
  "24 questions across 15+ cases" while `lib/cases.js` has held 27 labeled
  questions (27 cases, guard verdicts included) since v0.2.0. The description,
  README, market PR copy and the verification report now all state 27.
- **Re-measured on 2026-09-28** (run 4, before this release): 96.3% (26/27) —
  the same single recorded boundary miss as run 3 — 8,696 input tokens ≈
  $0.000365, median 484 ms (network-dependent). Full terminal log: `bench/run4.log`.

## What's new in 0.7.1

- **Docs sync (0.7.1 ships 0.7.0 code).** The verification report now carries
  the complete measured history instead of only the latest run: the 2026-09-21
  benchmark/guard runs, the 2026-09-23 GUI card, settings-card redesign and
  in-chat tool views, the 2026-09-26 two-generation settings-API compatibility
  work, and the 2026-09-28 v0.7.0 regression on a headless profile. `docs/verification.md`
  is the full 208-line record; no behavioural change versus 0.7.0.
- **Structured in-chat views for every tool.** Tool results now carry a
  `presentationMeta` projection (`kind: decision | overview | guard | verify`),
  so the conversation renders a decision card, a guard board and a benchmark
  report — answers, confidence bars, status chips and stat grids — instead of
  raw text. The view falls back to parsing the tool text when `meta` is absent.
- **Full plugin settings card.** Settings > Plugins > Plugin configuration > Jev
  now covers every option: credentials (key, credential-ref, base URL, model,
  timeout, question cap), tool toggles, the whole auto-guard block (safety/loop
  switches, guarded tool list, deny threshold, Jev budget, loop tuning) and the
  dashboard (enable + base path) and the usage/quota panel (enable, enforce,
  warn threshold, daily call / daily cost / session limits, persistence,
  history days) — with numeric validation and dirty-state handling.
- **Config handling hardened.** Volatile config fields (schemastery
  `.volatile()`) are unwrapped before use, so an object-shaped `apiKeyEnv` no
  longer crashes `credentialRef(...)`, `autoGuard.enabled` / `dashboard.enabled`
  actually take effect, and numeric options are read as numbers.
- **Tests: 28 passing** (`npm test`) covering boot, client render, tool views,
  settings, dashboard, guard, usage/quota accounting and the presentation
  projections.

## Why Jev

TypeSafe AI (founded by Diogo Almeida, ex-OpenAI / ChatGPT research) released Jev
on 2026-09-15 as its first “System One” model: unstructured state in, typed
probabilistic decisions out. For agent workloads the model runs 40–200x faster
than frontier chat LLMs on System One-shaped tasks ($0.042 per million input
tokens, free output). Ideal for the high-frequency *fast judgments* of an agent
loop: classification, routing, triage, scoring, guardrails, truth checks.

## Install

Requires Node >= 20 and dsh >= 0.1.5-rc.2. `engines.dsh` is **advisory**: npm
enforces only the `node` key, so the real requirement is a host that exposes
`dsh-tools` 0.1.5-rc.2 and a `settings` service — the plugin degrades one
surface at a time (and reports it in `jev_guard_status`) if one is missing.

```sh
dsh plugin --profile web add dsh-jev-verify
```

then add a loader entry to `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: jev-verify
      name: dsh-jev-verify
      config:
        autoGuard:
          enabled: true     # opt-in auto-guard
```

Restart the profile (or use the plugin market's one-click install, which
performs both steps).

> Tip: for the **dsh market UI** install `dshmarket` first
> (`dsh plugin --profile web add dshmarket`) and install this plugin from
> Settings > 插件市场.

## API key

Get a free key at <https://console.typesafe.ai/keys>. Then choose one:

1. `export TYPESAFE_API_KEY=...` in the launching environment, or
2. Settings > Plugins > Plugin configuration > Jev (credentials service), or
3. set `apiKey` in the plugin config.

Optional environment overrides, with real precedence over the schema defaults
since 0.7.5: `TYPESAFE_BASE_URL` (default `https://api.typesafe.ai/v1`) and
`TYPESAFE_MODEL` (default `jev-latest`). Before that fix the schema default was
read as if it were a user value, so setting these changed nothing.

## Usage

Ask the agent to use `jev_decision` for any fast judgment. Example prompt:

> Use `jev_decision` with state = "<ticket text>" and these questions:
> `department` (choice, criteria billing/technical/sales), `is_urgent` (noul),
> `severity` (score, 3 levels). Report answers + confidence.

Or request `jev_verify` at any time to confirm the endpoint is healthy, and
`jev_guard_status` to see how the auto-guard is behaving.

### Direct tool call shape

```jsonc
{
  "state": "I was double-charged for my subscription and I want a refund.",
  "questions": [
    { "name": "department", "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": { "billing": "Payment or subscription issues",
                    "technical": "Bugs or integration problems",
                    "sales": "Pricing or account questions" } },
    { "name": "is_urgent", "type": "noul",
      "instructions": "The message conveys urgency or time-sensitivity" }
  ]
}
```

Returns per-question `answers` (choice/score/noul + confidence + probabilities),
`usage`, `latencyMs` and `estimatedCostUs`.

## How the harness decides to call Jev

There are four ways a Jev call happens; 0.7.4 made the first one reliable, and 0.8.4 added the fourth:

1. **System-prompt guidance (proactive).** The plugin registers a prompt section named `tool:jev` (order `3000`, override with `guidance.order`, disable with `guidance.enabled: false`, extend with `guidance.extra`). It states the per-tool trigger rules in priority order — *if the decision falls into one of these classes, call this tool now* — and is register-only-when-`jev_decision`-exists, so it never advertises tools that are not loaded. This is the mechanism that makes the agent reach for Jev **by itself**; without it a model only ever sees the tool list and rarely spends a call on it.
2. **Tool descriptions (discovery).** Each tool description carries the same wording: measured latency and cost, the question-type rules, "batch related judgments into ONE call", and an explicit boundary — `jev_decision` returns verdicts and never prose; `jev_choose` scores but does not explain.
3. **Auto-triage (plugin-initiated, 0.8.4).** With `autoTriage.enabled` the plugin itself judges the first step of each turn and injects the routing advice as a plugin-sourced message; the agent does not have to decide to call Jev first, it simply reads the advice. Disable with `autoTriage.enabled: false`, widen the input floor with `autoTriage.minChars`, cap the per-session call count with `autoTriage.maxCallsPerSession`.
4. **Hooks and user turns.** With `autoGuard.enabled`, every guarded shell-like call is audited *before* it runs (deterministic blacklist, then Jev) — no model decision involved. And any user can just ask: *"judge this ticket with `jev_decision`"*, *"rank these three approaches with `jev_choose`"*, *"run `jev_verify`"*.

If the agent still ignores Jev, check in this order: `guidance.enabled` is not false; the prompt section logged `guidance registered` in the host output; `jev_decision` is in the tool list (`jev_guard_status` reports the tools it guards, not the registered set); and the task actually is a judgment call rather than a writing/reasoning task.

## Auto-guard

When `autoGuard.enabled: true`, two hooks run next to every guarded tool call:

1. **Safety** (`tools/pre-execute`): a free deterministic layer runs first and
   splits its matches into **hard** (block outright) and **soft** (ask Jev). The
   seven hard rules cover catastrophic, irreversible operations: recursive
   deletion of a filesystem, drive or directory tree, disk formatting, database
   destruction, credential exfiltration, force-pushed git history. The three soft
   rules cover operations that are destructive but often legitimate: host restart
   / power-off, git-history rewrites short of a force push, and always-true
   DELETE/UPDATE conditions. Hard patterns only fire in *executable position*
   (start of the command, or right after `;` / `|` / `&` / `(` / newline, with
   only wrappers, env assignments and flags before them), so a command you merely
   quote or describe is never hard-blocked; a hard match found anywhere else is
   downgraded to a Jev-judged hint. Everything not blocked goes to **Jev** (risk
   noul ≥ `denyThreshold` ⇒ deny) with a bounded verdict cache (200 entries) and
   a per-session budget; Jev failure is fail-open with a warning.
2. **Loop** (`tools/post-execute`): consecutive same-tool calls with long
   outputs trigger a Jev stall judgment; on a stalled verdict a non-blocking
   advisory is injected into the next request, then a cooldown applies.

Every verdict — deterministic or Jev — is recorded in the session ledger and
counted by `jev_guard_status`, which also surfaces any registration failure
instead of letting it scroll past. Since 0.8.4 the Jev verdicts of the guard are
metered too (`onJevCall` → `kind: "judge"`), so a busy guard shows up in
`jev_usage` instead of leaving the panel at zero.
Evidence from the 0.7.5 audit itself (2026-10-04): three review payloads were
denied by the 0.7.4 rules — two by the deterministic layer, one by Jev at 81–85%
(threshold 0.8) — which is exactly why the hard rules became position-aware.
The 0.7.5 tests re-verify the 0.7.4 contract: the shell and PowerShell
recursive-delete cases, the force-push case and the credential-read case still
block deterministically (27/27 tests green).

## Watching it work (no extra page)

Visualization lives **inside the conversation** — no separate tab:

Each tool ships a `presentationMeta` projection, so results render as
structured cards rather than raw JSON:

- `jev_overview` — a decision board: status chips (model / key / guard /
  threshold), eight stats (decisions, verifies, denials, advisories, median
  latency, average confidence, input tokens, total cost) plus the latest
  decisions and guard events.
- `jev_verify` — the live accuracy / latency / calibration report: accuracy,
  correct count, high-confidence accuracy, median & p95 latency, tokens, cost
  and the mislabelled cases.
- `jev_guard_status` — guard cards: guarded tools, deny threshold, session
  budget, safety & loop counters and the last guarded tool.
- `jev_usage` — the usage/quota panel: quota status, today's calls and cost,
  three budget meters, a projected daily burn rate, a per-day sparkline over the
  retained history and the per-tool breakdown, with the honest boundary printed
  at the bottom.

The session ledger behind `jev_overview` always records (in memory, bounded at
300 events) — since 0.7.5 it no longer waits for the standalone page. That page
still exists for deployments that want it: set `dashboard.enabled: true` and open
http://127.0.0.1:3080/jev; only then are events also appended to
`$DSH_HOME/jev-roll.jsonl` for external tooling.

The same ledger feeds the **usage/quota panel** (`jev_usage`, the usage block in
`jev_overview`, and the board's quota section). It measures this machine only:
TypeSafe exposes no balance endpoint, so the panel never claims a provider-side
balance — only measured calls, tokens and cost against the local budgets you
configure.

## Verification (measured, dated)

See [docs/verification.md](docs/verification.md) for methodology and the latest
dated results.

**Status**: ✅ **verified against the live API on 2026-09-21** (`jev-latest`):
accuracy **96.3%** (26/27) with the guard-inclusive benchmark, median latency
**283–308 ms** across runs, ≈ $0.0004 per 27-question run. The only mislabel is
the documented boundary near-miss (severity score 0.01 vs expected 0).

**Latest re-measurement (2026-10-04, 0.7.5)**: 96.3% (26/27) on `jev-latest`
(`jev-1.13.0`), median **266–440 ms**, p95 **825–1468 ms**, 8,696 input tokens ≈
**$0.000365**, and **4.0–5.0 s wall** for all 27 calls at concurrency 6 (3.999 s on the 2026-10-04 re-run). The single
mislabel is the recorded boundary case (`severity-low`: 0.01 vs expected 0).

Reproduce any time:

```sh
TYPESAFE_API_KEY=... node bench/bench.mjs            # 1 pass (27 questions)
TYPESAFE_API_KEY=... node bench/bench.mjs --repeat 3 # latency stability
```

or ask the agent: *“run jev_verify”*.

**0.7.4**: the guidance section registers for real (root cause: a non-existent `TOOL_JEV` order slot made `systemPrompt.section()` throw, and the throw was swallowed) — see `docs/verification.md`. `npm test` covers the registration path.

**0.7.5**: the audit batch (server, client, packaging) — see the 0.7.5 section above and
`docs/verification.md`; `npm test` is 27/27.

**0.8.0**: the usage/quota panel — locally measured usage with rolling windows,
projections and optional hard budgets; `npm test` is 28/28. See the 0.8.0 section
above. `docs/verification.md` records the measured accounting.

**0.8.1**: the registered settings schema is plain (no `volatile` marker), so the
Settings > Plugins card decodes again and never reports a configured key as
unconfigured; the card also falls back to the raw config layers when a value
cannot be decoded. `npm test` is 29/29. See the 0.8.1 section above.

**0.8.2**: `/jev` stopped 404ing (normalized `dashboard.basePath`, a status page even
when the board is off), a read-only `/jev/api/usage` route always mounts, and the
composer gained a compact `Jev · 今日 N 次 · $…` usage pill with an expanding popover.
`npm test` is 29/29. See the 0.8.2 section above.

**0.8.3**: settings saves actually reach the schema — nested `path` segments committed
in one atomic `mutate`, plus a one-time repair of documents written by <= 0.8.2 with
literal dotted keys. Client-only: refresh the page. `npm test` is 29/29. See the 0.8.3
section above.

**Regression (2026-09-28, v0.7.0)**: in a headless profile with
`autoGuard.enabled: true`, `jev_guard_status` reports the armed guard (tools
list, `deny threshold 0.8`, budget) and `jev_overview` returns its board without
the former `credentialRef` crash — the volatile-config unwrapping fix. `npm test`
passed 19/19 at that time (29/29 today).

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKeyEnv` | `TYPESAFE_API_KEY` | credential-ref / env var for the key |
| `apiKey` | — | literal key override (secret) |
| `baseURL` | `https://api.typesafe.ai/v1` | API base |
| `model` | `jev-latest` | model (pin e.g. `jev-1.13.0`) |
| `timeoutMs` | 15000 | per-call timeout |
| `maxQuestionsPerCall` | 25 | question cap per call |
| `verifyEnabled` | true | register `jev_verify` |
| `guidance.enabled` | true | inject the "when to call Jev" section into the system prompt |
| `guidance.order` | 3000 | order of that prompt section (must resolve to a finite number) |
| `guidance.extra` | `""` | deployment-specific rules appended verbatim to the guidance |
| `autoGuard.enabled` | false | master switch for auto-guard hooks |
| `autoGuard.safetyCheck` | true | pre-execute risk check for guarded tools |
| `autoGuard.loopCheck` | true | semantic stall detection |
| `autoGuard.tools` | bash/pwsh/run_code/terminal | tools the safety check applies to |
| `autoGuard.denyThreshold` | 0.85 | Jev noul ≥ threshold ⇒ deny / advise |
| `autoGuard.maxJevCallsPerSession` | 50 | guard Jev budget per session |
| `autoGuard.loopConsecutive` | 3 | same-tool calls before loop check |
| `autoGuard.loopCooldownMs` | 60000 | cooldown after a stall verdict |
| `autoGuard.loopMinChars` | 200 | min result length for loop check |
| `autoGuard.statusTool` | true | register `jev_guard_status` |
| `autoGuard.determinismFirst` | true | run the free deterministic check before Jev |
| `dashboard.enabled` | false | serve the optional standalone board page |
| `dashboard.basePath` | `/jev` | path of that board page |
| `quota.enabled` | true | register `jev_usage` and record usage |
| `quota.enforce` | false | hard-stop calls that would cross a local budget |
| `quota.warnAtPercent` | 80 | usage percentage that flips the panel to *warn* |
| `quota.dailyCallLimit` | 0 | local daily call budget (0 = no limit) |
| `quota.dailyCostLimitUsd` | 0 | local daily cost budget in USD (0 = no limit) |
| `quota.sessionCallLimit` | 0 | local per-session call budget (0 = no limit) |
| `quota.persist` | true | keep daily history in `$DSH_HOME/jev-usage.json` (on by default since 0.8.5) |
| `quota.historyDays` | 30 | days of daily history retained (1–365) |
| `quota.declaredBalanceUsd` | 0 | your declared balance in USD, used for remaining = declared − measured |
| `quota.balanceSince` | (empty) | first day the declared balance covers, `YYYY-MM-DD`; empty = all recorded history |

## Related projects

- [dsh-jev](https://www.npmjs.com/package/dsh-jev) — Jev guardrail suite (loop guard, safety gate, tool pruning) by zhangxaochen.
- [dsh-jev-tools](https://www.npmjs.com/package/dsh-jev-tools) — automatic Jev judgments + ledger by horusj.
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) — browser agent on Jev.
- [APUS fast-browser-use](https://www.qbitai.com/2026/09/492939.html) — local re-implementation of the decision paradigm for browser automation.

This plugin focuses on what the others do not: **clean full primitives, an
auditable auto-guard, and an honest reproducible verification harness** for the
real TypeSafe API.

## License

MIT