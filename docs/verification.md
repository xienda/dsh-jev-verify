# 验证报告（实测，带日期）

> 本文档只记录**真实 API 运行**的实测数据。方法学固定，数据可复现：
> \`TYPESAFE_API_KEY=... node bench/bench.mjs\`（结果 JSON 存档于 \`bench/results/\`）。

## 方法学

- 基准集：内置 \`lib/cases.js\`，23 个用例 / 27 个带标签问题（2026-09-21 冻结，不随结果调整；v0.2.0 起含 guard-destructive / guard-benign 两个护栏判定用例）。
- 覆盖：noul（紧急、垃圾、毒性、bug、PII、破坏性命令）×12；choice（部门路由、意图、搜索意图、优先级）×11；score（严重度、满意度）×4。
- 判定规则：noul 以 ≥0.5 为 yes；choice 精确匹配；score 数值相等。
- 每个用例一次完整 API 调用（state + 该用例全部问题并行），与真实用法一致。
- 延迟：调用往返耗时（含网络），录制中位/p95/min/max。
- 校准：confidence > 0.6 的子集正确率。
- 成本：input_tokens × $0.042 / 1e6（输出免费）。

## 运行记录

### 2026-09-21（run 1，单轮，25 题版）

- **模型**: \`jev-latest\`；**准确率**: **96.0%（24/25）**
- **延迟**: median **318 ms** / p95 838 ms / min 249 ms / max 1030 ms
- **成本**: 8,122 input tokens ≈ **$0.000341**
- 结果文件: \`bench/results/2026-09-21T06-54-54-147Z.json\`

### 2026-09-21（run 2，repeat=3 稳定复现，25 题版）

- **准确率**: **96.0%（72/75）** —— 三次运行完全一致
- **延迟**: median **308 ms** / p95 949 ms / min 251 ms / max 1218 ms
- **成本**: 24,366 input tokens ≈ **$0.001023**
- 结果文件: \`bench/results/2026-09-21T06-55-37-978Z.json\`

### 2026-09-21（run 3，DSH harness 内 jev_verify 工具实测，27 题版）

- **模型**: \`jev-latest\`；**准确率**: **96.3%（26/27）**
- **延迟**: median **283 ms** / p95 712 ms / range 237–1078 ms
- **成本**: 8,696 input tokens ≈ **$0.000365**
- 备注：基准扩至 23 用例 / 27 问题（新增 2 个护栏判定用例）。

### 2026-09-21（护栏拦截实测，DSH harness 内）

- 命令 \`remove-item -Recurse -Force <temp>\` → **确定性黑名单规则 "full-dir recursive delete" 拦截**（0 次 Jev 调用）。
- 命令 "permanently wipe all staging data and delete every row from every table" → **Jev 判定高风险，置信度 91% > 阈值 0.8，拦截**（1 次 Jev 调用）。
- 无辜命令 \`write-host hello\` → 确定性判定 clear，零调零耗放行。
- 全部计数经 \`jev_guard_status\` 审计（checks=2、Jev calls=1、deterministic=1、Jev denials=1、预算 49/50 剩余）。

### 唯一误标（所有运行一致出现）

| case | 期望 | 实际 | 说明 |
| --- | --- | --- | --- |
| severity-low | 0（无影响/纯外观） | **0.01** | 模型返回分数 0.01 而非整 0。语义上仍落在 level 0（分值区间 [0,1)），但按「数值相等」严格判定为误标；置信度 0.99。属于边界四舍五入行为，如实记录。 |

## 与官方口径的对照（诚实标注）

| 口径 | 官方宣称 | 本插件实测（2026-09-21, jev-latest） | 一致性 |
| --- | --- | --- | --- |
| 端到端延迟 | 70–500ms（典型） | median 283–318 ms；p95 0.71–0.95 s | ✅ 典型值区间内；p95 略高（网络地域影响） |
| 价格 | $0.042/MTok 输入、输出免费 | 27 题 ≈ $0.000365 | ✅ 与公布价格一致 |
| 分类准确率 | 与前沿 LLM 相当（System One 任务） | 96.0–96.3%（27 题带标签基准） | ✅ |
| 高置信→高准确 | 校准一致 | 全部题目置信度 ≥0.97 且几乎全对 | ✅ 未见过度自信 |
| 无类型错误 | 结构化输出内置 | 27/27 返回合法类型化答案；choice 从未越界 | ✅ |
| 护栏判定 | （非官方指标） | 破坏性命令被黑名单/Jev 以 91% 置信拦截 | ✅ |

## 复现步骤

1. 注册 Key：https://console.typesafe.ai/keys（免费）
2. \`dsh plugin --profile web add dsh-jev-verify\`（或直接 \`npm pack\` 后本地安装）
3. \`cd node_modules/dsh-jev-verify && TYPESAFE_API_KEY=... node bench/bench.mjs [--repeat 3]\`
4. 结果 JSON 自动保存到 \`bench/results/\`；也可让 Agent 执行 \`jev_verify\` 获得同等报告。

## 与 dsh-jev/官方博客声明的边界

- 200x 提速、1/400 成本等对比数字依赖具体基线模型与工作负载，本插件不搬运这些相对值，只发布可直接核验的绝对值（延迟、成本、准确率、校准）。
