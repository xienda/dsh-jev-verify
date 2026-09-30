# dsh-jev-verify

Jev — TypeSafe AI's **System One** decision model — as a first-class plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

Jev does not generate text. Given a `state` plus typed questions it returns
**typed answers with calibrated probabilities** in one parallel API call
(~70–500 ms published). This plugin exposes that as agent tools, adds an
opt-in **auto-guard** (risk + loop checks), and makes sure the claims are
*verified, not trusted blindly*:

| Tool | What it does | Call it when |
| --- | --- | --- |
| `jev_decision` | Up to 25 typed questions (`choice` / `score` / `noul`) about one `state`, answered **in parallel in one call** (measured ~70–500 ms, median ~300 ms). Every answer carries a calibrated confidence and probabilities; the result also reports model, latency, token usage and estimated cost. | You need fast, repeatable **verdicts** instead of prose: classification/labeling, routing or triage, priority/severity/satisfaction scoring, spam/toxicity/PII checks, intent or truth checks, extracting structured tags. Batch related judgments into one call — parallel, no extra latency. |
| `jev_choose` | Ranks 2–10 candidate options/approaches: each gets a fit score 0–3 and a risk noul, combined into a composite `fit/3 × (1−risk)`; returns an ordered table, a recommended pick, and per-option latency/cost. | Several independent approaches are on the table at a fork and you want a calibrated tiebreaker before deciding. Jev scores, it never explains — the reasoning stays yours. |
| `jev_verify` | Runs the frozen 27-question labeled benchmark (urgency, spam, toxicity, personal data, routing, intent, search type, priority, severity, satisfaction, guard verdicts) against the **live** API: accuracy overall and on the high-confidence subset, median/p95/min/max latency, calibration, tokens, cost, and the mislabeled cases. | Endpoint health check, model-version comparison, or a regression check — never routinely: one run is 27 real API calls (~8.7K input tokens, ≈$0.0004). |
| `jev_guard_status` | Read-only audit of the auto-guard: deterministic rules and the Jev backstop counted separately (`checks` / `jevCalls` / `denied` / `deterministicDenied` / `auditCalls`), guarded tool names, `denyThreshold`, loop-check counts, remaining session budget. | Confirm the guard is armed, see how often it actually fired, or explain why a command was blocked. When the guard is off it says so instead of reporting zeros. |
| `jev_overview` | Read-only snapshot of this session's Jev ledger: recent decisions and choices with confidence, latency median & p95, question-type mix, guard events, cumulative tokens and cost, plus key/guard/threshold status. | The user asks what Jev has done, blocked or spent — or you need endpoint and budget state without restarting the session. The ledger starts at plugin-instance lifetime; guard counts live in `jev_guard_status`. |

**Auto-guard mode** (opt-in `autoGuard.enabled`): before shell-like tool calls
(`bash`/`pwsh`/`run_code`/…), a free deterministic blacklist blocks
hard-destructive commands (rm -rf /, disk format, drop database, credential
exfiltration, ...); risky-looking commands that pass it are judged by **Jev**
(risk noul ≥ threshold ⇒ deny; fail-open with a warning on API errors). A loop
guard evaluates repeated same-tool calls for semantic stalls and injects advice
instead of blocking. Every verdict is auditable via `jev_guard_status`.

**Honest by design** — no mock mode, no silent fallback:

- without a `TYPESAFE_API_KEY`, tools and guard fail with explicit setup instructions (the guard fails open with a warning — it never silently pretends to have checked);
- every `jev_decision` result includes the model, latency and token usage, so each call is auditable;
- `jev_verify` refuses to report numbers it did not measure;
- the benchmark CLI (`bench/bench.mjs`) is dependency-free and reproducible with any key.

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
  dashboard (enable + base path) — with numeric validation and dirty-state
  handling.
- **Config handling hardened.** Volatile config fields (schemastery
  `.volatile()`) are unwrapped before use, so an object-shaped `apiKeyEnv` no
  longer crashes `credentialRef(...)`, `autoGuard.enabled` / `dashboard.enabled`
  actually take effect, and numeric options are read as numbers.
- **Tests: 19 passing** (`npm test`) covering boot, client render, tool views,
  settings, dashboard, guard and the presentation projections.

## Why Jev

TypeSafe AI (founded by Diogo Almeida, ex-OpenAI / ChatGPT research) released Jev
on 2026-09-15 as its first “System One” model: unstructured state in, typed
probabilistic decisions out. For agent workloads the model runs 40–200x faster
than frontier chat LLMs on System One-shaped tasks ($0.042 per million input
tokens, free output). Ideal for the high-frequency *fast judgments* of an agent
loop: classification, routing, triage, scoring, guardrails, truth checks.

## Install

Requires Node >= 20 and dsh >= 0.1.5-rc.2.

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

Optional environment overrides: `TYPESAFE_BASE_URL` (default
`https://api.typesafe.ai/v1`), `TYPESAFE_MODEL` (default `jev-latest`).

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

There are three ways a Jev call happens, and 0.7.4 is the release that made the first one reliable:

1. **System-prompt guidance (proactive).** The plugin registers a prompt section named `tool:jev` (order `3000`, override with `guidance.order`, disable with `guidance.enabled: false`, extend with `guidance.extra`). It states the per-tool trigger rules in priority order — *if the decision falls into one of these classes, call this tool now* — and is register-only-when-`jev_decision`-exists, so it never advertises tools that are not loaded. This is the mechanism that makes the agent reach for Jev **by itself**; without it a model only ever sees the tool list and rarely spends a call on it.
2. **Tool descriptions (discovery).** Each tool description carries the same wording: measured latency and cost, the question-type rules, "batch related judgments into ONE call", and an explicit boundary — `jev_decision` returns verdicts and never prose; `jev_choose` scores but does not explain.
3. **Hooks and user turns.** With `autoGuard.enabled`, every guarded shell-like call is audited *before* it runs (deterministic blacklist, then Jev) — no model decision involved. And any user can just ask: *"judge this ticket with `jev_decision`"*, *"rank these three approaches with `jev_choose`"*, *"run `jev_verify`"*.

If the agent still ignores Jev, check in this order: `guidance.enabled` is not false; the prompt section logged `guidance registered` in the host output; `jev_decision` is in the tool list (`jev_guard_status` reports the tools it guards, not the registered set); and the task actually is a judgment call rather than a writing/reasoning task.

## Auto-guard

When `autoGuard.enabled: true`, two hooks run next to every guarded tool call:

1. **Safety** (`tools/pre-execute`): deterministic blacklist first (free),
   Jev risk judgment for suspect commands; deny above `denyThreshold` with an
   explicit reason, fail-open when Jev is unavailable.
2. **Loop** (`tools/post-execute`): consecutive same-tool calls with long
   outputs trigger a Jev stall judgment; on a stalled verdict a non-blocking
   advisory is injected into the next request, then a cooldown applies.

Both degrade gracefully and are fully countable via `jev_guard_status`.
Measured demo (2026-09-21): `remove-item -Recurse …` was blocked by the
deterministic rule, while "permanently wipe all staging data and delete every
row from every table" was intercepted by **Jev at 91% confidence** (threshold
0.8) before any command ran.

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

An optional standalone page (`/jev`) exists for deployments that want it:
set `dashboard.enabled: true` and open http://127.0.0.1:3080/jev.
Every decision, verify and guard event is also appended to
`$DSH_HOME/jev-roll.jsonl` for external tooling.

## Verification (measured, dated)

See [docs/verification.md](docs/verification.md) for methodology and the latest
dated results.

**Status**: ✅ **verified against the live API on 2026-09-21** (`jev-latest`):
accuracy **96.3%** (26/27) with the guard-inclusive benchmark, median latency
**283–308 ms** across runs, ≈ $0.0004 per 27-question run. The only mislabel is
the documented boundary near-miss (severity score 0.01 vs expected 0).

Reproduce any time:

```sh
TYPESAFE_API_KEY=... node bench/bench.mjs            # 1 pass (27 questions)
TYPESAFE_API_KEY=... node bench/bench.mjs --repeat 3 # latency stability
```

or ask the agent: *“run jev_verify”*.

**0.7.4**: the guidance section registers for real (root cause: a non-existent `TOOL_JEV` order slot made `systemPrompt.section()` throw, and the throw was swallowed) — see `docs/verification.md`. `npm test` covers the registration path.

**Regression (2026-09-28, v0.7.0)**: in a headless profile with
`autoGuard.enabled: true`, `jev_guard_status` reports the armed guard (tools
list, `deny threshold 0.8`, budget) and `jev_overview` returns its board without
the former `credentialRef` crash — the volatile-config unwrapping fix. `npm test`
passes 19/19.

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