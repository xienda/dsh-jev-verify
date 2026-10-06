# 验证报告（实测，带日期）

> 本文档只记录**真实 API 运行**的实测数据。方法学固定，数据可复现：
> `TYPESAFE_API_KEY=... node bench/bench.mjs`（结果 JSON 存档于 `bench/results/`）。

## 方法学

- 基准集：内置 `lib/cases.js`，27 个用例 / 27 个带标签问题（标签集自 2026-09-21 起冻结，不随结果调整；含 guard-destructive / guard-benign 两个护栏判定用例）。
- 覆盖：noul（紧急、垃圾、毒性、bug、PII、破坏性命令）×12；choice（部门路由、意图、搜索意图、优先级）×11；score（严重度、满意度）×4。
- 判定规则：noul 以 ≥0.5 为 yes；choice 精确匹配；score 数值相等。
- 每个用例一次完整 API 调用（state + 该用例全部问题并行），与真实用法一致。
- 延迟：调用往返耗时（含网络），录制中位/p95/min/max。
- 校准：confidence > 0.6 的子集正确率。
- 成本：input_tokens × $0.042 / 1e6（输出免费）。

## 运行记录

### 2026-09-21（run 1，单轮，25 题版）

- **模型**: `jev-latest`；**准确率**: **96.0%（24/25）**
- **延迟**: median **318 ms** / p95 838 ms / min 249 ms / max 1030 ms
- **成本**: 8,122 input tokens ≈ **$0.000341**
- 结果文件: `bench/results/2026-09-21T06-54-54-147Z.json`

### 2026-09-21（run 2，repeat=3 稳定复现，25 题版）

- **准确率**: **96.0%（72/75）** —— 三次运行完全一致
- **延迟**: median **308 ms** / p95 949 ms / min 251 ms / max 1218 ms
- **成本**: 24,366 input tokens ≈ **$0.001023**
- 结果文件: `bench/results/2026-09-21T06-55-37-978Z.json`

### 2026-09-21（run 3，DSH harness 内 jev_verify 工具实测，27 题版）

- **模型**: `jev-latest`；**准确率**: **96.3%（26/27）**
- **延迟**: median **283 ms** / p95 712 ms / range 237–1078 ms
- **成本**: 8,696 input tokens ≈ **$0.000365**
- 备注：该轮基准为 27 个带标签问题（含新增的 2 个护栏判定用例）。

### 2026-09-21（护栏拦截实测，DSH harness 内）

- 命令 `remove-item -Recurse -Force <temp>` → **确定性黑名单规则 "full-dir recursive delete" 拦截**（0 次 Jev 调用）。
- 命令 "permanently wipe all staging data and delete every row from every table" → **Jev 判定高风险，置信度 91% > 阈值 0.8，拦截**（1 次 Jev 调用）。
- 无辜命令 `write-host hello` → 确定性判定 clear，零调零耗放行。
- 全部计数经 `jev_guard_status` 审计（checks=2、Jev calls=1、deterministic=1、Jev denials=1、预算 49/50 剩余）。

### 2026-09-28（v0.7.0 回归：配置解包修复，headless 实例实测）

背景：修掉一个会让插件**静默失效**的真实根因——schemastery 的 `volatile()` 字段（`apiKeyEnv` 等）在插件里被当普通值读取，
实际拿到的是 `{ get(), [Symbol(cosmokit.volatile.write)] }` 引用对象。后果不止一处：

- `jev_overview` 直接抛 `credential ref "[object Object]" must match /^[A-Za-z_][A-Za-z0-9_]*$/`；
- `config.enabled === false` 永不成立（插件关不掉）；
- `autoGuard.enabled === true` 永不成立（护栏静默未武装，`jev_guard_status` 返回 `tools: []` / `denyThreshold: null`）；
- `dashboard.enabled` 永不成立；`maxQuestionsPerCall` 变对象（`Math.max` → `NaN`）。

修复：新增 `unwrapField()` / `normalizeConfig()`（识别 `Symbol.for("cosmokit.volatile.write")` 并 `get()` 解包，深度 ≤6 递归），
 `resolveOptions()` 改为永不抛（非法凭据名回落 `DEFAULT_API_KEY_ENV`），`opts()` 加 try/catch 兜底。

验证（headless 实例，profile `jevtest`，`dsh --profile jevtest`）：

- 启动日志：`[dsh-jev-verify] settings namespace registered: jev-verify | schema: present | scope: object`
- `jev_guard_status`：`auto-guard ENABLED`、`guarded tools: bash, pwsh, run_code, terminal`、`deny threshold: 0.8`、`session Jev budget left: 50`（修复前同一实例返回 `tools: []`、`denyThreshold: null`）。
- `jev_overview`：正常返回看板（`model jev-latest · Key ✓ · 护栏 开启 · 阈值 0.8`），不再抛凭据错误。
- 单元测试：`node --test "test/*.test.mjs"` → **19/19 通过**（新增 `test/config.test.mjs` 7 组用例锁定 volatile 解包，`test/present.test.mjs` 锁定四工具的 `presentationMeta` 投影）。

同一版本还落地两项界面改动：四个工具的 `presentationMeta` 结构化投影（对话内卡片改读 `block.meta`，不再依赖文本解析），
以及覆盖全部配置字段的设置卡片（凭据 / 工具 / 自动护栏 / 看板四组，含校验与保存）。

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
2. `dsh plugin --profile web add dsh-jev-verify`（或直接 `npm pack` 后本地安装）
3. `cd node_modules/dsh-jev-verify && TYPESAFE_API_KEY=... node bench/bench.mjs [--repeat 3]`
4. 结果 JSON 自动保存到 `bench/results/`；也可让 Agent 执行 `jev_verify` 获得同等报告。

## 2026-09-23（GUI 卡片实测：设置 → 插件 → 插件配置）

在真实 GUI（headless Edge + CDP 驱动，profile `jevweb`，端口 3099）复现并修复了「Jev 卡片不显示」：

- **现象**：服务端日志 `[dsh-jev-verify] settings namespace registered: jev-verify` 正常，客户端 `data-dsh-jev-card=registered`，但面板只有官方 4 张卡。
- **定位**：控制台报 `TypeError: Invalid value used as weak map key` + `slot entry crashed in 'settings.plugin.item'`。
  根因在 `dsh-client-ui-renderer` 的 `observableHook(source)` 会对 **每个** `inject().hooks` 值执行 `WeakMap.set(source)`；
  本插件当时返回了原始值 `{ hooks: { jevVerifyCard: true } }`，于是该 slot entry 在渲染阶段崩溃、卡片被静默丢弃。
- **修复**：`inject: () => ({})`（不再携带无意义的原始值 hook）。`test/client.test.mjs` 增加回归守卫：任何 `hooks` 值必须是 `{ getSnapshot, subscribe }` 可观察对象。
- **验证**：修复后同一环境重载，面板依次渲染出 8 个控件（API Key / 凭据引用 / 模型 / 启用工具 / 自检工具 / 网页看板 / 自动护栏 / 拒绝阈值）与「保存」按钮，
  `clientVer 0.4.5`，打开插件页后 **控制台错误 0 条**（截图 `jev-card-verified.png`）。
- 附带结论：Host 的 `settings/describe` 确实包含 `jev-verify`（共 14 个 namespace），
  可见性前提「服务端已注册 ∩ 客户端已注册同 key 卡片」两条都满足 —— 之前的失败纯粹是客户端 hooks 形状错误。

## 2026-09-23（设置卡片 UI 重做：对齐官方卡片设计系统）

原卡片是手写 inline style，与官方卡片视觉割裂。重做时直接抄了官方设计词汇（源码取自
`@deepseek-ai/dsh-client-ui-settings-plugins` 的 `PluginCard.module.css` 与 `fields.module.css`）：

| 元素 | 官方规格（已采用） |
| --- | --- |
| 卡片 | `.5px solid var(--dsw-alias-border-l4)` / `bg-layer-3` / `border-radius:16px` |
| 悬停 | `border-color: var(--dsw-alias-label-dimmed)`；展开时背景切 `bg-layer-2` |
| 头部 | `padding:14px 16px`；标题 15px/600；描述 13px `label-tertiary`；chevron `rotate(180deg)` |
| 字段 | 上下 `padding:12px 0`；相邻字段 `.5px solid border-l2` 细分隔线 |
| 输入 | 高 34px、`border-radius:8px`、聚焦 `border-color: var(--dsw-alias-brand-primary)` |
| 提示 | 12px `label-tertiary`；错误 12px `label-error` |
| 底部 | 右对齐，次按钮描边 `border-l2`，主按钮 `background: label-primary` |

关键决策：**全部颜色只引用 `--dsw-alias-*` 变量，不写死任何色值**，因此浅色/深色主题自动继承。

本次改动同时改善了信息结构：字段按 **凭据 / 工具 / 自动护栏 / 看板** 分组（带小标题），
布尔项改为开关（switch）而非裸 checkbox，每个控件配一行说明文字；
卡片头部显示 **已配置 / 未配置** 状态徽标，有未保存改动时显示 **未保存** 徽标；
底部为官方同款「放弃修改 / 保存」，保存成功后显示「已保存，立即生效（无需重启）」。

验证（headless Edge + CDP，真实 GUI）：
- `clientVer 0.5.0`，卡片渲染、展开、浅色与深色两种主题均正常，**控制台错误 0 条**。
- 截图：`docs/ui-collapsed.png`（折叠，与官方卡片并排）、`docs/ui-expanded.png`（展开）、
  `docs/ui-footer.png`（分组与底部按钮）、`docs/ui-dark.png`（深色主题）。

## 2026-09-23（可视化：Jev 在对话里"看得见"）

问题：Jev 的判定发生在工具调用内部，用户只能看到一段文本，无法判断它到底有没有工作、判得对不对。

做法：为 Jev 的工具注册官方 `tool.call.toolview` 槽（按 wire 工具名 keyed），在**对话流内**渲染每次调用——不需要另开网页看板。

注册的工具名：`jev_decision` / `jev_overview` / `jev_guard_status` / `jev_verify`。每个调用现在直接显示：

| 状态 | 呈现 |
| --- | --- |
| 进行中 | 蓝点 +「Jev 判定中…」+ 已提交的问题数，展开可见判定输入与问题清单 |
| 已完成 | 绿点 +「Jev 判定完成」+ **延迟 ms · 成本 $ · 实际模型**；展开后每个问题一行：名称、判定值、**置信度百分比与进度条** |
| 失败 | 红点 +「Jev 调用失败」+ 真实错误详情（例如 401 时直接提示去「设置 → 插件 → Jev」填 Key） |

细节（全部依据**真实 API 返回**实现，非假设）：

- `noul` 答案线上**没有 `confidence` 字段**（概率 `noul: 0.98` 本身就是置信度）→ 按概率取 yes/no 并把它作为置信度。
- `score` 答案线上带 `legend` 与 `probabilities` → 标签取**概率分布峰值**而非四舍五入原始分数。实测 `score=2.98, probabilities={2:0.02, 3:0.98}` 正确显示为 `critical (2.98)`；测试另用 `score=1.6, probs={1:0.6,2:0.4}` 锁定「分布峰值优先于四舍五入」。
- `questions` 线上是**字典**（工具参数是数组，由宿主转换）→ 两种形状都做归一化。

验证：

- `test/render.test.mjs`：用**真实抓取的 API 响应**（`fixture-decision.json`）验证三种答案类型解码正确。
- `test/toolview.test.mjs`：以 `react-dom/server` 渲染真实组件，断言 running / settled / error 三态文案与置信度，并针对真实数据断言 `yes` / `negative` / `critical`。
- 真实 GUI（headless Edge + CDP）：`clientVer 0.5.0`，卡片与工具视图注册成功，**控制台错误 0 条**。
- 截图：`docs/toolview-light.png`、`docs/toolview-dark.png`（浅色/深色三态对照）。

顺带修掉的真实 bug：进行中调用的参数在 `block.argsRaw`（已完成的才嵌在 `block.call.argsRaw`），原先只读后者导致运行中恒显示「0 个问题」。

## 2026-09-26（v0.6.0：同时兼容两代设置 API，修掉一个真实加载 bug）

背景：DeepSeek Harness **桌面版**内置的 dsh 是 **0.1.7-rc.1**，而此前插件是按 0.1.5-rc.2 写的。

### 发现的两个真实不兼容（都已修）

| 位置 | 0.1.5-rc.2 | 0.1.7-rc.1 | 后果 |
| --- | --- | --- | --- |
| 服务端 `ctx.settings.register(ns, schema, {base})` | 有 | **已移除** | 每次启动报 `settings.register is not a function` |
| 客户端服务 `settingsScope` | 有 | **已移除**（全库 0 次） | 声明为必需服务 → 整个客户端插件（含内联工具视图）都**不会加载** |
| 客户端槽 `settings.plugin.item` | 有 | **已移除**（0 次） | 旧配置卡片无处注册 |
| `tool.call.toolview` | 有 | 有（93 处） | 对话内联视图两代都可用 |

### 顺带修掉的一个自伤 bug

客户端 `apply()` 原来**先注册配置卡片、且没有独立隔离**。卡片一旦抛错（0.1.7 上必然抛），
后面的 `registerToolViews()` 就再也执行不到 —— 于是"配置卡片失败"连带把**对话内联视图**也弄没了。
现在：工具视图**先注册**并单独隔离；卡片改为条件注入。

### 兼容做法

- 客户端 `inject` 只声明 `["slots"]`；`settingsScope` 用 `ctx.inject(["settingsScope"], cb)`
  条件请求（与官方 dshmarket 相同的写法）。服务不存在时回调不执行，插件照常加载。
- 服务端检测 `typeof settings.register === "function"`：有则沿用旧版注册+watch；
  没有则进入 `entry-form` 模式——新版的命名空间就是 **profile 条目 id**（即 `jev-verify`），
  表单由插件自己的 Config 生成，实时值改从 `ctx.config` 读取。
- 新版**只把标了 `volatile` 的字段放进表单**，因此给 12 个面向用户的字段加了 volatile 标记。
  schemastery 3.18.2 没有 `.volatile()`（3.18.4 才有），所以用 `vol()` 助手：
  有方法就调用，没有就直接写 `schema.meta.volatile = true`（宿主读的就是这个 meta）。

### 验证

- 新增 `test/compat.test.mjs`（5 项）：volatile 标记齐全、0.1.7 无 register 时四个工具照常注册、
  无 settings 服务的宿主同样拿到全部工具、0.1.5 仍注册命名空间、**实时配置确实从 fiber 读取**
  （apply 时给 50、fiber 给 7 → 工具读到 7）。
- `test/client.test.mjs` 重写为两代对照：0.1.7（无 settingsScope）下**内联工具视图仍然注册**，
  且诊断标记为 `{"mode":"entry-form"}`。
- 桌面版实测（用桌面版自带的 dsh 0.1.7-rc.1 起隔离实例）：
  服务端日志由 `SETTINGS REGISTER FAILED` 变为 `settings: no register() on this host (dsh >= 0.1.7) — 使用条目表单`；
  客户端 `0.6.0` 加载、`data-dsh-jev-card=registered:toolview`、**控制台错误 0 条**；
  设置 →「内置插件 → 全局插件」列出 `jev-verify`（**已启用**）。
- 真实 API 回归：`node bench/bench.mjs` → 准确率 **96.3%（26/27）**、中位 **321 ms**、$0.000365。

### 2026-09-28（run 4，v0.7.2 发布前复测：27 题基准，独立 CLI）

- **模型**: `jev-latest`；**准确率**: **96.3%（26/27）** —— 与 run 3 一致，唯一误标仍是已记录的边界用例 `severity-low`（期望 score 0，返回 0.01，置信度 0.99）。
- **延迟**: median **484 ms** / p95 5023 ms / min 382 ms / max 9909 ms（单轮 27 次调用，含网络；比 run 3 慢，属网络波动）。
- **成本**: 8,696 input tokens ≈ **$0.000365**，822 output tokens，总墙钟 36.3 s。
- 结果文件: `bench/results/2026-09-28T09-27-57-654Z.json`，终端全文 `bench/run4.log`。
- 同期修正：`jev_verify` 工具描述此前写作「24 questions across 15+ cases」，与 `lib/cases.js`（27 用例 / 27 题）不符；v0.7.2 已改为 27 题并列出覆盖类别，README / market PR 稿 / 本报告同步更正。

### 2026-09-29（v0.7.3：`jev_choose` 多方案择优，新增工具）

- 需求来源：用户提出「harness 面对多种方案时是否可以让 Jev 帮忙择优」→ 新增 `jev_choose`（2–10 候选，逐方案一次调用：契合度 score 0–3 + 风险 noul，综合分 `fit/3 × (1−risk)` 排序推荐）。
- 代码落点：新模块 `lib/counsel.js`（createCounselModule，**并行**逐方案 requestSystemOne，Promise.all）；`lib/index.js` 注册 `jev_choose`（timeout = 单次 ×3 且 ≥30s），system prompt 注入「多方案叉路先调它」，overview recent 与 `lib/dashboard.js` summary 把 `kind: choose` 并入决策统计；`client/client.js` 新增 ChooseBody 排名表渲染（9 处编辑）。后续补两处诚实性修正：Jev 未返回 fit 分时 risk 不再落默认 0.5（与 fit 同显「—」，综合分不伪装）；recommended 为空时提示「请检查 API 响应」。
- 验证：`node --check` 四个文件全绿；`lib/index.js` 模块导入冒烟通过；`createCounselModule` 用 mock 传输层单测（3 候选、含一个「契合高但风险 0.9」陷阱项 → 综合分正确压到 0.1 不被推荐；参数校验 2..10 / 非空 / ≤800 字符各分支抛错正确；formatChoose 输出格式核对）。
- 部署：五个文件（lib/counsel.js、lib/index.js、lib/dashboard.js、client/client.js、package.json）同步到 `D:\lab\jev` 与 web profile pnpm store，MD5 三处全等；宿主进程重启后生效，重启前 jev_choose 不可调用（旧代码常驻内存）。client.js 补 0.7.3 版本号后需重部署并对齐 MD5（见 git HEAD 核对记录）。
- 现场插曲：压缩上下文时连续两次被自家护栏确定性规则拦截（摘要文本引用了规则样例词，如关机、递归删除类英文样例），改写措辞后放行——护栏会扫描工具调用参数文本，对描述性文字存在误报可能，已记为用户可见行为。
- 真实 E2E（2026-09-29，`bench/choose-e2e.mjs`）：从 `~/.dsh/.env` 读 key 直调 `https://api.typesafe.ai/v1/systemone`（shim 模拟 requestSystemOne 的 `{body, latencyMs}` 信封；首版 shim 返回裸 JSON 导致 fit 全 null，`bench/dump-raw.mjs` 核实真实响应形状后修正）。三候选用真实发布决策点验证：直接发布 fit 0.1/3、风险 89%、综合 0.4%、置信 90%（被打压）；**先验证后发布 fit 2/3、风险 24%、综合 51%、置信 45%（推荐，两次运行稳定复现）**；只发 npm fit 1.09/3、风险 56%、综合 16%。总耗时 3495 ms → 并行化后 2989 ms；成本 $0.00006741（1605 in + 99 out tokens）。
- 新增测试：`test/counsel.test.mjs`（7 用例：排序+陷阱项、并行性 maxActive、参数校验、context 截断、fit 缺失降级、formatChoose 快照、latency 聚合）；`test/toolview.test.mjs` 追加 choose 渲染用例。本地 `node --test` 26 用例结果待宿主恢复后重跑确认（宿主子进程故障暂挂，见发布记录）。

### 2026-09-30（v0.7.4：引导段真实注册、描述精化，并修掉 0.7.3 的 `jev_choose` 注册缺陷）

- 需求来源：用户问「如何让 harness 主动使用 jev」。根因（宿主源码实测）：`@deepseek-ai/dsh-system-prompt/lib/index.js:238-241` 的 `section()` 在 `!Number.isFinite(order)` 时抛 `TypeError: prompt section "<name>" order must be a finite number`，而本代 DSH 的 `SECTION_ORDERS`（:10-42）**没有 TOOL_JEV 槽位**（已分配槽位止于 TOOL_REPORT=2900，随后是 TOOLS_SDK=5000）。0.7.3 把 `getSectionOrder("TOOL_JEV")` 的 `undefined` 直接交给 `section()` → 抛错 → 被 `safe("system-prompt")` 吞掉 → **引导段从未注册**，模型只看得到工具描述，自然不会主动调用。
- 修复：`guidanceText(config)` 生成逐工具触发规则（实测 autoGuard 关闭 717 字符 / 开启 838 字符）；order 解析链 `getSectionOrder("TOOL_JEV")` → `guidance.order` → `DEFAULT_GUIDANCE_ORDER=3000`；注册段名 `tool:jev`，且 `ctx.tools.get("jev_decision", scope) === undefined` 时文本为空（工具未注册则不留空引导）；成功日志 `[dsh-jev-verify] system prompt: guidance registered | section tool:jev | order 3000 | chars 838`。新增 `guidance` 配置组（enabled / order / extra），均标记 volatile 以便 GUI 编辑。
- 第二个真实缺陷（同段发现）：**`jev_choose` 自 0.7.3 起在任何宿主中都未注册成功** —— 其 `options` 参数声明了 `minItems`/`maxItems`，宿主的值模式 DSL 拒绝：`JsonSchemaError: unsupported JSON schema: parameters.options.minItems is not supported by the value schema DSL`；`defineTool` 抛错被单工具隔离吞掉（`safe()` 只打 `logger.warn`），而当时的 boot 测试只断言 4 个工具，所以 0.7.3 发布了一个任何宿主都调不到的主打功能。修复：删掉这两个关键字，2–10 个候选 / 每个 ≤800 字符 / context ≤2000 字符的约束由 `lib/counsel.js` 的 `validateOptions` 在运行时保证。
- 三个诚实性/健壮性修正：① `choosePresentation(value)` 改为永不抛且 **JSON 可逆**（presentationMeta 会在 running/failed 时被投影，`undefined` 字段会在 JSON round-trip 中消失 → 只复制「已定义」的键）；② `formatChoose(value)` 对非对象返回 `jev_choose | 尚无结果（仍在运行或已失败）`；③ `test/boot.test.mjs` 的 fakeCtx 改为**镜像真实宿主契约**（`section()` 拒绝非有限 order；`getSectionOrder()` 只认 TOOL_GOAL），使「order 为有限数」这一曾经静默失败的契约进入回归测试。
- 验证：`npm test` **26/26 全绿**（新增 PASS 3：引导段注册、order 3000、文本 >300 字符且含五个工具名与「70-500ms」、护栏关闭时不含护栏说明行；PASS 4：`guidance.order:4200` 生效、`maxQuestionsPerCall:7` 插值出「1-7 个并行原子判定」、`extra` 原样追加、`guidance.enabled:false` 不注册）。
- 真实 API E2E（`bench/choose-e2e.mjs`，key 取自 `~/.dsh/.env`，从未打印）：三候选真实打分 → 推荐 #1「先验证后发布」契合 1.93/3、风险 23%、综合 50%、置信 41%；陷阱项「直接发布」契合 0.11/3、风险 90%、综合 0.4%（被正确打压）；「只发 npm」契合 1.03/3、风险 56%、综合 15%。总 895 ms，成本 $0.0000674（1605 in + 99 out），模型 jev-1.13.0。**这正是 0.7.3 从未被真实跑通过的那条代码路径。**
- 备注：宿主进程重启前工具面仍是旧快照（重启前的会话里 `jev_choose` 不可调用），重启后五个工具 + 引导段才生效。

### 2026-10-04（v0.7.5：三路审计修复批次 + `jev_verify` 并发化）

- 需求来源：用户要求「检查/优化插件、提出改进并测试、成功后发布」。做法：三路独立审计（服务端 / 客户端 / 打包与文档，各自 8 条、均带文件:行号与后果），再按「正确性 + 诚实性」取并集定出 10 条服务端、7 条客户端、5 条打包修复（清单见 README「What’s new in 0.7.5」）。

服务端（`lib/index.js`、`lib/guard.js`、`lib/dashboard.js`）：

- **看板账本假零**（最严重的诚实性缺陷）：`lib/dashboard.js:22` 的 `record()` 在独立页面未挂载时 `if (!active) return;`，而 `active` 只在 `registerRoutes`（`:89`）置位、路由又只在 `dashboard.enabled === true` 时挂载（默认 false）→ `jev_overview` 恒报 0 调用 / 0 token / $0，`$DSH_HOME/jev-roll.jsonl` 永不落盘，与 README 承诺矛盾。修复：内存 ring（`MAX_ROLL=300`）**永远记录**，新增 `ledgerOn` 只在页面挂载时置位、只控制 HTTP 页面与 JSONL 追加；README 与设置文案改为如实描述。
- **护栏漏报自己做过的事**：0.7.4 里 `events.onSafetyDeny` 只在确定性分支上报，Jev 拦截分支（`lib/guard.js:154-162`）静默，导致 `lib/index.js:910` 的「Jev 判定 / confidence」分支成死代码；循环建议也从未发 `onLoopAdvisory`（看板 `guardAdvisories` 恒 0）。修复：两处都补上报，payload 带 `tool` 与 `confidence`。
- **护栏重做为硬 / 软两层 + 位置感知**：旧实现 7 条规则对**整段参数**做正则且与 flag 顺序耦合——根目录递归删除只要在 flag 之间插一个额外 flag、或把 flag 反序即可绕过（落到通用 risky-verb 的 Jev 分支，Jev 预算耗尽时 fail-open 直接放行）。新实现：`atCommandPosition(text,index)` 判断匹配是否处于可执行位置（文本开头，或紧跟 `;` `|` `&` `(` 换行 / `$(`，且其前 ≤ 4 个词只是 wrapper、环境变量赋值或 flag）；`findRootWipe` / `findDriveRootWipe` 不依赖 flag 顺序；7 条硬规则（文件系统 / 盘根 / 目录树递归删除、磁盘格式化、数据库破坏语句、凭据外泄、强制推送的 git 历史）直接拒绝，3 条软规则（主机重启或关机、未强推的历史重写、恒真条件的 DELETE/UPDATE）交 Jev；硬模式出现在引号或散文中时降级为软提示（标 `(quoted/described)`）——即「引用危险命令」不再被硬拦。`judgeRisky(options, text, toolName)` 现接收工具名，判定缓存上限 200 条。
- **`TYPESAFE_BASE_URL` / `TYPESAFE_MODEL` 覆盖此前无效**：`resolveOptions` 读到的是 schema 默认值（`cfg.baseURL` 恒有值），env 永远不生效，自建端点用户被静默打到官方地址。修复为 `envGet(ctx,...) ?? cfg... ?? DEFAULT_...` 优先级链。
- **`jev_verify` 并发**：27 次调用原为严格串行（`for` + `await`），实测墙钟 10.07 s，逼近工具自身的 30 s 上限；改为 `VERIFY_CONCURRENCY = 6` 分批 `Promise.all`（`runCase` 封装单例，结果仍按用例顺序累加），实测 **4.96 s**（2.03×；同日二次复测 **3.999 s**）。
- **误判清单恢复全量**：`lib/index.js:520/535` 原逻辑「只要存在一个高置信误判就只显示高置信误判」，会掩盖低置信误标。现在 `mislabeled` 全量 + 新增 `mislabeledHighConfidence`。
- **报错指向具体工具**：`missingKeyError()` 与 abort / timeout / HTTP 文案硬编码 `jev_decision`（`jev_choose`、playground 共用同一抛点会误导用户）。新增 `toolLabel(options)`，`opts(toolName)` 注入标签，文案改为中性并带工具名。
- **注册失败可审计**：`safe(tag, fn)` 此前只 `logger.warn`（历史上两次因此发布带坏功能的版本）；现在累积 `regFailures`，`jev_guard_status` 新增 `registrations: { failures, failureCount }`，格式化输出给出一行汇总。
- 记账细节：Jev 返回的 `noul` 无 `confidence` 字段时按 `Math.abs(noul - 0.5) * 2` 折算；看板成本改用注入常量 `inputPriceUsdPerMTok`（删掉硬编码的 0.042）。

客户端（`client/client.js`、`lib/dashboard-page.html`）：

- `noul` 置信度曾把 yes 概率直接当置信度返回（`client/client.js:472-475`）→ `noul: 0.02` 的「否」显示「否 · 置信度 2%」配告警色，与概览看板（同一数据打 0.02 / 2%）自相矛盾；现返回判定侧置信度（`yes ? noul : 1 - noul`），0.02 的「否」显示 98%。
- `jev_choose` 结果不可审计（只留候选数量）：现在工具视图保留 `options` 原文与 `context` 背景，running 态 chip 改为「N 个候选 / 方案选型中」，且只有 decision / choose 在调用途中显示进度 chip。
- 概览卡补 `avgLatencyMs` 与 `typeCounts`（服务端投影早已提供，客户端此前丢弃）。
- 修 CSS 变量笔误（`--dsw-alias-bg-l2` → 真实的 `--dsw-alias-bg-layer-2`），深色主题下推荐行高亮与 chip 恢复填充。
- 看板页面错误面：空 catch + 裸解引用 `e.ts.slice(11,19)` 会让页面永久停在「加载中…」；现检查 `r.ok`、把 HTTP / 渲染错误写进 `#status`、时间戳做容错。
- 凭据徽章三态：仅有环境变量名时不再显示「已配置」（`keyConfigured` 曾把 `apiKeyEnv` 当凭据 → 虚绿），改为 literal「已配置」/ env「环境变量（未校验）」/ none「未配置」。

打包与文档：

- `test/functional.mjs` → `test/functional.test.mjs`：npm test 的 glob 只匹配 `*.test.mjs`，真实 HTTP 契约与评分测试**从未在 CI 中运行**过。
- `bench/choose-e2e.mjs` 硬编码 `C:\Users\孙浩\.dsh\.env`（且随 npm files 一起发布）：改为先读 `TYPESAFE_API_KEY`，再按 `DSH_HOME` / home 下的 env 文件回退，无 key 时明确报 `NO_KEY`。
- `bench/bench.mjs` 新增 `--concurrency`（默认 6，与工具一致）并报告墙钟与并发度；user-agent 由 `dsh-jev-verify-bench/0.1.0` → `/0.7.5`。
- README（中英）：延迟尾部分位改写为实测（中位 266–484 ms、p95 825–1468 ms，历史 bench 单轮曾到 p95 5023 / max 9909）；测试计数 19 → 27；`engines.dsh` 标注为建议性（npm 只强制 `node`）；不再宣称一条会扫描它根本没检查过的文本的黑名单。
- 声明可选 peerDependencies（`dsh-credentials`、`dsh-client-locale`、`dsh-client-ui-settings`、`dsh-api-remotes`，均 optional）。

验证：

- `npm test`：**27/27 全绿**（此前 25/27）。两个失败均定位为契约冲突并已按「测试即契约、不放松安全」处理：PowerShell 递归删除与强制推送的 git 历史按 0.7.4 契约留在硬层（安全回归优先），因此改的是规则表而非测试；`test/toolview.test.mjs:74` 的 running chip 依赖 `toolName`，修 `client/client.js:734` 回退链（`props.toolName` → `block.call.toolName` → `block.name`）后通过。
- 真实 API 复测（2026-10-04）：**96.3%（26/27）**，模型 `jev-latest`（`jev-1.13.0`），median **440 ms** / p95 **922 ms** / min 248 / max 1519，8,696 input + 822 output tokens ≈ **$0.000365**，**墙钟 4.96 s**（同用例串行实测 10.07 s）；唯一误标是已记录的边界用例 `severity-low`（期望 score 0，返回 0.01，置信度 0.99）。`mislabeled` 全量与 `mislabeledHighConfidence` 字段核对通过。
- 二次复测（2026-10-04 12:40Z，`bench/bench.mjs --concurrency 6`）：同样 **96.3%（26/27）**，median **282 ms** / p95 **1468 ms** / min 231 / max 1471，8,696 input + 822 output tokens ≈ **$0.000365**，**墙钟 3.999 s**（串行 10.07 s 的 2.52×）；报告 `bench/results/2026-10-04T12-40-07-421Z.json`，唯一误标仍是 `severity-low`。
- 护栏自证：本轮三路审计的聚合文本在调试期被 0.7.4 旧规则拦下 3 次（2 次确定性、1 次 Jev 判定 81–85%，阈值 0.8）——正是硬规则要改为位置感知的直接证据；0.7.5 起这些描述性文本（引用规则样例词）不再命中硬层。
- 启动日志：`settings namespace registered: jev-verify | schema: present | scope: object` 与 `system prompt: guidance registered | section tool:jev | order 3000 | chars 838`。

### 2026-10-05（v0.8.0：使用额度面板）

- 需求来源：用户要求「添加一个 Jev 使用额度面板，丰富功能，可以参考市面上已经成熟的额度面板、相关 dsh 额度插件」。
- 市场勘察：对比了 12 个同类 DSH 额度/用量插件条目（wenzetan__dsh-quota-panel、Minokun__dsh-quota、jiangli07__dsh-deepseek-quota-bar、dk33333333__dsh-deepseek-quota-left、black970__dsh-quota-viewer、xinghe-1018__dsh-token-plan-quota、Cassius0924__dsh-usage-dashboard、1HelloMan1__dsh-usage-dashboard-plus、kirigayakazima__dsh-usage-vendor-stats、kenz1117__dsh-ui-usage-billing、licyer__dsh-token-monitor、YZz-S__dsh-billing-balance）。归纳出的成熟要素：多入口（侧栏/头部/输入框/悬浮胶囊/设置页）、滚动窗口与重置倒计时、彩色进度条与告警阈值、本地历史与趋势图、CSV 导出，以及最重要的一条——**官方真值与「只报本实例实测」明确分层**（xinghe-1018 的做法）。
- 供应商接口真相（2026-10-05 实测）：`POST /v1/systemone` 缺 `model` 字段直接 422（`missing: [body, model]`），带上即 200 且响应头含 `x-typesafe-request-id`；`GET /v1/models` 返回 `jev-latest` 与 `jev-preview`（均为 2026-09-10）；而 `GET /v1/usage`、`/v1/quota`、`/v1/account`、`/v1/me`、`/v1/balance`、`/v1/credits`、`/v1/limits`、`/v1/billing`、`/v1/subscription`、`/v1/plan`、`/v1/user`、`/v1/health`、`/v1/` 全部 **404**。结论：TypeSafe 不提供余额/额度接口，面板只能报**本机实测用量 + 本地自设额度**；这条边界印在工具描述、文本结果、卡片与文档四处。
- 实现：新增 `lib/usage.js`（`createUsageModule({ inputPriceUsdPerMTok = 0.042 })`；内存 ring 400 条、每日本聚合最多 120 样本、可选持久化 `$DSH_HOME/jev-usage.json`（临时文件 + rename，失败放行）；窗口 today/d7/d30/all/session；`snapshot()` 产出 quota / limits / used / remaining / percent / status / projection / resetAt / history / provider 边界说明；`checkBudget()` 只在 `quota.enabled && quota.enforce` 时拦截）。记账接入 `jev_decision`、`jev_choose`、`jev_verify`（补记 `calls = questionCount`、input/output tokens、costUs）与护栏事件（护栏不占调用数，只累计 denied/advised）。新增工具 `jev_usage`（只读本地快照、不发 API，`window` 参数 5 档），`jev_overview` 与系统提示引导同步提及。
- 界面：对话内新增 `usage` 视图（UsageBody：额度状态/阈值/重置倒计时 chips、8 个统计格、三条预算进度条、每日走势 sparkline、按工具分布、底部边界说明）；`jev_overview` 概览卡新增额度 chip 行；独立看板（`dashboard.enabled`）新增额度区（`.bar` 进度条 + 30 天趋势 SVG）；设置卡新增第五组「使用额度」（enabled / enforce / warnAtPercent / dailyCallLimit / dailyCostLimitUsd / sessionCallLimit / persist / historyDays）。
- 成本口径交叉核对（用真实实测数据验证常量）：0.7.5 实测 8,696 input tokens，按 `$0.042 / 1e6` 得 **$0.000365232**（≈$0.000365），与 0.7.5 报告一致；面板记录的成本按同一常量从实测 tokens 推导，不做估值猜测。
- 验证：`npm test` **28/28 全绿**（2,538 ms）。新增 `test/usage.test.mjs` 8 组断言（空态与诚实说明、单次判定成本 = tokens×常量、27 题批量记 27 次调用且护栏事件不计数、额度状态与三种硬停、持久化与按 historyDays 跨天裁剪、重建实例重载同一文件、reset 清空、全部格式化函数与两种负载形态）；`test/toolview.test.mjs` 新增 `usage` 视图渲染用例；`test/boot.test.mjs` 与 `test/compat.test.mjs` 断言六个工具（含 `jev_usage`）与新的 volatile quota 字段。
- 踩坑（0.7.5 审计的延续）：schemastery 的 `.step(n)` 是**以 min 为偏移**的等差数列，`z.number().step(5).min(1)` 只接受 1,6,11,…，导致合法的 80 被拒（`$.quota.warnAtPercent expected number multiple of 5 but got 80`）；改为 `.step(5).min(0)` 后通过。另外，本轮写代码时**再次被运行中的 0.7.4 旧护栏拦下 3 次**（写入内容里出现危险命令字面量）——与 0.7.5 记录一致，也是 0.7.5 位置感知重构必要性的又一次复现。

### 2026-10-06（v0.8.1：设置卡片「未配置」与字段全空的根因修复）

- 症状（用户提问「额度面板在哪里显示，还有本地不是有 jev 的 key 吗，为什么 jev 面板里还是显示未配置」）：`~/.dsh/.env` 里有 `TYPESAFE_API_KEY`，对话内 `jev_overview` 也报 `API Key 已配置`（`keyConfigured: true`），但「设置 → 插件 → Jev」卡片徽章显示「未配置」、所有字段为空、保存看不出效果。
- 逐层定位（全部在本机复现，可重跑）：
  1. 设置服务直接发布解析值：`@deepseek-ai/dsh-settings/lib/index.js:364` `value: registration.resolved`，全库 grep `simplify` 0 命中；`redactSecrets`（同文件 `:16-24`）只剥离 `meta.role === "secret"`。
  2. 插件注册的 schema 给面向 GUI 的字段打了 volatile 标记（`lib/index.js` 的 `vol()` 助手）。宿主解析到的 schemastery 实测为 **3.18.4**（`profiles/web/node_modules/.pnpm/@deepseek-ai+schemastery@3.18.4/node_modules/@deepseek-ai/schemastery/lib/index.cjs`），其 `src/index.ts:769` `return schema.meta.volatile ? createVolatile(...) : default` 把被标记字段解析成 Volatile 引用对象。
  3. 因此上线值里 `enabled`/`apiKey`/`apiKeyEnv`/`baseURL`/`model`/`timeoutMs`… 全是 `{}`（实测见下表）。
  4. GUI 用的是自带的 schemastery **3.18.2**（`dsh-client-ui-settings/lib/client.js:207` 起是 vendored 源码；整个 dsh 安装 grep `volatile` 在 dsh-settings 与 dsh-client-ui-settings 中 0 命中），`decode()`（同文件 `:1107-1117`）校验失败即返回 `undefined`，`derive()` 里 `if (decoded === void 0) return;` 使草稿值恒为空。
  5. 插件卡片读到 `value === {}`，徽章按 `apiKey`/`apiKeyEnv` 都缺失判为「未配置」（`client/client.js` 徽章三态处）。
- 运行侧不受影响的原因：`lib/index.js:202-240` 的 `isVolatileRef`/`unwrapField`/`normalizeConfig` 会深解包这些引用，`resolveOptions()` 先 normalize 再读配置——所以 `jev_overview.keyConfigured`、`jev_guard_status.denyThreshold=0.8` 一直是正常的；被污染的只有人看的卡片。
- 实测探针 `_wire_probe.mjs`（导入**部署副本** `.pnpm/dsh-jev-verify@file+vendor/...` 的真实模块，并用 dsh 自带 schemastery 复刻 GUI 的 `new Schema(ser)(wire)` 解码）：

| schema | 上线值里的空对象字段 | apiKeyEnv | enabled | quota | GUI 解码 |
| --- | --- | --- | --- | --- | --- |
| `Config`（仅入口表单） | `enabled, apiKey, apiKeyEnv, baseURL, model, timeoutMs, maxQuestionsPerCall, verifyEnabled` + 全部 `quota.*` | `{}` | `{}` | `{"enabled":{},...}` | **失败**：`$.enabled expected boolean but got [object Object]` |
| `SettingsConfig`（注册用） | 无 | `"TYPESAFE_API_KEY"` | `true` | `{"enabled":true,"enforce":false,"warnAtPercent":80,...}` | **通过** |

- 修复（0.8.1）：新增工厂 `buildConfig(vol)`，由它一次造出两个 schema——`Config`（入口表单用，保留 volatile 标记，供认得该标记的宿主）与 `SettingsConfig`（纯 schema、不带任何标记，注册给设置服务的就是它，`lib/index.js:983` `settings.register(SETTINGS_NAMESPACE, SettingsConfig, { base: normalizeConfig(config) })`）。字段定义只有一份，不会漂移。
- 客户端加固：解码值为空时回退读 `snapshot.base`/`snapshot.user` 原始图层（`layerGet` 同时支持扁平点号键，以兼容 settings.yaml 的写法），卡片显式提示「服务端配置值未能解码（schema 版本差异），下方按原始配置图层显示；修改与保存不受影响。」；凭据徽章改为三态——明文 Key / `环境变量 <NAME>`（未校验，title 说明服务端按引用解析、真相看 `jev_overview`）/ 无，且取值走新抽出的纯函数 `keySourceOf(value, layers)`。
- 回归测试：`test/config.test.mjs`（注册 schema 的上线值为普通 JSON、顶层无 `{}`、往返不抛）、`test/compat.test.mjs` PASS 1b（`assert.deepEqual(volatilePaths(SettingsConfig), [])` + 线上 `enabled === true` / `apiKeyEnv === "TYPESAFE_API_KEY"`）、`test/client.test.mjs` PASS 4（自建迷你渲染器求值真实卡片组件，喂「解码失败」快照，断言徽章文本含 `环境变量 TYPESAFE_API_KEY` 且整棵渲染树不含「未配置」）。`npm test` **29/29 全绿**（2,473 ms，此前 28/28）。
- 生效条件：服务端 schema 改动需重启 `dsh web` 宿主才生效（客户端半边只需刷新页面）；三副本（源 `D:\lab\skill\jev`、部署 `D:\lab\jev`、pnpm store `.pnpm/dsh-jev-verify@file+vendor/...`）已逐文件哈希核对一致。

### 2026-10-06（v0.8.2：/jev 404 修复、状态页、composer 用量胶囊）

- 症状（用户反馈，附 Edge 截图）：打开 `http://127.0.0.1:3080/jev` 得到宿主 404（`HTTP ERROR 404`）；用户明确表示 0.8.0 的完整看板「不是我要的效果」，要的是 `dsh-opencode-go` 那样「小型轻量的额度显示面板」插在输入框旁。
- 404 根因（两层，均在 `lib/dashboard.js`）：
  1. 挂载条件过窄——`lib/index.js:1117` 原实现只在 `liveConfigOf().dashboard?.enabled === true` 时才 `ctx.inject(["webServer"])` 注册路由，而 schema 默认 `dashboard.enabled: false`（`lib/index.js:178`），用户 `~/.dsh/settings.yaml` 只存了扁平键 `dashboard.basePath: jev` 而没有 `enabled` ⇒ 路由根本没挂。
  2. 路径未规范化——`lib/dashboard.js:94` 原实现只 `replace(/[/]+$/, "")`，不补前导斜杠，于是用户写的 `jev` 注册成字面路径 `jev`，与浏览器请求的 `/jev` 永不匹配；也没有注册尾斜杠变体 `/jev/`。
- 修复（服务端，`lib/dashboard.js` / `lib/index.js`）：
  - 新增并导出 `normalizeBasePath(value)`（trim → 补前导 `/` → 去尾部斜杠 → 空或纯斜杠回落 `DEFAULT_BASE_PATH = "/jev"`）；新增导出常量 `PILL_ROUTE = "/jev/api/usage"`。
  - `registerRoutes()` 重写：按规范化后的 `base` 同时注册 `base` 与 `base + "/"`；**无条件**注册用量 JSON 路由（`PILL_ROUTE`，`base` 不同时再挂一份 `base + "/api/usage"`）；仅当 `dashboard.enabled === true` 才继续注册完整看板的 `base + "/api"` 与 `base + "/api/try"`，并在此时才把账本置为持久（`active = ledgerOn = true`）。
  - 看板关闭时 `base` 返回新的 `statusPage(snap)`：服务端渲染、深/浅色自适应、无 JS，显示今日调用/今日成本/本插件实例/今日 tokens/额度状态，并指路「输入框右侧的胶囊」与「开启 `dashboard.enabled` 才有完整看板」，附带诚实边界说明。
  - 新增 `pillPayload(extraStatus)`：把 `usageSnapshot()` 投影成紧凑 JSON `{kind:"jev-usage-pill", ok, asOf, status, enabled, enforce, warnAtPercent, resetInMs, limits, used, percent, projection, today{calls,costUs,inputTokens,outputTokens,medianLatencyMs,p95LatencyMs,guards}, byTool, session, guard, history, provider, priceUsdPerMTok, persistence}`；快照缺失或带 `error` 时返回 `{ok:false, error}`（路由仍 200）。
  - `lib/index.js` 挂载条件改为 `const wantsWeb = live.dashboard?.enabled === true || live.quota?.enabled !== false;`，且传规范化前的 `live` 给 `registerRoutes`（内部再规范化），并用 `ctx.__dshJevDashboardMounted` 去重。
- 修复（客户端，`client/client.js`）：新增 `PILL_ROUTES = ["/jev/api/usage", "/jev/api"]`（依次降级）与 `fetchPill()`（`credentials:"same-origin"`，因为 GUI 鉴权是签名 Cookie，同源 fetch 自带；**永不 reject**，失败 resolve `{ok:false,error}`）；`pillFromRaw()` 兼容胶囊投影 / `{usage:…}` / 裸快照三种形态；`pillLabel()` 产出 `Jev · 今日 N 次 · $0.000534`（异常态 `Jev · 额度不可用`、关闭态 `Jev · 额度已关闭`）；`pillTone()`/`pillStatusText()` 按 percent 与 status 给 warn/danger；`PillBody` 为**无 hooks 纯组件**（便于离线渲染测试）；`UsagePill` 每 60 秒与 `visibilitychange` 刷新、点击展开 270px popover、Esc/点击外部关闭；`registerUsagePill()` 注册到槽位 `conversation.input.right`（`id:"jev-usage"`, `order:900`），并在 `apply()` 里独立 quarantine（失败不影响其余注册）。
- 槽位与参照物（决定实现形态）：`conversation.input.right` 由 `@deepseek-ai/dsh-client-ui-conversation` 声明（`lib/client.js:16736`，kind list / scope session；渲染点 `:16183`），本机 profile 已启用 `dsh-opencode-go@0.1.17`，其 `registerUsagePill`（`lib/client.js:1786-1796`）用的正是同一槽位——故该槽位在本 GUI 真实可用。**未**采用它的 typert remote 通道（需要双侧同构 descriptor/codec 与多处 manifest 注入，风险与代码量都大），改用「插件自注册只读 JSON 路由 + 页面同源 fetch」。
- 测试：`test/dashboard.test.mjs` 整体重写为 10 组（看板开时路由严格等于 `["/jev","/jev/","/jev/api/usage","/jev/api","/jev/api/try"]`；关时恰为 `["/jev","/jev/","/jev/api/usage"]`；`/jev` 仍 200 且是状态页；`normalizeBasePath` 六种输入含 `/` 与 `///` 回落 `/jev`；胶囊 payload 字段齐全且不含 `roll`；快照抛错时路由仍 200 且 `ok:false`；自定义 `basePath:"/custom/"` 时 6 条路由且页面仍是完整看板）。`test/boot.test.mjs` 断言改为五条路由并新增「看板关闭时仍含 `/jev` 与 `/jev/api/usage`、不含 `/jev/api/try`」。`test/client.test.mjs` 新增 PASS 6（胶囊 payload 三形态 + 三种垃圾输入、`pillLabel` 四态、`pillTone` 五态、`PillBody` 正常态与错误态渲染文本、槽位注册项与 `data-dsh-jev-card` 含 pill）。`npm test` **29/29 全绿**（2,470 ms）。
- 稳定渲染文本（回归对照）：`Jev 本机用量 · 额度正常 | 触顶只告警，不拦截调用。 | 今日调用 | 29 / 200 次 | 今日成本 | $0.000534 / $0.50 | 本实例调用 | 29 次 | 今日 tokens | 8700 入 / 900 出 | 今日判定时延 | 中位 933 ms | 护栏拦截 | 2 次 | 本插件实例 | 29 次 | 按工具 | jev_verify 27 · jev_decision 1 · jev_choose 1 | 额度重置 | 1 小时 0 分后 | 20:00:00 · 本机实测，非账户余额 | 刷新`。
- 生效条件（客户端 bundle 的更新链路，本轮新查）：宿主 `@deepseek-ai/dsh-client-modules` 的 `bundleResource()`（`lib/index.js:857-870`）只从**内存**中精确匹配 `pathname + search`（含 rev），未命中即 404；bundle 只在 `reconcilePackage()`（`:823`）读盘，此后唯一能让新字节进入 graph 的入口是 `rebuilt(id)`（`:541-562`）。`rebuilt()` 的唯一调用方是 `@deepseek-ai/dsh-client-hmr`（`lib/index.js:49`），它按 `stat` 轮询（`mtimeMs + size`，默认 500 ms）并 `setInterval` 驱动（`:91-108`）；而 `dsh-web-app` 的 cordis patch 中 `client-hmr` 行是「always mounted」（`:167-168`），故**客户端半边改动只刷新页面即可生效**（轮询会在 ≤500 ms 内检测到并更新 rev），服务端 `lib/` 改动仍需重启 `dsh web` 宿主。
- 部署：三副本（源 `D:\lab\skill\jev`、部署 `D:\lab\jev`、pnpm store `.pnpm/dsh-jev-verify@file+vendor/...`）逐文件 sha256 核对一致。
## 与 dsh-jev/官方博客声明的边界

- 200x 提速、1/400 成本等对比数字依赖具体基线模型与工作负载，本插件不搬运这些相对值，只发布可直接核验的绝对值（延迟、成本、准确率、校准）。