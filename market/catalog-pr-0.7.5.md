## What

Refreshes the entry for `xienda/dsh-jev-verify` to match the plugin as of **v0.7.5** (npm, commit `57ccb0e`). One file changes: `data/plugins/xienda__dsh-jev-verify.yml` — no other entry is touched.

v0.7.5 comes out of a three-way audit of 0.7.4 (server / client / docs+packaging) that produced 24 findings, all fixed here. The description is rewritten to state what the guard now actually does, and to keep the numbers honest:

- **The auto-guard is now two-tier and position-aware** (7 hard + 3 soft = 10 rules). Hard rules block catastrophic operations — recursive deletes of a filesystem, home, drive root or directory tree, disk formatting and partitioning, database destruction, force-pushed git history, credential exfiltration — **only at executable position**. The 0.7.4 guard matched anywhere in an argument, so writing about a dangerous command (in a README, a test, the plugin's own source, a commit message) was blocked exactly like running it; the same release's root-recursive-delete matcher also missed the extra-flag and `--flag=value` forms. Soft patterns (taking a host down, a git-history rewrite short of a force push, an always-true condition on a delete/update) go to Jev against `denyThreshold`. Both tiers now report `onSafetyDeny` with the tool name; the loop check reports `onLoopAdvisory`.
- **The usage ledger is honest.** 0.7.4's `record()` returned early unless the dashboard routes were mounted, and those mount only when `dashboard.enabled` is true (default false) — so `jev_overview` reported 0 calls / 0 tokens / $0 forever and `$DSH_HOME/jev-roll.jsonl` was never written. The in-memory ring now always records; only the HTTP route and the JSONL append depend on `dashboard.enabled`.
- **`jev_verify` runs 27 live calls at concurrency 6**: measured wall clock 3.999 s versus 10.07 s serial (2.52×), inside the host timeout, same 96.3% (26/27).
- **The numbers in the entry are measured, with the tail stated as measured**: `jev_decision` median 282–484 ms depending on the run, p95 825–1468 ms (single-run peaks ~1.5 s; a congested network ~5 s). 0.7.4 advertised a flat "~70–500 ms, median ~300 ms" that the archived benchmark reports contradicted (p95 5023 ms, max 9909 ms).
- **Error text names the right tool.** `missingKeyError()` hardcoded `jev_decision`, so `jev_choose` and the dashboard playground told users to check the wrong key. `TYPESAFE_BASE_URL` / `TYPESAFE_MODEL` overrides now really take effect (the schema default was read first, so a self-hosted endpoint silently went to the public API). `jev_verify` reports the full `mislabeled` list plus `mislabeledHighConfidence`, the verdict cache is capped at 200 entries, and swallowed registration failures surface under `jev_guard_status.registrations`.
- **Client and packaging fixes** are described in the entry only where they are user-visible: the ranking view keeps state and candidate text, cards show `avgLatencyMs` / `typeCounts`, the dashboard page has an error surface, the credential badge is tri-state (an env-var name alone is "read from environment (not verified)", never "configured"), and the real HTTP-contract test now actually runs in `npm test` (27 tests, was 26). `engines.dsh` is documented as informational because npm does not enforce it.

`url`, `name` and `category` are unchanged.

## Why

The published entry promised behaviour that the code did not deliver in three places (ledger always zero, guard over-blocking prose while missing flag variants, serial verification), and quoted a latency band contradicted by the plugin's own archived reports. The entry now states the real behaviour together with its honest boundaries: Jev returns verdicts and calibrated probabilities, never prose or explanations; the guard is a fail-open backstop, not a sandbox; no mock fallback exists and a missing key produces an explicit error.

## Verification of the claims

- `dsh-jev-verify@0.7.5` is on npm; `npm test` → **27/27 passing** (12 files, 2559 ms), including 9 guard suites that assert position-aware tiering (executable position blocks, quoted/described text is demoted), flag-order independence including the `--flag=value` form, both audit events carrying the tool name, and the 200-entry verdict-cache cap.
- **Live benchmark** (2026-10-04, concurrency 6, `bench/bench.mjs` against `https://api.typesafe.ai/v1/systemone`): **96.3% (26/27)**, median **282 ms**, p95 **1468 ms**, min 231, max 1471, wall **3999 ms**, 8696 input + 822 output tokens ≈ **$0.000365**; report `bench/results/2026-10-04T12-40-07-421Z.json`. The single mislabel is the same recorded boundary case as before (`severity-low`, 0.01 vs expected 0).
- **Live `jev_choose` E2E** (2026-10-04): recommended "verify, then publish" fit **1.89/3** · risk **22%** · composite 49% · confidence 42%; the reckless option fit 0.1/3 · risk 90%; 933 ms, $0.0000674 (1605 in + 99 out), model `jev-1.13.0`.
- The guard rewrite tests its own premise: the 0.7.4 deterministic tier blocked the source files, the commit message and the release notes for this very release while they were being written; the new tier passes that same text while still matching the operations at executable position.
- Reproduce the benchmark with `TYPESAFE_API_KEY=... node bench/bench.mjs` (zero-dependency CLI; `--concurrency` defaults to 6).

Update to an existing entry, submitted by the plugin author (fork branch `chore/jev-desc-0.7.5`, based on current `main`).
