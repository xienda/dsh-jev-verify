# v0.7.5 — the guard stops over-blocking, the ledger stops lying, jev_verify gets 2.5× faster

**Release date:** 2026-10-04 · **npm:** [`dsh-jev-verify@0.7.5`](https://www.npmjs.com/package/dsh-jev-verify) · **commit:** `57ccb0e` · **full diff:** [`6a91e7d...57ccb0e`](https://github.com/xienda/dsh-jev-verify/compare/6a91e7d...57ccb0e)

A three-way audit of 0.7.4 (server, client, docs/packaging) produced 24 findings. This release fixes all of them. Three were more than cosmetic: the deterministic guard both **over-blocked harmless text** and **under-detected real command variants**, the dashboard ledger **recorded nothing at all** unless the dashboard page was enabled, and `jev_verify` ran its 27 live calls strictly serially at ~10.1 s — close to its own host timeout.

---

## 1. The auto-guard: two deterministic tiers, and it now reads position

**Before**, all patterns matched anywhere in the argument text, case-insensitively. Writing *about* a dangerous command — in a README, in a test, in the plugin's own guard source, in a commit message, even in these release notes — was blocked exactly like running it. At the same time the root-recursive-delete matcher required the target to follow the flags immediately, so extra flags in between, or the `--flag=value` form, slipped past it entirely and fell through to the shared risky-verb branch.

**Now**:

- 7 **hard** rules fire only at an **executable position** — the start of the text, or after a separator — and only when the tokens before the match are at most four wrappers / env assignments / flag words. A hard-rule match anywhere else is demoted to the soft tier and its pattern is reported with a ` (quoted/described)` suffix, so the audit trail still says which rule matched.
- The root-recursive-delete matcher walks tokens instead of using a word regex: flags in any order, extra flags, `--flag=value`, and separator-delimited commands are all handled; the first non-flag token after the flags is the target. Recursive deletes aimed at a build directory or a temp path are no longer hard blocks — they go to Jev as a soft signal — while a target that is the filesystem root, a home directory, a drive root or the current directory stays a hard block.
- 3 **soft** rules (taking the host down, git-history rewrite short of a force push, always-true conditional on a delete/update) are always handed to Jev against `denyThreshold`.
- Totals are unchanged: **7 hard + 3 soft = 10 rules**.

## 2. The guard now reports what it does

`onSafetyDeny` fires for **both** tiers and carries the tool name; the Jev tier adds the confidence. The loop check fires `onLoopAdvisory` with the tool name. Before, a single event existed for one tier only, which made two consumers dead code: the dashboard's Jev-verdict branch and its advisory counter always saw zero.

## 3. `jev_overview` no longer reports zeros

The ledger's `record()` returned early unless the dashboard routes had been mounted — and routes mount only when `dashboard.enabled === true`, which defaults to false. Result: every `jev_overview` call reported 0 calls, 0 tokens, $0, and `$DSH_HOME/jev-roll.jsonl` was never written, contradicting both the README and the settings text.

**Fix:** the in-memory ring always records; only the HTTP route and the JSONL append are gated by `dashboard.enabled`. Cost accounting uses the injected per-MTok constant instead of a hardcoded literal.

## 4. `jev_verify` runs six calls at a time

`runCase` + batches of `Promise.all` with `VERIFY_CONCURRENCY = 6`, results accumulated in case order. Measured wall clock **3.999 s** versus **10.07 s** serial (**2.52×**), comfortably inside the host timeout. Accuracy is unchanged at **96.3% (26/27)**.

## 5. Better errors, more honest audit

- `missingKeyError(tool)` names the tool that was actually called. It used to hardcode `jev_decision`, so `jev_choose` and the dashboard playground told users to check the wrong key.
- `TYPESAFE_BASE_URL` / `TYPESAFE_MODEL` now really override the schema default. The config default was read first, so a user pointing the plugin at a self-hosted endpoint was silently sent to the public API.
- The in-session verdict cache is capped at **200** entries (`MAX_VERDICTS`); a long session can no longer grow it without bound.
- `jev_verify` reports the **full** `mislabeled` list plus `mislabeledHighConfidence`. Previously, one high-confidence mislabel replaced the whole array, so low-confidence misses disappeared from the report.
- `safe(tag, fn)` accumulates registration failures, and `jev_guard_status` exposes them under `registrations`, so a silently swallowed `defineTool` failure can no longer ship unnoticed.

## 6. Client fixes

- **noul confidence** now reports the probability of the answered side: a "no" at p 0.02 used to render "置信度 2%" with warning colour, while the overview card showed the same value as 2% — the two surfaces contradicted each other.
- **`jev_choose` views are auditable**: the state text and every candidate's text are kept, so a ranking table can be read without re-running the call.
- **Overview cards** show `avgLatencyMs` and `typeCounts`, which the server already sent and the card dropped.
- **Dashboard page** shows an error surface instead of staying on "加载中…" forever when a fetch fails.
- **Credential badge is tri-state**: an env-var name alone reads "read from environment (not verified)" and never "configured".
- Removed the dead CSS variable (highlight and chip fill work again in dark themes); the running chip only claims "0 questions" where that is meaningful.

## 7. Packaging and docs

- `test/functional.mjs` → `test/functional.test.mjs`, so the real HTTP-contract test actually runs in `npm test` (**27 tests**, was 26).
- `bench/choose-e2e.mjs` no longer hardcodes one machine's home directory: it reads `TYPESAFE_API_KEY` from the environment, then falls back to the DSH home.
- `bench/bench.mjs` gained `--concurrency` (default 6) and reports it.
- README p95 band corrected to the measured tail (**825–1468 ms**; single-run peaks reach ~1.5 s and a congested network ~5 s), test count corrected, `engines.dsh` documented as informational only (npm does not enforce it), and the rule split documented as 7 hard / 3 soft / 10 total.
- `package-lock.json` brought to 0.7.5.

## Verified

- `npm test`: **27/27** green (12 files, 2559 ms), including 9 guard suites that assert position-aware tiering, flag-order independence, both event payloads with the tool name, and the 200-entry cache cap.
- **Live benchmark** (2026-10-04, concurrency 6): **96.3% (26/27)**, median **282 ms**, p95 **1468 ms**, min 231, max 1471, wall **3999 ms**, 8696 input + 822 output tokens ≈ **$0.000365**; report `bench/results/2026-10-04T12-40-07-421Z.json`. The single mislabel is unchanged (`severity-low`, 0.01 vs expected 0).
- **Live `jev_choose` E2E** (2026-10-04): recommended "verify, then publish" fit **1.89/3** · risk **22%** · composite 49% · confidence 42%; the reckless option fit 0.1/3 · risk 90%; 933 ms, $0.0000674 (1605 in + 99 out), model `jev-1.13.0`.
- The guard rewrite is its own evidence: the old deterministic tier blocked this release's source, its commit message and these notes while they were being written; the new tier lets the same text through while still blocking the same operations at executable position.

## Install / upgrade

```
dsh plugin --profile web add dsh-jev-verify
```

Afterwards, cycle the host process: plugin code is loaded at start-up, so a running host keeps the previous version in memory.

## Honest caveats

- `jev_overview` counts from the moment the plugin instance started; it is not a persistent history unless `dashboard.enabled` is on (which is when the JSONL file is written).
- Latency is network-dependent. The p95 above is one measured run; a congested network can reach ~5 s, which is why `DEFAULT_TIMEOUT_MS` is 15000.
- The guard is a **fail-open** backstop, not a sandbox: if Jev is unreachable or the per-session budget is exhausted, suspicious commands pass. Hard rules stay in force because they are local and free.
- Jev returns verdicts and calibrated probabilities, never explanations. Any reason shown in a tool view is written by the calling model, not by Jev.

---

## 中文摘要

三路审计（服务端 / 客户端 / 打包文档）在 0.7.4 上共提 24 条问题，本版全部修复。三处要害：**确定性护栏既误拦又漏检**——旧实现按整段文本做大小写不敏感匹配，写在文档、测试、插件自身源码、提交信息甚至本发布说明里的危险命令都会被硬拦，而对根目录递归删除的识别要求 flag 后紧跟目标，额外 flag 或 `--flag=value` 写法直接漏过；**看板账本何时都记 0**——`record()` 在路由未挂载时直接返回，而路由只在 `dashboard.enabled` 为真时挂载（默认 false），于是 `jev_overview` 恒报 0 调用 0 token $0，JSONL 永不落盘；**`jev_verify` 串行 27 次调用墙钟 10.07 s**，逼近宿主超时。

本版改动：护栏改为**硬/软两层 + 位置感知**（7 硬 + 3 软 = 10 条不变；硬规则只在可执行位置生效，正文/引号内降级为软并标注 `(quoted/described)`；根目录删除改为逐 token 解析，flag 乱序、额外 flag、`=` 取值与分隔符之后均能识别；对普通相对目录的递归删除降为交给 Jev），两层都上报 `onSafetyDeny`（带工具名，Jev 层带 confidence）、循环检测上报 `onLoopAdvisory`（带工具名）；账本内存 ring 永远记录、仅 HTTP 路由与 JSONL 落盘受 `dashboard.enabled` 控制，成本常量改为注入；`jev_verify` 以 6 路并发运行（墙钟 3999 ms，串行 10.07 s 的 2.52×），精度仍是 96.3%（26/27）；`missingKeyError` 按工具名报错、`TYPESAFE_BASE_URL`/`TYPESAFE_MODEL` 覆盖真正生效、判定缓存上限 200、`mislabeled` 全量并新增 `mislabeledHighConfidence`、注册失败累积到 `jev_guard_status.registrations`；客户端修 noul 置信度、`jev_choose` 可审计、概览卡补 `avgLatencyMs`/`typeCounts`、看板错误面、凭据徽章三态、死 CSS 变量；打包把 functional 测试改名以真正进入 `npm test`（27 项）、bench 去掉硬编码家目录并支持 `--concurrency`、README 延迟尾部分位与测试计数诚实化、lockfile 升到 0.7.5。

实测：`npm test` 27/27；真实基准 2026-10-04（并发 6）96.3%（26/27），中位 282 ms、p95 1468 ms、墙钟 3999 ms、约 $0.000365；真实 `jev_choose` E2E 推荐项契合 1.89/3 · 风险 22% · 933 ms · $0.0000674。诚实边界：账本自插件实例启动起算；护栏是 **fail-open** 兜底而非沙箱；Jev 只给判定与概率，不给解释。
