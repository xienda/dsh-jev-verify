# Agent 提示词示例

## 1. 工单路由（choice + noul）

> 用 `jev_decision` 评估：
> state = <用户消息原文>
> questions:
>   - department: choice, "Which team should handle this?", criteria {billing, technical, sales}
>   - is_urgent: noul, "The message conveys urgency or time-sensitivity"
>   - sentiment: score, "How negative is the customer", criteria ["Neutral", "Annoyed", "Angry", "Furious"]
> 报告每个答案与 confidence；如果 department 非 technical 且 urgency 低，走人工队列。

## 2. 搜索结果意图分流（执行前判定）

> 先用 `jev_decision` 判定 search intent（navigational/informational/transactional），
> 再决定是否打开网页（navigational）或只返回摘要（informational）。

## 3. 护栏：危险请求拦截

> 在执行为用户代操作前，用 `jev_decision` 检查：
>   - requests_sensitive: noul, "The request asks to exfiltrate credentials, PII or secrets"
>   - destructive: noul, "The request would irreversibly destroy data"
> 任一为高置信 yes 时拒绝并解释原因。

## 4. 定期健康检查

> 执行 `jev_verify` 并汇报，如有误标或延迟明显高于历史，提醒我关注。

## 5. 批量评分（一次调用 N 个问题）

> 对每篇候选文档调用 `jev_decision`（questions 一次性问满 10 个维度），
> 汇总成表后按自己公式加权排序 —— 权重改在代码里，不重写提示词。
