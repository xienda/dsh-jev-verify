# dsh-jev-verify

把 TypeSafe AI 的 **Jev（System One 决策模型）**接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的一等公民插件。

Jev 不生成文本：给定 \`state\` 与类型化问题，它用**一次并行 API 调用**返回**带校准概率的类型化判定**（官方宣称 ~70–500ms）。本插件把它封装成 Agent 工具，附加可选的**自动护栏**（风险/循环检测），并且坚持「验证过的才叫有效」：

| 工具 | 作用 |
| --- | --- |
| \`jev_decision\` | 对 \`state\` 一次性提出 Choice / Score / Noul 问题。返回类型化答案、置信度、概率分布、token 用量、实测延迟与估算成本。 |
| \`jev_verify\` | 对**线上真实 API** 运行内置带标签基准（23 用例 / 27 问题，含护栏判定），返回实测准确率、中位/p95 延迟、置信校准与成本——这是防欺骗的自我验证。 |
| \`jev_guard_status\` | 审计自动护栏：计数、受保护工具、阈值、预算——护栏行为始终透明可见。 |

**自动护栏模式**（可选开启 \`autoGuard.enabled\`）：在 shell 类工具（bash/pwsh/run_code 等）执行前，先用零成本的确定性黑名单拦下硬性破坏命令（rm -rf /、格式化磁盘、删库、凭据外泄等）；其余可疑命令由 **Jev 真实判定**风险（noul 超阈值即拒绝；API 故障时 fail-open 放行并告警，绝不假装检查过）。循环守卫对连续相同工具的调用做语义停滞判定，只注入纠偏建议、不阻断。所有判定可通过 \`jev_guard_status\` 审计。

**诚实设计，绝不造假**：

- 未配置 \`TYPESAFE_API_KEY\` 时，工具与护栏都会用明确的报错说明如何配置；
- 每次 \`jev_decision\` 结果都带回 model、延迟与 token 用量，可审计；
- \`jev_verify\` 拒绝报告任何未经实测的数字；
- 独立的基准 CLI（\`bench/bench.mjs\`）零依赖，任何人可用任意 Key 复现发布的数据。

## 为什么是 Jev

TypeSafe AI（创始人 Diogo Almeida，前 OpenAI、ChatGPT 研究方向）于 2026-09-15 发布 Jev，定位首个「System One」模型：输入非结构化状态，输出类型化概率判定。在智能体高频原子判定场景（分类、路由、分诊、评分、护栏、真伪判断）上，Jev 比前沿对话 LLM 快数十到两百倍（输入 $0.042/百万 token，输出免费）。适合承担 Agent 循环里高频「快判断」，把「慢思考」留给大模型。

## 安装

要求 Node >= 20，dsh >= 0.1.5-rc.2。

\`\`\`sh
dsh plugin --profile web add dsh-jev-verify
\`\`\`

然后在 \`$DSH_HOME/profiles/<profile>/cordis.patch.yml\` 增加加载条目：

\`\`\`yaml
- insert:
    - id: jev-verify
      name: dsh-jev-verify
      config:
        autoGuard:
          enabled: true     # 可选：开启自动护栏
\`\`\`

重启 profile（或用插件市场一键安装，市场会自动完成以上两步）。

> 也可先安装 GUI 插件市场：\`dsh plugin --profile web add dshmarket\`，然后在「设置 → 插件市场」中一键安装本插件。

## API Key

到 <https://console.typesafe.ai/keys> 免费创建。任选其一：

1. 启动环境里 \`export TYPESAFE_API_KEY=...\`；
2. 设置 → 插件 → 插件配置 → Jev（凭据服务）；
3. 插件配置里写 \`apiKey\`。

可选环境变量：\`TYPESAFE_BASE_URL\`（默认 \`https://api.typesafe.ai/v1\`）、\`TYPESAFE_MODEL\`（默认 \`jev-latest\`）。

## 使用

任何需要快速判定的场景，直接让 Agent 调用 \`jev_decision\`。示例提示词：

> 用 \`jev_decision\` 评估 state = "<工单文本>"，问题：\`department\`（choice，billing/technical/sales）、\`is_urgent\`（noul）、\`severity\`（score，3 级）。报告答案与置信度。

随时可让 Agent 执行 \`jev_verify\` 确认端点健康并获取实测数据，或 \`jev_guard_status\` 查看护栏状态。

### 直接调用形态

\`\`\`jsonc
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
\`\`\`

返回每个问题的 \`answers\`（choice/score/noul + confidence + probabilities）、\`usage\`、\`latencyMs\` 与 \`estimatedCostUs\`。

## 自动护栏

\`autoGuard.enabled: true\` 时，两个钩子守护受保护的每个工具调用：

1. **安全门禁**（\`tools/pre-execute\`）：先跑确定性黑名单（免费），可疑命令交给 **Jev** 判定风险；超过 \`denyThreshold\` 即拒绝并给出明确理由；Jev 不可用时 fail-open 放行并告警。
2. **循环检测**（\`tools/post-execute\`）：连续同工具、输出较长的调用触发 Jev 停滞判定；判定停滞时向下一个请求注入非阻断式纠偏建议，随后进入冷却。

两者都优雅降级，且全部计数可由 \`jev_guard_status\` 审计。实测演示（2026-09-21）：\`remove-item -Recurse …\` 被确定性规则拦截；"permanently wipe all staging data and delete every row from every table" 被 **Jev 以 91% 置信度**（阈值 0.8）在执行前拦截。

## 运行可视化（不另开页面）

可视化**直接在对话里看**，不再需要单独网页：

- `jev_overview` — 随时让 Agent 执行：在对话内渲染紧凑决策看板（最近答案+置信度、中位/p95 延迟、累计统计、护栏事件、Key/护栏状态）。
- `jev_verify` — 线上真实基准（准确率/延迟/校准）。
- `jev_guard_status` — 护栏计数与阈值审计。

需要独立网页版时可选开启：`dashboard.enabled: true` 后访问 http://127.0.0.1:3080/jev。
所有决策/验证/护栏事件还会追加到 `$DSH_HOME/jev-roll.jsonl` 供外部工具使用。

## 验证（实测、带日期）

方法学与最新实测结果见 [docs/verification.md](docs/verification.md)。

**当前状态**：✅ **已于 2026-09-21 对线上 API 实测**（\`jev-latest\`）：含护栏用例的 27 题基准准确率 **96.3%**（26/27），中位延迟 **283–308 ms**，27 题全程成本 **≈ $0.0004**。唯一误标为已记录的边界值（severity 得分 0.01 vs 期望 0）。

随时可复现：

\`\`\`sh
TYPESAFE_API_KEY=... node bench/bench.mjs            # 1 轮（27 个问题）
TYPESAFE_API_KEY=... node bench/bench.mjs --repeat 3 # 延迟稳定性
\`\`\`

或直接让 Agent 执行「run jev_verify」。

## 配置项

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| \`apiKeyEnv\` | \`TYPESAFE_API_KEY\` | 凭据引用 / 环境变量 |
| \`apiKey\` | — | 字面 Key（secret） |
| \`baseURL\` | \`https://api.typesafe.ai/v1\` | API 地址 |
| \`model\` | \`jev-latest\` | 模型（可钉版如 \`jev-1.13.0\`） |
| \`timeoutMs\` | 15000 | 单次调用超时 |
| \`maxQuestionsPerCall\` | 25 | 单次调用问题数上限 |
| \`verifyEnabled\` | true | 是否注册 \`jev_verify\` |
| \`autoGuard.enabled\` | false | 自动护栏总开关 |
| \`autoGuard.safetyCheck\` | true | 高危命令执行前检查 |
| \`autoGuard.loopCheck\` | true | 语义循环检测 |
| \`autoGuard.tools\` | bash/pwsh/run_code/terminal | 护栏覆盖的工具 |
| \`autoGuard.denyThreshold\` | 0.85 | Jev noul ≥ 阈值 ⇒ 拒绝/建议 |
| \`autoGuard.maxJevCallsPerSession\` | 50 | 单会话护栏 Jev 预算 |
| \`autoGuard.loopConsecutive\` | 3 | 连续同工具调用触发检测的阈值 |
| \`autoGuard.loopCooldownMs\` | 60000 | 停滞判定后冷却 |
| \`autoGuard.loopMinChars\` | 200 | 循环检测的最小输出长度 |
| \`autoGuard.statusTool\` | true | 注册 \`jev_guard_status\` |

## 相关项目

- [dsh-jev](https://www.npmjs.com/package/dsh-jev) — Jev 守卫套件（循环守卫、安全门禁、工具剪枝），zhangxaochen。
- [dsh-jev-tools](https://www.npmjs.com/package/dsh-jev-tools) — 自动化 Jev 判定 + 判定台账，horusj。
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) — 基于 Jev 的浏览器 Agent。
- [APUS fast-browser-use](https://www.qbitai.com/2026/09/492939.html) — Jev 决策范式的本地复现（浏览器自动化）。

本插件的差异化：**完整干净的原语 + 可审计的自动护栏 + 诚实可复现的验证基准**，直面真实 TypeSafe API。

## License

MIT