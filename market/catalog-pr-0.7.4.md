## What

Refreshes the entry for `xienda/dsh-jev-verify` to match the plugin as of **v0.7.4** (npm). One file changes: `data/plugins/xienda__dsh-jev-verify.yml` — no other entry is touched.

v0.7.4 is a correctness release, and the description was rewritten to be precise about *what each tool does and when to call it*:

- **Two silent registration failures are fixed, and both were user-visible.** (1) The system-prompt guidance section never registered: the plugin asked the host for a section order via `getSectionOrder("TOOL_JEV")`, a slot that does not exist in this DSH generation, and the host rejects a non-finite order (`TypeError: prompt section "<name>" order must be a finite number`) — the throw was swallowed by the plugin's own quarantine, so the agent only ever saw tool descriptions and rarely called Jev on its own. (2) `jev_choose` never registered in **any** host: its `options` parameter declared `minItems`/`maxItems`, which the host value-schema DSL rejects, so `defineTool` threw and the per-tool quarantine hid it. In 0.7.4 the guidance section registers (order falls back `TOOL_JEV` → `guidance.order` → `3000`, and the outcome is logged), and `jev_choose` declares only supported keywords while its 2–10 / ≤800-character / ≤2000-character limits are enforced at runtime.
- **Five tools described with their boundaries**: `jev_decision` (1–25 parallel atomic verdicts, noul/choice/score, typed answers + calibrated confidence, ~70–500 ms, verdicts only — never prose), `jev_choose` (2–10 candidates scored in parallel on fit 0–3 plus risk, explicit composite, recommended pick, scores only — no explanations), `jev_overview` (usage ledger since the plugin instance started), `jev_guard_status` (guard counters, honest `disabled` when off), `jev_verify` (27-question labeled benchmark against the live API: 96.3%, 26/27, median 283–484 ms; one run costs ≈8.7K input tokens ≈ $0.0004).
- **New `guidance` options** (`guidance.enabled`, `guidance.order`, `guidance.extra`) alongside the existing Settings > Plugins card (credentials, tool toggles, the whole auto-guard block, dashboard).

## Why

The previous wording described 0.7.3, a release in which the headline `jev_choose` tool could not actually be called and the system-prompt guidance was not in effect. The entry now states the real behaviour, including the honest boundaries (verdicts not prose, scores not reasons, no mock fallback, explicit error without a key). `url`, `name` and `category` are unchanged.

## Verification of the claims

- `dsh-jev-verify@0.7.4` is on npm; `npm test` → **26/26 passing**, including two new boot assertions that fail if the registered prompt-section order is not a finite number, if the guidance text omits any of the five tools, or if fewer than five tools register through the host's real `defineTool` schema compiler.
- Live E2E of `jev_choose` after the fix (2026-09-30, `bench/choose-e2e.mjs`, key from the local credentials env, never printed): three real candidates scored against `https://api.typesafe.ai/v1/systemone` — recommended pick "verify, then publish" fit 1.93/3, risk 23%, composite 50%, confidence 41%; the reckless option crushed to fit 0.11/3, risk 90%, composite 0.4%; 895 ms, $0.0000674 (1605 in + 99 out). This is the code path 0.7.3 never exercised.
- Live benchmark (2026-09-28): 96.3% (26/27, the same single recorded boundary case as 2026-09-21), 8,696 input tokens ≈ $0.000365, median 484 ms (network-dependent; 283 ms on 2026-09-21) — log `bench/run4.log`, report `docs/verification.md`.
- Reproduce with `TYPESAFE_API_KEY=... node bench/bench.mjs` (zero-dependency CLI).

Update to an existing entry, submitted by the plugin author (fork branch `chore/jev-desc-0.7.4`, based on current `main`).
