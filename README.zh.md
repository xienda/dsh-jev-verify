# dsh-jev-verify

把 TypeSafe AI 的 **Jev（System One 决策模型）**接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的一等公民插件。

Jev 不生成文本：给定 `state` 与类型化问题，它用**一次并行 API 调用**返回**带校准概率的类型化判定**（官方宣称 ~70–500ms；我们实测中位 266–484 ms、p95 825–1468 ms（单轮峰值约 1.5 s，网络拥堵时可达约 5 s））。本插件把它封装成 Agent 工具，附加可选的**自动护栏**（风险/循环检测），并且坚持「验证过的才叫有效」：

| 工具 | 作用 | 该在什么时候调用 |
| --- | --- | --- |
| `jev_decision` | 对 `state` **一次调用并行**提出最多 25 个类型化问题（`choice` / `score` / `noul`），官方宣称 ~70–500 ms，我们实测中位 266–484 ms、p95 825–1468 ms。每个答案都带校准置信度与概率分布；结果同时报告模型、延迟、token 用量与估算成本。 | 你需要快速、可复现的**判定**而非文本：分类/打标、路由或分诊、优先级/严重度/满意度评分、垃圾/毒性/隐私数据检查、意图或真伪判断、从自由文本抽取结构化标签。相关问题务必合并到一次调用——并行执行不额外增加延迟。 |
| `jev_choose` | 对 2–10 个候选方案/路线排名：每方案给契合度 score 0–3 与风险 noul，合成 `fit/3 × (1−risk)`；返回有序排名表、推荐项与每方案延迟/成本。 | 岔路口上有多条**彼此独立**的可行路线、需要一份校准过的量化参考再做最终决策时。Jev 只给分、绝不解释——理由由你自己给出。 |
| `jev_verify` | 对**线上真实 API** 以 6 路并发运行冻结的 27 题带标签基准（紧迫度、垃圾、毒性、隐私数据、部门路由、意图、检索类型、优先级、严重度、满意度、护栏判定；0.7.5 实测 27 次调用墙钟 4.96 s（复测 3.999 s），串行需 10.1 s）：总体准确率与高置信子集准确率、中位/p95/min/max 延迟、置信校准、token、成本，以及**全部**误判清单（并单列其中属于高置信误判的）。 | 确认端点健康、对比模型版本、排查回归——不要例行调用：一轮就是 27 次真实 API 调用（约 8.7K input tokens、≈$0.0004）。 |
| `jev_guard_status` | 自动护栏只读审计：确定性规则与 Jev 兜底**分别计数**（`checks` / `jevCalls` / `denied` / `deterministicDenied` / `auditCalls`）、受护栏工具名、`denyThreshold`、循环检测计数、本会话剩余预算。 | 确认护栏是否武装、实际触发过几次，或解释某条命令为什么被拦。护栏关闭时会如实说明，而不是报一堆 0。 |
| `jev_overview` | 本会话 Jev 账本只读快照：最近判定与择案（含置信度）、延迟中位与 p95、问题类型分布、护栏事件、累计 tokens 与成本，以及 Key/护栏/阈值状态。 | 用户问「Jev 做了什么 / 拦了什么 / 花了多少」，或需要不重启会话就核对端点与预算状态时。账本以插件实例生命周期为起点；护栏计数在 `jev_guard_status`。 |

**自动护栏模式**（可选开启 `autoGuard.enabled`）：在 shell 类工具（bash/pwsh/run_code/terminal）执行前，先跑零成本的确定性层。7 条**硬规则**直接拦下灾难性、不可逆的操作：文件系统、盘根或目录树的递归删除、磁盘格式化、数据库破坏语句、凭据外泄、被强制推送的 git 历史；3 条**软规则**（主机重启或关机、未强推的 git 历史重写、恒真条件的 DELETE/UPDATE）交给 **Jev** 判定（noul 超阈值即拒绝）。硬规则只在**可执行位置**触发，所以你只是引用或描述一条危险命令时绝不会被硬拦；落在别处的硬模式会降级为交给 Jev 的提示。Jev 不可用时 fail-open 放行并告警，绝不假装检查过。循环守卫对连续相同工具的调用做语义停滞判定，只注入纠偏建议、不阻断。所有判定（确定性与 Jev）都会写进会话账本，可通过 `jev_guard_status` 审计。

**诚实设计，绝不造假**：

- 未配置 `TYPESAFE_API_KEY` 时，工具与护栏都会用明确的报错说明如何配置；
- 每次 `jev_decision` 结果都带回 model、延迟与 token 用量，可审计；
- `jev_verify` 拒绝报告任何未经实测的数字；
- 独立的基准 CLI（`bench/bench.mjs`）零依赖，任何人可用任意 Key 复现发布的数据。

## 0.7.5 更新

这是一次「审计版」发布：三路审查（服务端 / 客户端 / 打包）找出的正确性与诚实性问题全部修掉并用测试钉住；`jev_verify` 的 27 题也改为并发执行。

**服务端**

- **看板关闭时账本也照记**：`record()` 原本在独立页面未挂载时直接返回，于是 `jev_overview` 永远报 0 次调用 / 0 token / $0，而 `jev_guard_status` 却在计同样的事件。现在内存 ring 永远记录，只有 HTTP 页面与 `$DSH_HOME/jev-roll.jsonl` 追加仍受 `dashboard.enabled` 控制（README 与设置卡文案已如实改写）。
- **护栏补上报它本来就知道的事件**：Jev 拦截路径现在会发 `onSafetyDeny`（带 `confidence` 与工具名），循环路径会发 `onLoopAdvisory`，看板的「建议数」与账本里的 Jev 判定分支不再是死代码。
- **自动护栏重做为「硬 / 软」两层 + 位置感知**（见下方「自动护栏」）：不再对整段参数做正则；根目录删除识别改为逐 token 走 flag，额外 flag、`--flag=value` 写法与反序 flag 都无法再混过去；对普通相对目录（例如构建产物目录）的递归删除降为交给 Jev 的软提示，只出现在引号或描述里的硬模式同样降级，而不是直接拦截。
- **`TYPESAFE_BASE_URL` / `TYPESAFE_MODEL` 覆盖真正生效**：此前读到的其实是 schema 默认值，环境变量永远不生效，自建端点的用户被静默打到官方地址。
- **`jev_verify` 分 6 路并发**（`VERIFY_CONCURRENCY`）：实测 4.96 s 墙钟（复测 3.999 s），串行需 10.1 s，也不再逼近工具自身的超时。
- **`mislabeled` 恢复全量**，并新增 `mislabeledHighConfidence` 单列高置信误判（此前只要有一个高置信误判，低置信误判就全部消失）。
- **报错会指明具体工具**：`missingKeyError()` 与 abort/timeout/HTTP 文案此前硬编码 `jev_decision`，即使出错的是 `jev_choose` 或 playground。
- **注册失败不再被冲掉**：`safe()` 现在累积 `regFailures`，`jev_guard_status` 以 `registrations.failures` / `failureCount` 返回——正是这类失败让前面两次发布带着坏功能出门。
- **成本改为注入常量**（`inputPriceUsdPerMTok`），Jev 判定缓存上限 200 条。

**客户端（对话内视图与设置卡）**

- **`noul` 置信度不再反着显示**：`noul: 0.02` 的「否」此前显示成「否 · 置信度 2%」并配告警色，现在显示判定侧置信度（98%），与概览看板一致。
- **概览卡补上平均延迟与问题类型分布**（投影其实一直在传）。
- **`jev_choose` 可审计**：工具视图保留排名结果**以及**提交的候选原文与选型背景，不再只留一个数量。
- **运行中的标签更诚实**：只有 `jev_decision`/`jev_choose` 在调用途中显示「0 个问题 / 0 个候选」，其它工具不显示。
- **修掉失效的 CSS 变量**（`--dsw-alias-bg-l2` → `--dsw-alias-bg-layer-2`）——深色主题下推荐行与 chip 此前没有填充。
- **看板页面会报自己的错**，不再把异常吞成永久「加载中…」，并兼容没有时间戳的事件。
- **凭据徽章三态**：字面 Key 显示「已配置」，环境变量引用显示「环境变量（未校验）」，都没有则显示「未配置」——环境变量名不再被当成可用凭据。

**打包与文档**

- `test/functional.mjs` → `test/functional.test.mjs`：真实 HTTP 契约与评分测试此前从未在 `npm test` 里跑过（glob 只匹配 `*.test.mjs`）。
- `bench/choose-e2e.mjs` 不再硬编码开发者主目录，改从 `TYPESAFE_API_KEY` 或 DSH env 文件读 Key。
- `bench/bench.mjs` 新增 `--concurrency`（默认 6）并报告墙钟；user-agent 带版本号。
- README 把延迟尾部分位、测试计数写成实测值，`engines.dsh` 标注为「建议性」，不再宣称一条会扫描它根本没检查过的文本的黑名单。
- 声明可选 peer 依赖（`dsh-credentials`、`dsh-client-locale`、`dsh-client-ui-settings`、`dsh-api-remotes`）。

## 0.7.4 更新

- **`jev_choose` 这次才真的注册成功——0.7.3 里这个工具在任何宿主中都不存在。** 它的 `options` 参数声明了 `minItems`/`maxItems`，而宿主的值模式 DSL 不支持这两个关键字（`JsonSchemaError: unsupported JSON schema: parameters.options.minItems is not supported by the value schema DSL`）；`defineTool` 抛错，被「单工具隔离」吞掉，于是 0.7.3 发布了一个任何宿主都调不到的主打功能——而当时的启动测试只断言 4 个工具，所以没有任何告警。0.7.4 删掉这两个关键字（2–10 个候选、每个 ≤800 字符、context ≤2000 字符这些约束改由 `lib/counsel.js` 的 `validateOptions` 在运行时保证），并让 `test/boot.test.mjs` 走真实 `defineTool` 模式编译器断言五个工具全部注册。
- **引导段这次真的注册进去了——这才让 harness 自己主动调用 Jev。** 0.7.3 及以前，插件用 `getSectionOrder("TOOL_JEV")` 取排序位，而当前这一代 DSH 的槽位表里根本没有 `TOOL_JEV`，取回 `undefined`；宿主的 `systemPrompt.section()` 拒绝非有限数，直接抛 `TypeError: prompt section "<name>" order must be a finite number`，而这个异常又被保护 profile 的同一套隔离吞掉——于是**引导段从未存在过**，模型只看得到工具描述，自然不会主动调用。0.7.4 的 order 解析链为 `getSectionOrder("TOOL_JEV")` → `guidance.order` → `3000`，并把结果写进宿主日志（`system prompt: guidance registered | section tool:jev | order N | chars M`）；`test/boot.test.mjs` 现在会在注册段 order 不是有限数时直接失败。**更正**：0.7.3 更新说明里「使用指引已注入代理 system prompt」在当时并未生效，本版本才真正生效。
- **功能描述更精确（是什么 / 何时用 / 何时不用）**：五个工具描述现在都写明实测延迟、问题类型规则、「相关问题合并成一次调用」的建议、`jev_verify` 的真实成本，以及明确的禁用边界（`jev_decision` 只出判定不写文本；`jev_choose` 只打分不解释）。系统提示里的引导段由同一套措辞生成，提示词与工具列表不会再各说各话。
- **新增 `guidance` 配置组**：`guidance.enabled`（默认 true）、`guidance.order`（默认 3000）、`guidance.extra`（按原样追加的部署自定义规则），均可在 GUI 设置卡中编辑。

## 0.7.3 更新

- **`jev_choose`——多方案择优工具**：一次调用对 2–10 个候选做法逐方案打分（契合度 score 0–3，带校准置信度；风险 noul），合成综合分（`fit/3 × (1−risk)`），返回排名表、推荐项与每方案延迟/成本。对话内渲染为排名表格（ChooseBody），并计入看板决策统计（`kind: choose` 并入 decisions）。**注意：0.7.3 发布的这个工具是坏的（参数模式被宿主拒绝、注册未成功），修复见下面的 0.7.4。**
- **0.7.3 已部署**：`D:\lab\jev`（vendor）与 web profile pnpm store 三处字节一致（MD5 全等）；`node --check` 全绿；`rankOptions` 以 mock 传输层完成单元验证。

## 0.7.2 更新

- **基准表述与代码对齐**：`jev_verify` 的工具描述此前写着「24 questions across 15+ cases」，而 `lib/cases.js` 自 v0.2.0 起一直是 27 个带标签问题（27 个用例，含护栏判定）；v0.7.2 统一为 27，README、market PR 稿与验证报告同步更正。
- **2026-09-28 复测**（本版本发布前，run 4）：准确率 **96.3%（26/27）**、8,696 input tokens ≈ **$0.000365**、中位延迟 484 ms（受网络影响）；终端全文见 `bench/run4.log`。

## 0.7.1 更新

- **仅文档同步（0.7.1 的代码与 0.7.0 一致）**：验证报告补齐完整实测历史——2026-09-21 基准与护栏实测、2026-09-23 GUI 卡片/设置卡重做/对话内视图、2026-09-26 两代设置 API 兼容、2026-09-28 v0.7.0 回归；`docs/verification.md` 现为 208 行完整记录。行为与 0.7.0 相同。
- **每个工具都有结构化对话内视图**：工具结果新增 `presentationMeta` 投影（`kind: decision | overview | guard | verify`），对话里直接渲染判定卡、护栏看板与实测报告——答案、置信度条、状态标签与统计格，而不再是原始文本；缺少 `meta` 时自动回退解析工具文本。
- **完整插件设置卡**：「设置 → 插件 → 插件配置 → Jev」现在覆盖全部选项：凭据（Key、凭据引用、API 地址、模型、超时、问题数上限）、工具开关、整组自动护栏（安全/循环开关、受护栏工具清单、拦截阈值、Jev 预算、循环参数）与看板（开关 + 路径），带数值校验与未保存状态处理。
- **配置处理加固**：使用前会解包 schemastery 的 volatile 字段（`.volatile()`），因此对象形态的 `apiKeyEnv` 不再让 `credentialRef(...)` 崩溃，`autoGuard.enabled` / `dashboard.enabled` 真正生效，数值型选项也按数字读取。
- **测试 27 项全绿**（`npm test`）：覆盖启动、客户端渲染、工具视图、设置卡、看板、护栏与展示投影。

## 为什么是 Jev

TypeSafe AI（创始人 Diogo Almeida，前 OpenAI、ChatGPT 研究方向）于 2026-09-15 发布 Jev，定位首个「System One」模型：输入非结构化状态，输出类型化概率判定。在智能体高频原子判定场景（分类、路由、分诊、评分、护栏、真伪判断）上，Jev 比前沿对话 LLM 快数十到两百倍（输入 $0.042/百万 token，输出免费）。适合承担 Agent 循环里高频「快判断」，把「慢思考」留给大模型。

## 安装

要求 Node >= 20，dsh >= 0.1.5-rc.2。`engines.dsh` 是**建议性**的：npm 只强制 `node` 键，真正的门槛是宿主提供 `dsh-tools` 0.1.5-rc.2 与 `settings` 服务——缺哪个就只降级哪个界面（并在 `jev_guard_status` 里报出来）。

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

可选环境变量，且自 0.7.5 起真正优先于 schema 默认值：`TYPESAFE_BASE_URL`（默认 `https://api.typesafe.ai/v1`）、`TYPESAFE_MODEL`（默认 `jev-latest`）。在此修复之前读到的是 schema 默认值，设置这些环境变量没有任何效果。

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

## harness 何时会主动调用 Jev

调用分三条路径，0.7.4 修好的正是第一条：

1. **系统提示引导（主动）**：插件注册名为 `tool:jev` 的提示段（order 默认 `3000`，可用 `guidance.order` 改、`guidance.enabled: false` 关、`guidance.extra` 追加）。它按优先级列出每个工具的触发规则——**判定落进这些类别就立刻调用该工具**——并且只在 `jev_decision` 确实存在时才注册，绝不宣传没加载的工具。这就是让 agent **自己想起来用 Jev** 的机制；没有它，模型只看得到工具清单，很少愿意花一次调用。
2. **工具描述（发现）**：每个工具描述都写着同样的信息：实测延迟与成本、问题类型规则、「相关问题合并成一次调用」，以及明确边界——`jev_decision` 只出判定不写文本，`jev_choose` 只打分不解释。
3. **钩子与用户指令**：`autoGuard.enabled` 时，每个受护栏的 shell 类调用在**执行前**被审计（先确定性黑名单、再 Jev），完全不经过模型决策；用户也可以直接说「用 `jev_decision` 判定这条工单」「用 `jev_choose` 给这三个方案排序」「run `jev_verify`」。

如果 agent 还是不理会 Jev，按顺序检查：`guidance.enabled` 没被设为 false；宿主输出里出现过 `guidance registered`；`jev_decision` 在工具清单里；以及这个任务本身确实是判定类任务，而不是写作/推理类任务。

## 自动护栏

`autoGuard.enabled: true` 时，两个钩子守护受保护的每个工具调用：

1. **安全门禁**（`tools/pre-execute`）：先跑免费的确定性层，命中结果分**硬**（直接拒绝）与**软**（交给 Jev）两类。7 条硬规则覆盖灾难性、不可逆操作：文件系统/盘根/目录树递归删除、磁盘格式化、数据库破坏语句、凭据外泄、强制推送的 git 历史。3 条软规则覆盖「有破坏性但常常是合法操作」：主机重启或关机、未强推的 git 历史重写、恒真条件的 DELETE/UPDATE。硬模式只在*可执行位置*（命令行开头，或紧跟 `;`/`|`/`&`/`(`/换行，且前面只有包装器、环境变量赋值与 flag）触发，因此只是引用或描述危险命令绝不会被硬拦；出现在别处的硬命中会降级为交给 Jev 的提示。未被拦下的一律交给 **Jev**（风险 noul ≥ `denyThreshold` ⇒ 拒绝），判定缓存上限 200 条，并按会话限预算；Jev 故障时 fail-open 并告警。
2. **循环检测**（`tools/post-execute`）：连续同工具、输出较长的调用触发 Jev 停滞判定；判定停滞时向下一个请求注入非阻断式纠偏建议，随后进入冷却。

所有判定（确定性或 Jev）都会写入会话账本并由 `jev_guard_status` 计数；任何注册失败也会在那里暴露，而不是被滚屏冲掉。本版本自身审计的经验（2026-10-04）：三份审查负载被 0.7.4 的旧规则拦下——两次确定性、一次 Jev 判定 81–85%（阈值 0.8）——这正是硬规则要改成位置感知的原因；同时 0.7.5 的测试重新确认了 0.7.4 的契约（shell 与 PowerShell 递归删除、强制推送 git 历史、读取凭据文件这四类仍然确定性拦截），27/27 全绿。

## 运行可视化（不另开页面）

可视化**直接在对话里看**，不再需要单独网页：

每个工具都带 `presentationMeta` 投影，结果以结构化卡片渲染，而不是原始 JSON：

- `jev_overview` — 决策看板：状态标签（模型 / Key / 护栏 / 阈值）、8 个统计格（判定数、实测数、拦截数、提示数、中位延迟、平均置信度、input tokens、累计成本）以及最近的判定与护栏事件。
- `jev_verify` — 线上实测报告：准确率、答对数、高置信准确率、中位与 p95 延迟、token、成本与误判用例。
- `jev_guard_status` — 护栏卡片：受护栏工具、拦截阈值、本会话预算、安全与循环计数、最近一次受检工具。

`jev_overview` 背后的会话账本**永远记录**（内存 ring，上限 300 条事件）——0.7.5 起不再等独立页面开启。需要独立网页版时仍可开启：`dashboard.enabled: true` 后访问 http://127.0.0.1:3080/jev；只有开启后事件才会同时追加到 `$DSH_HOME/jev-roll.jsonl` 供外部工具使用。

## 验证（实测、带日期）

方法学与最新实测结果见 [docs/verification.md](docs/verification.md)。

**当前状态**：✅ **已于 2026-09-21 对线上 API 实测**（`jev-latest`）：含护栏用例的 27 题基准准确率 **96.3%**（26/27），中位延迟 **283–308 ms**，27 题全程成本 **≈ $0.0004**。唯一误标为已记录的边界值（severity 得分 0.01 vs 期望 0）。

**最新复测（2026-10-04，0.7.5）**：96.3%（26/27），`jev-latest`（`jev-1.13.0`），中位 **266–440 ms**、p95 **825–1468 ms**、8,696 input tokens ≈ **$0.000365**，27 题 6 路并发墙钟 **4.0–5.0 s**（复测 3.999 s）；唯一误标仍是已记录的边界用例（`severity-low`：0.01 vs 期望 0）。

随时可复现：

```sh
TYPESAFE_API_KEY=... node bench/bench.mjs            # 1 轮（27 个问题）
TYPESAFE_API_KEY=... node bench/bench.mjs --repeat 3 # 延迟稳定性
```

或直接让 Agent 执行「run jev_verify」。

**0.7.4**：引导段现在真实注册（根因：不存在的 `TOOL_JEV` 排序槽位让 `systemPrompt.section()` 抛错，而异常被隔离吞掉）——详见 `docs/verification.md`；`npm test` 覆盖该注册路径。

**0.7.5**：三路审计（服务端 / 客户端 / 打包）修复批次，详见上面的「0.7.5 更新」与 `docs/verification.md`；`npm test` 27/27。

**回归验证（2026-09-28，v0.7.0）**：在 headless profile（`autoGuard.enabled: true`）中，`jev_guard_status` 正确报告已武装的护栏（工具清单、`deny threshold 0.8`、预算），`jev_overview` 正常返回看板，不再出现此前的 `credentialRef` 崩溃——即 volatile 配置解包修复；当时 `npm test` 19/19 通过（今天为 27/27）。

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
| `guidance.enabled` | true | 是否向系统提示注入「何时调用 Jev」引导段 |
| `guidance.order` | 3000 | 该提示段的排序位（必须能解析为有限数） |
| `guidance.extra` | `""` | 按原样追加到引导段末尾的部署自定义规则 |
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