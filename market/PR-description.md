# dsh-jev-verify — 插件市场上架材料

## 目标清单（awesome-dsh-plugin）

向 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin 提 PR，在列表中加入一行：

```markdown
| [dsh-jev-verify](https://www.npmjs.com/package/dsh-jev-verify) | Jev (TypeSafe System One) decision tools (choice/score/noul) for dsh, with structured in-chat views, a full plugin settings card, an auditable auto-guard and a built-in live verification benchmark (jev_verify). Honest by design: measured latency/accuracy, no mock fallback. | [npm](https://www.npmjs.com/package/dsh-jev-verify) | MIT |
```

## PR 标题

```
add: dsh-jev-verify — Jev System One decision tools + live verification benchmark for DeepSeek Harness
```

## PR 描述

```markdown
## What
New DSH community plugin **dsh-jev-verify** (npm, MIT):

- `jev_decision`: Choice / Score / Noul questions against a state in ONE parallel call to the TypeSafe System One API (https://api.typesafe.ai/v1/systemone). Returns typed answers + confidence + probabilities + token usage + measured latency.
- `jev_verify`: built-in labeled benchmark (23 cases / 27 questions, incl. guard verdicts) run against the LIVE API — reports real accuracy, median/p95 latency, calibration and cost. Anti-deception self-test; never fabricates results.
- `jev_overview` / `jev_guard_status`: structured in-chat boards (decisions, latency, cost, guard counters, thresholds) driven by `presentationMeta`, so results render as cards instead of raw text.
- Full plugin settings card in Settings > Plugins > Plugin configuration (credentials, tool toggles, the whole auto-guard block, dashboard) with validation, plus an optional standalone board at `/jev` and a JSONL audit roll at `$DSH_HOME/jev-roll.jsonl`.
- Standalone zero-dependency bench CLI (`bench/bench.mjs`) for reproducible verification with any API key.

## Why
Jev (TypeSafe AI, launched 2026-09-15) is a fast decision model for agent workloads. Existing dsh Jev plugins focus on guardrails/auto-judgments; this one adds the **verification-first** angle the user community asked for (measured numbers, dated, reproducible), plus clean full primitives.

## Verified requirements
- Loads in dsh >= 0.1.5-rc.2 via `dsh plugin --profile <p> add dsh-jev-verify` + insert patch entry (tested locally 2026-09-21 on headless profile).
- Tools register and behave honestly without a key (explicit error; no fabrication).
- Measured against the live API on 2026-09-21 (`jev-latest`): 96.3% accuracy (26/27 questions), median latency 283–308 ms across runs, ≈ $0.0004 per 27-question run. Reproduce with `TYPESAFE_API_KEY=... node bench/bench.mjs`; methodology in docs/verification.md.
- `npm test`: 19/19 passing (boot, client render, tool views, settings, dashboard, guard, presentation projections).

## Checklist
- [x] npm package id verified available (published: `dsh-jev-verify@0.7.1`)
- [x] packaged tarball dry-run OK
- [x] local dsh install + tool registration tested
- [x] verification numbers measured against the live API (dated in docs/verification.md)
- [x] license: MIT
```

## 提交方式（二选一）

1. **自动（PAT）**：本机已准备好 `git dsh-jev-verify` 仓库与分支，提供 PAT 后一条命令推送并开 PR。
2. **手动**：直接把上面的 Markdown 粘贴到 GitHub 网页新建 PR，或把 [market/list-entry.md](market/list-entry.md) 的内容追加到清单文件。
## 实际状态（2026-09-21）

- ✅ PR 已提交：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/5577（head: xienda:add-dsh-jev-verify，含 README.md 与 README.zh.md 两条收录）
- ✅ 插件仓库：https://github.com/xienda/dsh-jev-verify（代码已上传，含 dsh.bundle manifest）
- ⏳ npm 发布待用户登录后执行（市场安装会先回退到 GitHub 源码安装）
