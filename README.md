# dsh-jev-verify

Jev — TypeSafe AI's **System One** decision model — as a first-class plugin for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

Jev does not generate text. Given a `state` plus typed questions it returns
**typed answers with calibrated probabilities** in one parallel API call
(~70–500 ms published). This plugin exposes that as two agent tools and makes
sure the claims are *verified, not trusted blindly*:

| Tool | What it does |
| --- | --- |
| `jev_decision` | Choice / Score / Noul questions against a `state` in ONE call. Returns typed answers, confidence, probabilities, token usage, measured latency and estimated cost. |
| `jev_verify` | Runs the built-in labeled benchmark (25 questions / 21 cases) against the **live** API and returns measured accuracy, median/p95 latency, calibration and cost. The anti-deception self-test. |

**Honest by design** — no mock mode, no silent fallback:

- without a `TYPESAFE_API_KEY`, both tools fail with explicit setup instructions;
- every `jev_decision` result includes the model, latency and token usage, so each call is auditable;
- `jev_verify` refuses to report numbers it did not measure;
- the benchmark CLI (`bench/bench.mjs`) is dependency-free and reproducible with any key.

## Why Jev

TypeSafe AI (founded by Diogo Almeida, ex-OpenAI / ChatGPT research) released Jev
on 2026-09-15 as its first “System One” model: unstructured state in, typed
probabilistic decisions out. For agent workloads the model runs 40–200x faster
than frontier chat LLMs on System One-shaped tasks ($0.042 per million input
tokens, free output, 250k tokens/s, 1200 req/min). Ideal for the high-frequency
*fast judgments* of an agent loop: classification, routing, triage, scoring,
guardrails, truth checks.

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
```

Restart the profile (or use the plugin market's one-click install, which
performs both steps). The tools appear in the agent's catalog.

> Tip: for the **dsh market UI** install the `dshmarket` bundle first
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

Or request `jev_verify` at any time to confirm the endpoint is healthy and
measure real numbers.

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

## Verification (measured, dated)

See [docs/verification.md](docs/verification.md) for the methodology and the
latest dated results (model, accuracy, latency stats, cost, mislabels).

**Status**: ✅ **verified against the live API on 2026-09-21** (`jev-latest`):
accuracy **96.0%** (72/75, 3 runs identical), median latency **308 ms** (p95 949 ms),
full-run cost **≈ $0.001** for 75 batched questions. Full numbers, the single
documented boundary near-miss (severity score 0.01 vs expected 0), and the
official-claims comparison table: [docs/verification.md](docs/verification.md).

Reproduce any time:

```sh
TYPESAFE_API_KEY=... node bench/bench.mjs            # 1 pass (25 questions)
TYPESAFE_API_KEY=... node bench/bench.mjs --repeat 3 # latency stability
```

or ask the agent: *“run jev_verify”*.

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

## Related projects

- [dsh-jev](https://www.npmjs.com/package/dsh-jev) — Jev guardrail suite (loop guard, safety gate, tool pruning) by zhangxaochen.
- [dsh-jev-tools](https://www.npmjs.com/package/dsh-jev-tools) — automatic Jev judgments + ledger by horusj.
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) — browser agent on Jev.
- [APUS fast-browser-use](https://www.qbitai.com/2026/09/492939.html) — local re-implementation of the decision paradigm for browser automation.

This plugin focuses on what the others do not: **complete clean primitives +
an honest, reproducible verification harness** for the real TypeSafe API.

## License

MIT