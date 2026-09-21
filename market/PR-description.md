# dsh-jev-verify — 插件市场上架材料

## 目标清单（awesome-dsh-plugin）

向 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin 提 PR，在列表中加入一行：

```markdown
| [dsh-jev-verify](https://www.npmjs.com/package/dsh-jev-verify) | Jev (TypeSafe System One) decision primitives (choice/score/noul) as dsh agent tools + built-in live verification benchmark (jev_verify). Honest by design: measured latency/accuracy, no mock fallback. | [npm](https://www.npmjs.com/package/dsh-jev-verify) | MIT |
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
- `jev_verify`: built-in labeled benchmark (21 cases / 25 questions) run against the LIVE API — reports real accuracy, median/p95 latency, calibration and cost. Anti-deception self-test; never fabricates results.
- Standalone zero-dependency bench CLI (`bench/bench.mjs`) for reproducible verification with any API key.

## Why
Jev (TypeSafe AI, launched 2026-09-15) is a fast decision model for agent workloads. Existing dsh Jev plugins focus on guardrails/auto-judgments; this one adds the **verification-first** angle the user community asked for (measured numbers, dated, reproducible), plus clean full primitives.

## Verified requirements
- Loads in dsh >= 0.1.5-rc.2 via `dsh plugin --profile <p> add dsh-jev-verify` + insert patch entry (tested locally 2026-09-21 on headless profile).
- Tools register and behave honestly without a key (explicit error; no fabrication).
- Real-API numbers will be documented in docs/verification.md on first run.

## Checklist
- [x] npm package id verified available
- [x] packaged tarball dry-run OK
- [x] local dsh install + tool registration tested
- [ ] verification numbers (pending API key) — README marks them as pending-until-measured
- [ ] license: MIT
```

## 提交方式（二选一）

1. **自动（PAT）**：本机已准备好 `git dsh-jev-verify` 仓库与分支，提供 PAT 后一条命令推送并开 PR。
2. **手动**：直接把上面的 Markdown 粘贴到 GitHub 网页新建 PR，或把 [market/list-entry.md](market/list-entry.md) 的内容追加到清单文件。
