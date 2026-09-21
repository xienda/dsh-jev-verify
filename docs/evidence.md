# 公开资料与证据收集（Jev）

> 本文档汇总 2026-09-21 收集到的公开信息，并区分「厂商宣称」与「本插件可独立验证」。
> 所有「实测」数字必须来自真实 API 运行（docs/verification.md），禁止转抄厂商数字冒充实测。

## 1. 模型与公司

- TypeSafe AI 创始人 **Diogo Almeida**（前 OpenAI 研究员，参与 ChatGPT/RLHF 方向研究）。来源：官网博客、daily.dev、多家媒体一致。
- 2026-09-15 TypeSafe 发布首个 **System One 模型 Jev**，Early Access。
  - 官网博客：https://typesafe.ai/blog/introducing-system-one-models-and-jev
  - 文档：https://docs.typesafe.ai
  - 控制台/Key：https://console.typesafe.ai/keys
  - 评测页：https://evals.typesafe.ai
- Jev 不生成文本；输入 state + 问题（choice/score/noul），输出带概率的类型化答案。训练方法 RLCD（Reinforcement Learning for Calibrated Decisions），声称「不能产生类型错误」「无法幻觉」（结构化输出）。

## 2. API 规格（官方文档，2026-09-21 核验）

- 端点：`POST https://api.typesafe.ai/v1/systemone`
- 认证：`Authorization: Bearer <API_KEY>`
- 请求：`{ state: string, model: "jev-latest", questions: { key: { type, instructions, criteria? } } }`
- 响应：`{ model, answers: { key: {type, choice|score|noul, confidence, probabilities, legend} }, usage: {input_tokens, output_tokens} }`
- SDK：Python `typesafe-sdk`；JS `@typesafe-ai/sdk`（npm）。
- 模型名：`jev-latest`（= jev-1.13.0，2026-09-21）。

## 3. 厂商宣称 vs 可验证性

| 宣称 | 来源 | 本插件可验证？ |
| --- | --- | --- |
| 端到端 70–500ms | 官方博客 | ✅ jev_decision/jev_verify 记录 latencyMs；bench 统计中位/p95 |
| 输入 $0.042/MTok、输出免费 | 官方博客 | ✅ usage 计入 estimatedCostUs |
| 200x 提速/400 分之一成本（对特定基线） | 官方博客/媒体/新华网 | ⚠️ 依赖对比基线，本插件只量化绝对值（延迟/成本/准确率） |
| 分类准确率与前沿 LLM 相当 | 官方博客 | ⚠️ 本插件用 25 题带标签基准给出独立准确率 |
| 概率校准（高置信=高准确） | 官方博客 | ✅ jev_verify 计算 confidence>0.6 时正确率 |
| 速率限制 250k tok/s、1200 req/min | powerdrill/thepromptindex（二手） | ⚠️ 未直接验证 |
| 「无法幻觉」 | 官方博客 | ⚠️ 本插件不做文本生成，无法对「不产生文本」做反例测试（与官方口径一致） |

## 4. 开源复现与生态（2026-09-19 前后）

- **APUS fast-browser-use**：量子位/新浪报道（2026-09-19），APUS AI Lab 用本地模型复现 Jev 决策范式（单 token logits 快速决策、KV-cache 广播），包装为 Agent Skill，MIT。用于浏览器自动化。
  - 报道：https://www.qbitai.com/2026/09/492939.html 、新浪新闻
- **browser-use/jev-ultrafast**：GitHub 开源浏览器 Agent，动作空间动态索引，调用真实 TypeSafe API（TYPESAFE_API_KEY）。
- **dsh-jev**（npm，2026-09-20，zhangxaochen）：DSH 守卫套件（循环守卫/安全门禁/工具剪枝/技能路由），自带 calibration 文档。
- **dsh-jev-tools**（npm，2026-09-21，horusj）：DSH 自动判定 + jev_ask/jev_gate + 判定台账。

## 5. 关键疑点与边界（诚实声明）

- Jev 是 Early Access 封闭 API（需 console 登录建 Key）；权重未开源。
- 「40–200x / $0.042 / 输出免费」等数字含厂商口径；本插件只承诺**独立实测**的绝对值，并在 README/docs 标注数值的测量日期与模型版本。
- APUS 报道中的「Qwen3.5-9B」型号命名未能交叉验证到官方 Qwen 发布，属于第三方转载，不构成本插件依据。
- 新华网转载文章中的「2026年7月发布品牌定位」等 APUS 公司信息与 Jev 插件功能无关。
