# dsh-jev-verify

Jev — TypeSafe AI's **System One** decision model — as a first-class plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

Jev does not generate text. Given a \`state\` plus typed questions it returns
**typed answers with calibrated probabilities** in one parallel API call
(~70–500 ms published). This plugin exposes that as agent tools, adds an
opt-in **auto-guard** (risk + loop checks), and makes sure the claims are
*verified, not trusted blindly*:

| Tool | What it does |
| --- | --- |
| \`jev_decision\` | Choice / Score / Noul questions against a \`state\` in ONE call. Returns typed answers, confidence, probabilities, token usage, measured latency and estimated cost. |
| \`jev_verify\` | Runs the built-in labeled benchmark (23 cases / 27 questions, incl. guard verdicts) against the **live** API and returns measured accuracy, median/p95 latency, calibration and cost. The anti-deception self-test. |
| \`jev_guard_status\` | Audit the auto-guard: counts, guarded tools, thresholds, budget — guard behavior is always transparent. |

**Auto-guard mode** (opt-in \`autoGuard.enabled\`): before shell-like tool calls
(\`bash\`/\`pwsh\`/\`run_code\`/…), a free deterministic blacklist blocks
hard-destructive commands (rm -rf /, disk format, drop database, credential
exfiltration, ...); risky-looking commands that pass it are judged by **Jev**
(risk noul ≥ threshold ⇒ deny; fail-open with a warning on API errors). A loop
guard evaluates repeated same-tool calls for semantic stalls and injects advice
instead of blocking. Every verdict is auditable via \`jev_guard_status\`.

**Honest by design** — no mock mode, no silent fallback:

- without a \`TYPESAFE_API_KEY\`, tools and guard fail with explicit setup instructions (the guard fails open with a warning — it never silently pretends to have checked);
- every \`jev_decision\` result includes the model, latency and token usage, so each call is auditable;
- \`jev_verify\` refuses to report numbers it did not measure;
- the benchmark CLI (\`bench/bench.mjs\`) is dependency-free and reproducible with any key.

## Why Jev

TypeSafe AI (founded by Diogo Almeida, ex-OpenAI / ChatGPT research) released Jev
on 2026-09-15 as its first “System One” model: unstructured state in, typed
probabilistic decisions out. For agent workloads the model runs 40–200x faster
than frontier chat LLMs on System One-shaped tasks ($0.042 per million input
tokens, free output). Ideal for the high-frequency *fast judgments* of an agent
loop: classification, routing, triage, scoring, guardrails, truth checks.

## Install

Requires Node >= 20 and dsh >= 0.1.5-rc.2.

\`\`\`sh
dsh plugin --profile web add dsh-jev-verify
\`\`\`

then add a loader entry to \`$DSH_HOME/profiles/<profile>/cordis.patch.yml\`:

\`\`\`yaml
- insert:
    - id: jev-verify
      name: dsh-jev-verify
      config:
        autoGuard:
          enabled: true     # opt-in auto-guard
\`\`\`

Restart the profile (or use the plugin market's one-click install, which
performs both steps).

> Tip: for the **dsh market UI** install \`dshmarket\` first
> (\`dsh plugin --profile web add dshmarket\`) and install this plugin from
> Settings > 插件市场.

## API key

Get a free key at <https://console.typesafe.ai/keys>. Then choose one:

1. \`export TYPESAFE_API_KEY=...\` in the launching environment, or
2. Settings > Plugins > Plugin configuration > Jev (credentials service), or
3. set \`apiKey\` in the plugin config.

Optional environment overrides: \`TYPESAFE_BASE_URL\` (default
\`https://api.typesafe.ai/v1\`), \`TYPESAFE_MODEL\` (default \`jev-latest\`).

## Usage

Ask the agent to use \`jev_decision\` for any fast judgment. Example prompt:

> Use \`jev_decision\` with state = "<ticket text>" and these questions:
> \`department\` (choice, criteria billing/technical/sales), \`is_urgent\` (noul),
> \`severity\` (score, 3 levels). Report answers + confidence.

Or request \`jev_verify\` at any time to confirm the endpoint is healthy, and
\`jev_guard_status\` to see how the auto-guard is behaving.

### Direct tool call shape

\`\`\`jsonc
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
\`\`\`

Returns per-question \`answers\` (choice/score/noul + confidence + probabilities),
\`usage\`, \`latencyMs\` and \`estimatedCostUs\`.

## Auto-guard

When \`autoGuard.enabled: true\`, two hooks run next to every guarded tool call:

1. **Safety** (\`tools/pre-execute\`): deterministic blacklist first (free),
   Jev risk judgment for suspect commands; deny above \`denyThreshold\` with an
   explicit reason, fail-open when Jev is unavailable.
2. **Loop** (\`tools/post-execute\`): consecutive same-tool calls with long
   outputs trigger a Jev stall judgment; on a stalled verdict a non-blocking
   advisory is injected into the next request, then a cooldown applies.

Both degrade gracefully and are fully countable via \`jev_guard_status\`.
Measured demo (2026-09-21): \`remove-item -Recurse …\` was blocked by the
deterministic rule, while "permanently wipe all staging data and delete every
row from every table" was intercepted by **Jev at 91% confidence** (threshold
0.8) before any command ran.

## Verification (measured, dated)

See [docs/verification.md](docs/verification.md) for methodology and the latest
dated results.

**Status**: ✅ **verified against the live API on 2026-09-21** (\`jev-latest\`):
accuracy **96.3%** (26/27) with the guard-inclusive benchmark, median latency
**283–308 ms** across runs, ≈ $0.0004 per 27-question run. The only mislabel is
the documented boundary near-miss (severity score 0.01 vs expected 0).

Reproduce any time:

\`\`\`sh
TYPESAFE_API_KEY=... node bench/bench.mjs            # 1 pass (27 questions)
TYPESAFE_API_KEY=... node bench/bench.mjs --repeat 3 # latency stability
\`\`\`

or ask the agent: *“run jev_verify”*.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| \`apiKeyEnv\` | \`TYPESAFE_API_KEY\` | credential-ref / env var for the key |
| \`apiKey\` | — | literal key override (secret) |
| \`baseURL\` | \`https://api.typesafe.ai/v1\` | API base |
| \`model\` | \`jev-latest\` | model (pin e.g. \`jev-1.13.0\`) |
| \`timeoutMs\` | 15000 | per-call timeout |
| \`maxQuestionsPerCall\` | 25 | question cap per call |
| \`verifyEnabled\` | true | register \`jev_verify\` |
| \`autoGuard.enabled\` | false | master switch for auto-guard hooks |
| \`autoGuard.safetyCheck\` | true | pre-execute risk check for guarded tools |
| \`autoGuard.loopCheck\` | true | semantic stall detection |
| \`autoGuard.tools\` | bash/pwsh/run_code/terminal | tools the safety check applies to |
| \`autoGuard.denyThreshold\` | 0.85 | Jev noul ≥ threshold ⇒ deny / advise |
| \`autoGuard.maxJevCallsPerSession\` | 50 | guard Jev budget per session |
| \`autoGuard.loopConsecutive\` | 3 | same-tool calls before loop check |
| \`autoGuard.loopCooldownMs\` | 60000 | cooldown after a stall verdict |
| \`autoGuard.loopMinChars\` | 200 | min result length for loop check |
| \`autoGuard.statusTool\` | true | register \`jev_guard_status\` |

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
