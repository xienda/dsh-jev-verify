# v0.7.4 — the guidance section really registers (and `jev_choose` actually works)

**Release date:** 2026-10-01 · **npm:** [`dsh-jev-verify@0.7.4`](https://www.npmjs.com/package/dsh-jev-verify) · **commit:** `64ee834` · **full diff:** [`9dd64a6...64ee834`](https://github.com/xienda/dsh-jev-verify/compare/9dd64a6...64ee834)

This release fixes **two silent registration failures**. Both shipped code that looked right in tests and did nothing in a real host; both now have regression tests that fail when the real host contract is violated.

---

## 1. The system-prompt guidance section now exists — this is what makes the harness call Jev on its own

Until 0.7.3 the plugin asked the host for its prompt slot via `getSectionOrder("TOOL_JEV")`. That slot **does not exist in the current DSH generation** (`SECTION_ORDERS` ends at `TOOL_REPORT = 2900`, then jumps to `TOOLS_SDK = 5000`), so the lookup returned `undefined` — and `SystemPrompt.section()` rejects a non-finite order:

```
TypeError: prompt section "<name>" order must be a finite number
```

The throw was swallowed by the same per-surface quarantine that protects the profile, so the section **silently never existed** and the model only ever saw the tool descriptions. That is why the harness did not reach for Jev on its own.

**Fix:** resolve the order as `getSectionOrder("TOOL_JEV")` → `guidance.order` → `DEFAULT_GUIDANCE_ORDER = 3000`, register the section as `tool:jev`, leave the text empty when `jev_decision` is not registered, and log the outcome:

```
[dsh-jev-verify] system prompt: guidance registered | section tool:jev | order 3000 | chars 838
```

The section is written as **trigger rules** (tool + situation + boundary), not marketing prose: what each of the five tools is for, when to use it, when *not* to (no text generation, no long-chain reasoning), the `confidence < 0.6 → re-check with the main model` rule, and the honest "Jev scores, it does not explain" contract. Measured length: 838 characters with the auto-guard on, 717 with it off.

New `guidance` config group — `enabled` / `order` / `extra` — all volatile so they are editable from the settings card without a restart.

## 2. `jev_choose` was not callable in **any** host in 0.7.3 — now it is

The tool declared `minItems`/`maxItems` on its `options` array, keywords the host value-schema DSL rejects:

```
JsonSchemaError: unsupported JSON schema: parameters.options.minItems is not supported by the value schema DSL
```

`defineTool` threw, the per-tool quarantine swallowed the throw, and the boot test only asserted four tools — so 0.7.3 published a headline feature that **no host could call**. Dropped the keywords; the real constraints (2–10 options, ≤800 characters per option, ≤2000 characters of context) are now enforced at runtime by `validateOptions` in `lib/counsel.js`, and `test/boot.test.mjs` asserts all five tools register through the host's real `defineTool` schema compiler.

## 3. Honesty and robustness

- `choosePresentation(value)` never throws and is **JSON-reversible** — `presentationMeta` is projected while a call is running or failed, and `undefined` keys vanish in a JSON round-trip, so only defined keys are copied.
- `formatChoose(value)` degrades to `jev_choose | 尚无结果（仍在运行或已失败）` instead of throwing on a non-object.
- `test/boot.test.mjs`'s fake context now **mirrors the real host contract** (`section()` rejects a non-finite order, `getSectionOrder()` only knows `TOOL_GOAL`), so the contract that failed silently is now covered by a failing test.
- Tool descriptions for all five tools were rewritten to say exactly what each one returns and when it must not be used.

## Verified

- `npm test`: **26/26** green.
- **Live API E2E** (`bench/choose-e2e.mjs`, key read from `~/.dsh/.env`, never printed): recommended 「先验证后发布」 fit **1.93/3** · risk **23%** · composite **50%** · confidence 41%; trap option 「直接发布」 fit 0.11/3 · risk 90%; 「只发 npm」 1.03/3 · risk 56%. Total 895 ms, $0.0000674 (1605 in + 99 out), model `jev-1.13.0`. **This is exactly the code path 0.7.3 never ran.**
- **Benchmark** (unchanged since 0.7.2): **96.3% (26/27)** on the built-in 27-question set against the live API, measured 2026-09-21 and re-measured 2026-09-28; median **283–484 ms** on `jev-latest`; **$0.000365** per full run. The single mislabel is `severity-low` (score 0 → 0.01).
- Boot-log proof this release is live: `[dsh-jev-verify] settings namespace registered: jev-verify | schema: present | scope: object`.

## What the plugin gives a DSH agent

- **Five verdict tools:** `jev_decision` (1–25 parallel atomic judgments: choice / score / noul), `jev_choose` (rank 2–10 candidate approaches), `jev_overview` and `jev_guard_status` (read-only audit), `jev_verify` (27-question self-check against the live API).
- **In-chat tool views** — structured panels for every call, with latency, cost, model, threshold and expandable state preview.
- **A full settings card** (Settings → Plugins → Plugin configuration → Jev) covering the auto-guard, guidance, dashboard and budget options.
- **An auto-guard** on every shell-class call (`bash` / `pwsh` / `run_code` / `terminal`): deterministic hard rules first, then a Jev risk judgment against `denyThreshold`; stall/loop detection only advises and never blocks. Jev failure is **fail-open**.
- **A local `/jev` dashboard** (opt-in, `dashboard.enabled`).

## Install / upgrade

```
dsh plugin --profile web add dsh-jev-verify
```

Restart the host afterwards. A correct boot prints both lines quoted above; the guidance line is the one that proves the harness can now reach for Jev by itself.

## Honest caveats

- **Skip 0.7.3** for `jev_choose`: the tool existed in the package but registered in no host.
- The guidance section is the mechanism behind proactive Jev use; with it absent the model sees only tool descriptions (this was the 0.7.3 and earlier behaviour).
- **Real API only.** Without `TYPESAFE_API_KEY` every tool returns an explicit error; results are never fabricated, and there is no mock fallback.

---

## 中文摘要

**v0.7.4 修掉两个「静默注册失败」——它们在测试里看起来是对的，在真实宿主里却什么也没发生，现在都有会真失败的回归测试兜底。**

1. **引导段真的注册上了**（这才是 harness 会主动调用 Jev 的原因）。0.7.3 用 `getSectionOrder("TOOL_JEV")` 取槽位，而这个 DSH 代际的槽位表里根本没有 `TOOL_JEV` → 返回 `undefined` → `SystemPrompt.section()` 抛 `TypeError: prompt section "<name>" order must be a finite number` → 异常被隔离逻辑吞掉 → **引导段从未存在**，模型只看得到工具描述。修复：order 解析链 `getSectionOrder("TOOL_JEV")` → `guidance.order` → `DEFAULT_GUIDANCE_ORDER = 3000`，段名 `tool:jev`，成功日志 `[dsh-jev-verify] system prompt: guidance registered | section tool:jev | order 3000 | chars 838`。该段写的是**触发规则**（每个工具何时用、何时不要用、置信度 <0.6 回主模型复核、Jev 只给判定不写理由），不是宣传语。新增 `guidance` 配置组（enabled / order / extra）。
2. **`jev_choose` 在 0.7.3 的任何宿主里都调不到**。它的 `options` 参数声明了 `minItems`/`maxItems`，被宿主值模式 DSL 拒绝（`JsonSchemaError: unsupported JSON schema: parameters.options.minItems is not supported by the value schema DSL`），`defineTool` 抛错被单工具隔离吞掉，而 boot 测试只断言 4 个工具 —— 于是 0.7.3 发布了一个没人能调的主打功能。现已删掉这两个关键字，2–10 个候选 / 每项 ≤800 字符 / context ≤2000 字符由 `lib/counsel.js` 的 `validateOptions` 在运行时保证。
3. **诚实性与健壮性**：`choosePresentation` 永不抛且 JSON 可逆；`formatChoose` 对非对象降级为 `jev_choose | 尚无结果（仍在运行或已失败）`；boot 测试的 fakeCtx 改为镜像真实宿主契约（非有限 order 会抛、只认 `TOOL_GOAL`）；五个工具的描述全部改写为「返回什么、什么时候不要用」。

**验证**：`npm test` 26/26 全绿；真实 API E2E 中「先验证后发布」契合 1.93/3 · 风险 23% · 综合 50%，陷阱项「直接发布」0.11/3 · 风险 90%，总 895 ms、$0.0000674（1605 in + 99 out）、模型 `jev-1.13.0`；内置 27 题基准 96.3%（26/27），2026-09-21 实测、2026-09-28 复测，`jev-latest` 中位 283–484 ms，单轮 $0.000365。

**安装/升级**：`dsh plugin --profile web add dsh-jev-verify`，然后重启宿主。**请跳过 0.7.3 的 `jev_choose`**（该版本该工具在任何宿主都无法注册）。本插件只走真实 API，没有 key 时明确报错，绝不伪造结果。
