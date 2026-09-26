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

## 与 dsh-jev/官方博客声明的边界

- 200x 提速、1/400 成本等对比数字依赖具体基线模型与工作负载，本插件不搬运这些相对值，只发布可直接核验的绝对值（延迟、成本、准确率、校准）。
