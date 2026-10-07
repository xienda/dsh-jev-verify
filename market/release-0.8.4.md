# dsh-jev-verify 0.8.4

**Honest panel, metered guard, and a plugin that participates on its own.**

0.8.4 answers three user-visible complaints from a real session: the panel implied
a quota that does not exist, the guard's own Jev calls never reached the ledger,
and the agent simply never called Jev.

## 1. No fabricated quota

TypeSafe is a metered API with **no balance endpoint**. If you never configured a
local budget, the old panel still printed "额度正常", drew a percentage bar against
∞ and showed "额度重置 13 小时 41 分后" — a countdown to a budget that did not exist.

- New `quota.budgetConfigured` drives every surface: `jev_usage` text, the `/jev`
  status page, the pill JSON route, the composer pill and the full dashboard.
- Without a budget: no status verdict, no bar, no countdown; the text says
  pay-as-you-go, nothing resets, only locally measured usage is reported.
- With a local budget: the countdown returns, explicitly labelled
  "本地预算重置 / 本地自设上限", and percentage bars become meaningful.

## 2. Money first

The collapsed pill now reads `Jev · 今日 $0.000534 · 29 次`; the popover leads with
today's cost and cumulative cost, and call counts are secondary rows.

## 3. The guard's Jev verdicts are metered

`judgeRisky`/`judgeStall` now return `{ noul, latencyMs, usage }` (token usage comes
from `body.usage`, since `requestSystemOne` returns `{ body, latencyMs }`) and report
through a new `onJevCall` event. `index.js` records them as `kind: "judge"`,
`tool: "auto-guard"`.

Before: `jev_guard_status` reported `safety.jevCalls: 2` while `jev_usage` said
"今日调用 0 次". That gap was a real accounting bug, not a wording issue.

## 4. Auto-triage: the plugin judges the turn itself

New module `lib/triage.js`. On the first step of a turn the plugin asks Jev four
routing questions (intent, needs_judgment, judgment_kind, recommended_tool) and
injects the advice as a **plugin-sourced user message**, so the agent reads a
recommendation instead of having to remember to call Jev.

- at most once per (agent, turn) via `WeakMap`; `maxCallsPerSession` 200
- `state` clipped to 6000 chars, `minChars` 12, `timeoutMs` 4000
- `createUserMessage` is imported lazily from `@deepseek-ai/dsh-llm`; if it does not
  resolve, the call is still metered but nothing is injected
- fail-open on unknown host shape, missing key, timeout, abort or any API error
- each call emits exactly one `onTriage` ledger event (`kind: "triage"`)

## 5. Harder guidance

The system-prompt section adds mandatory-trigger rules, a ban on bypassing Jev
"because I already know the answer", and the real cost magnitude
(~$0.00002–0.0001 per call; 25 questions cost the same as 1).

## Tests

`npm test` → **30/30** (~2.5 s). New `test/triage.test.mjs` (5 groups), plus new
assertions in `test/usage.test.mjs` (no-budget branch), `test/client.test.mjs`
(money-first label, no-budget pill) and `test/guard.test.mjs` (`onJevCall` payload).

## Scope

- **Client half** (composer pill): refresh the page.
- **Server half** (guard metering, auto-triage, guidance, status page): restart the
  host.
