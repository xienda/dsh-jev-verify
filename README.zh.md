# dsh-jev-verify

把 TypeSafe AI 的 **Jev（System One 决策模型）**接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的一等公民插件。

Jev 不生成文本：给定 `state` 与类型化问题，它用**一次并行 API 调用**返回**带校准概率的类型化判定**（官方宣称 ~70–500ms）。本插件把它封装成 Agent 工具，附加可选的**自动护栏**（风险/循环检测），并且坚持「验证过的才叫有效」：

| 工具 | 作用 |
| --- | --- |
| `jev_decision` | 对 `state` 一次性提出 Choice / Score / Noul 问题。返回类型化答案、置信度、概率分布、token 用量、实测延迟与估算成本。 |
| `jev_choose` | 对 2–10 个候选方案/路线并行打分排序（每方案：契合度 score 0–3 + 风险 noul），返回有序排名表与推荐项。Jev 只打分不解释——得分是多方案岔路口的快速校准参考，最终判断仍由你（代理）综合做出。 |
| `jev_verify` | 对**线上真实 API** 运行内置带标签基准（27 个带标签问题，含护栏判定），返回实测准确率、中位/p95 延迟、置信校准与成本——这是防欺骗的自我验证。 |
| `jev_guard_status` | 审计自动护栏：计数、受保护工具、阈值、预算——护栏行为始终透明可见。 |

**自动护栏模式**（可选开启 `autoGuard.enabled`）：在 shell 类工具（bash/pwsh/run_code 等）执行前，先用零成本的确定性黑名单拦下硬性破坏命令（rm -rf /、格式化磁盘、删库、凭据外泄等）；其余可疑命令由 **Jev 真实判定**风险（noul 超阈值即拒绝；API 故障时 fail-open 放行并告警，绝不假装检查过）。循环守卫对连续相同工具的调用做语义停滞判定，只注入纠偏建议、不阻断。所有判定可通过 `jev_guard_status` 审计。

**诚实设计，绝不造假**：

- 未配置 `TYPESAFE_API_KEY` 时，工具与护栏都会用明确的报错说明如何配置；
- 每次 `jev_decision` 结果都带回 model、延迟与 token 用量，可审计；
- `jev_verify` 拒绝报告任何未经实测的数字；
- 独立的基准 CLI（`bench/bench.mjs`）零依赖，任何人可用任意 Key 复现发布的数据。

## 0.7.3 更新

- **`jev_choose`——多方案择优工具**：一次调用对 2–10 个候选做法逐方案打分（契合度 score 0–3，带校准置信度；风险 noul），合成综合分（`fit/3 × (1−risk)`），返回排名表、推荐项与每方案延迟/成本。使用指引已注入代理 system prompt（「多方案叉路 → 先调 `jev_choose`」），对话内渲染为排名表格（ChooseBody），并计入看板决策统计（`kind: choose` 并入 decisions）。
- **0.7.3 已部署**：`D:\lab\jev`（vendor）与 web profile pnpm store 三处字节一致（MD5 全等）；`node --check` 全绿；`rankOptions` 以 mock 传输层完成单元验证。

## 0.7.2 更新

- **基准表述与代码对齐**：`jev_verify` 的工具描述此前写着「24 questions across 15+ cases」，而 `lib/cases.js` 自 v0.2.0 起一直是 27 个带标签问题（27 个用例，含护栏判定）；v0.7.2 统一为 27，README、market PR 稿与验证报告同步更正。
- **2026-09-28 复测**（本版本发布前，run 4）：准确率 **96.3%（26/27）**、8,696 input tokens ≈ **$0.000365**、中位延迟 484 ms（受网络影响）；终端全文见 `bench/run4.log`。

## 0.7.1 更新

- **仅文档同步（0.7.1 的代码与 0.7.0 一致）**：验证报告补齐完整实测历史——2026-09-21 基准与护栏实测、2026-09-23 GUI 卡片/设置卡重做/对话内视图、2026-09-26 两代设置 API 兼容、2026-09-28 v0.7.0 回归；`docs/verification.md` 现为 208 行完整记录。行为与 0.7.0 相同。
- **每个工具都有结构化对话内视图**：工具结果新增 `presentationMeta` 投影（`kind: decision | overview | guard | verify`），对话里直接渲染判定卡、护栏看板与实测报告——答案、置信度条、状态标签与统计格，而不再是原始文本；缺少 `meta` 时自动回退解析工具文本。
- **完整插件设置卡**：「设置 → 插件 → 插件配置 → Jev」现在覆盖全部选项：凭据（Key、凭据引用、API 地址、模型、超时、问题数上限）、工具开关、整组自动护栏（安全/循环开关、受护栏工具清单、拦截阈值、Jev 预算、循环参数）与看板（开关 + 路径），带数值校验与未保存状态处理。
- **配置处理加固**：使用前会解包 schemastery 的 volatile 字段（`.volatile()`），因此对象形态的 `apiKeyEnv` 不再让 `credentialRef(...)` 崩溃，`autoGuard.enabled` / `dashboard.enabled` 真正生效，数值型选项也按数字读取。
- **测试 19 项全绿**（`npm test`）：覆盖启动、客户端渲染、工具视图、设置卡、看板、护栏与展示投影。

## 为什么是 Jev

TypeSafe AI（创始人 Diogo Almeida，前 OpenAI、ChatGPT 研究方向）于 2026-09-15 发布 Jev，定位首个「System One」模型：输入非结构化状态，输出类型化概率判定。在智能体高频原子判定场景（分类、路由、分诊、评分、护栏、真伪判断）上，Jev 比前沿对话 LLM 快数十到两百倍（输入 $0.042/百万 token，输出免费）。适合承担 Agent 循环里高频「快判断」，把「慢思考」留给大模型。

## 安装

要求 Node >= 20，dsh >= 0.1.5-rc.2。

```sh
dsh plugin --profile web add dsh-jev-verify
```

然后在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 增加加载条目：

```yaml
- insert:
    - id: jev-verify
      name: dsh-jev-verify
      config:
        autoGuard:
          enabled: true     # 可选：开启自动护栏
```

重启 profile（或用插件市场一键安装，市场会自动完成以上两步）。

> 也可先安装 GUI 插件市场：`dsh plugin --profile web add dshmarket`，然后在「设置 → 插件市场」中一键安装本插件。

## API Key

到 <https://console.typesafe.ai/keys> 免费创建。任选其一：

1. 启动环境里 `export TYPESAFE_API_KEY=...`；
2. 设置 → 插件 → 插件配置 → Jev（凭据服务）；
3. 插件配置里写 `apiKey`。

可选环境变量：`TYPESAFE_BASE_URL`（默认 `https://api.typesafe.ai/v1`）、`TYPESAFE_MODEL`（默认 `jev-latest`）。

## 使用

任何需要快速判定的场景，直接让 Agent 调用 `jev_decision`。示例提示词：

> 用 `jev_decision` 评估 state = "<工单文本>"，问题：`department`（choice，billing/technical/sales）、`is_urgent`（noul）、`severity`（score，3 级）。报告答案与置信度。

随时可让 Agent 执行 `jev_verify` 确认端点健康并获取实测数据，或 `jev_guard_status` 查看护栏状态。

### 直接调用形态

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

返回每个问题的 `answers`（choice/score/noul + confidence + probabilities）、`usage`、`latencyMs` 与 `estimatedCostUs`。

## 自动护栏

`autoGuard.enabled: true` 时，两个钩子守护受保护的每个工具调用：

1. **安全门禁**（`tools/pre-execute`）：先跑确定性黑名单（免费），可疑命令交给 **Jev** 判定风险；超过 `denyThreshold` 即拒绝并给出明确理由；Jev 不可用时 fail-open 放行并告警。
2. **循环检测**（`tools/post-execute`）：连续同工具、输出较长的调用触发 Jev 停滞判定；判定停滞时向下一个请求注入非阻断式纠偏建议，随后进入冷却。

两者都优雅降级，且全部计数可由 `jev_guard_status` 审计。实测演示（2026-09-21）：`remove-item -Recurse …` 被确定性规则拦截；"permanently wipe all staging data and delete every row from every table" 被 **Jev 以 91% 置信度**（阈值 0.8）在执行前拦截。

## 运行可视化（不另开页面）

可视化**直接在对话里看**，不再需要单独网页：

每个工具都带 `presentationMeta` 投影，结果以结构化卡片渲染，而不是原始 JSON：

- `jev_overview` — 决策看板：状态标签（模型 / Key / 护栏 / 阈值）、8 个统计格（判定数、实测数、拦截数、提示数、中位延迟、平均置信度、input tokens、累计成本）以及最近的判定与护栏事件。
- `jev_verify` — 线上实测报告：准确率、答对数、高置信准确率、中位与 p95 延迟、token、成本与误判用例。
- `jev_guard_status` — 护栏卡片：受护栏工具、拦截阈值、本会话预算、安全与循环计数、最近一次受检工具。

需要独立网页版时可选开启：`dashboard.enabled: true` 后访问 http://127.0.0.1:3080/jev。
所有决策/验证/护栏事件还会追加到 `$DSH_HOME/jev-roll.jsonl` 供外部工具使用。

## 验证（实测、带日期）

方法学与最新实测结果见 [docs/verification.md](docs/verification.md)。

**当前状态**：✅ **已于 2026-09-21 对线上 API 实测**（`jev-latest`）：含护栏用例的 27 题基准准确率 **96.3%**（26/27），中位延迟 **283–308 ms**，27 题全程成本 **≈ $0.0004**。唯一误标为已记录的边界值（severity 得分 0.01 vs 期望 0）。

随时可复现：

```sh
TYPESAFE_API_KEY=... node bench/bench.mjs            # 1 轮（27 个问题）
TYPESAFE_API_KEY=... node bench/bench.mjs --repeat 3 # 延迟稳定性
```

或直接让 Agent 执行「run jev_verify」。

**回归验证（2026-09-28，v0.7.0）**：在 headless profile（`autoGuard.enabled: true`）中，`jev_guard_status` 正确报告已武装的护栏（工具清单、`deny threshold 0.8`、预算），`jev_overview` 正常返回看板，不再出现此前的 `credentialRef` 崩溃——即 volatile 配置解包修复；`npm test` 19/19 通过。

## 配置项

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `apiKeyEnv` | `TYPESAFE_API_KEY` | 凭据引用 / 环境变量 |
| `apiKey` | — | 字面 Key（secret） |
| `baseURL` | `https://api.typesafe.ai/v1` | API 地址 |
| `model` | `jev-latest` | 模型（可钉版如 `jev-1.13.0`） |
| `timeoutMs` | 15000 | 单次调用超时 |
| `maxQuestionsPerCall` | 25 | 单次调用问题数上限 |
| `verifyEnabled` | true | 是否注册 `jev_verify` |
| `autoGuard.enabled` | false | 自动护栏总开关 |
| `autoGuard.safetyCheck` | true | 高危命令执行前检查 |
| `autoGuard.loopCheck` | true | 语义循环检测 |
| `autoGuard.tools` | bash/pwsh/run_code/terminal | 护栏覆盖的工具 |
| `autoGuard.denyThreshold` | 0.85 | Jev noul ≥ 阈值 ⇒ 拒绝/建议 |
| `autoGuard.maxJevCallsPerSession` | 50 | 单会话护栏 Jev 预算 |
| `autoGuard.loopConsecutive` | 3 | 连续同工具调用触发检测的阈值 |
| `autoGuard.loopCooldownMs` | 60000 | 停滞判定后冷却 |
| `autoGuard.loopMinChars` | 200 | 循环检测的最小输出长度 |
| `autoGuard.statusTool` | true | 注册 `jev_guard_status` |
| `autoGuard.determinismFirst` | true | 先跑免费的确定性检查再交给 Jev |
| `dashboard.enabled` | false | 是否提供独立看板页面 |
| `dashboard.basePath` | `/jev` | 独立看板的访问路径 |

## 相关项目

- [dsh-jev](https://www.npmjs.com/package/dsh-jev) — Jev 守卫套件（循环守卫、安全门禁、工具剪枝），zhangxaochen。
- [dsh-jev-tools](https://www.npmjs.com/package/dsh-jev-tools) — 自动化 Jev 判定 + 判定台账，horusj。
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) — 基于 Jev 的浏览器 Agent。
- [APUS fast-browser-use](https://www.qbitai.com/2026/09/492939.html) — Jev 决策范式的本地复现（浏览器自动化）。

本插件的差异化：**完整干净的原语 + 可审计的自动护栏 + 诚实可复现的验证基准**，直面真实 TypeSafe API。

## License

MIT