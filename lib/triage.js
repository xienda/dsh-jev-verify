/**
 * dsh-jev-verify — auto-triage (0.8.4).
 *
 * One small Jev call at the FIRST step of a turn that answers "which tool does
 * this request need?", injected back as a plugin-sourced user message. The
 * static system-prompt guidance shipped since 0.7.4 is necessary but not
 * sufficient: measured sessions still settled their requests without a single
 * Jev call. This makes the plugin participate on its own — and because every
 * such call is metered, the usage panel can no longer read "0 次".
 *
 * Fail-open by construction: unknown host shape, missing key, timeout, abort or
 * any API error simply lets the turn proceed without advice. It never throws
 * into the agent loop and never blocks a step.
 *
 * @module dsh-jev-verify/triage
 */

/** Defaults mirror the schema in index.js; index.js always passes its own. */
const DEFAULTS = { enabled: true, minChars: 12, timeoutMs: 4000, maxCallsPerSession: 200 };
/** Cap the state we send: a huge paste would cost tokens without improving routing. */
const MAX_STATE_CHARS = 6000;

/**
 * Routing questions. Deliberately small, mutually exclusive and answerable in
 * one parallel HTTP call (~1.5K input tokens): intent, whether an atomic
 * judgment is even needed, which kind, and which tool serves it.
 */
const TRIAGE_QUESTIONS = {
  intent: {
    type: "choice",
    instructions: "The primary intent of this user request",
    criteria: {
      implement: "Write or modify code, config or files",
      debug: "Diagnose and fix a failure or unexpected behavior",
      research: "Search, retrieve or compare external information",
      explain: "Explain how something works or what something means",
      author: "Produce prose, copy or a document",
      operate: "Run commands, deploy, or handle data/ops",
      chat: "Small talk, acknowledgement or a bare instruction like continue",
    },
  },
  needs_judgment: {
    type: "noul",
    instructions: "This request contains at least one atomic judgment (classification, routing, priority/severity/satisfaction scoring, truth or compliance verification, or structured extraction from text) that a dedicated decision model would settle faster or more consistently than free-form reasoning",
  },
  judgment_kind: {
    type: "choice",
    instructions: "The kind of atomic judgment this request needs most; pick none when there is no judgment to make",
    criteria: {
      classify: "Classify, label, tag or route content",
      rank: "Score or order by priority, severity, satisfaction or urgency",
      verify: "Check truthfulness, compliance or risk",
      extract: "Extract structured tags or fields from free text",
      choose: "Pick the best of several viable options or implementation routes",
      none: "No atomic judgment is involved (pure generation, chat or a single fact lookup)",
    },
  },
  recommended_tool: {
    type: "choice",
    instructions: "The single Jev tool this request should call first, or none when no Jev tool is warranted",
    criteria: {
      jev_decision: "One parallel batch of atomic judgments (classification, scoring, truth check, extraction)",
      jev_choose: "Score and rank 2-10 candidate options before deciding",
      jev_verify: "Run the labeled self-test benchmark to confirm the endpoint works",
      jev_usage: "Report this machine measured usage, cost or the locally configured budget",
      none: "No Jev tool is needed for this request",
    },
  },
};

const TOOL_LABELS = {
  jev_decision: "jev_decision（一次并行原子判定）",
  jev_choose: "jev_choose（多方案打分择优）",
  jev_verify: "jev_verify（27 题自检基准，有成本）",
  jev_usage: "jev_usage（本机用量/成本面板）",
};

/** Text blocks of one message; tolerates string content and unknown shapes. */
function textOf(message) {
  const content = message && message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("\n");
}

/**
 * Last human-authored user text in the step. Plugin-sourced messages are
 * skipped so the triage can never triage its own previous advice.
 */
function lastUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    if (message.source && message.source.kind === "plugin") continue;
    const text = textOf(message).trim();
    if (text.length > 0) return text;
  }
  return "";
}

/** Human-readable advice injected back into the turn (never empty). */
function buildAdvice(text, answers, latencyMs) {
  const intent = answers?.intent?.choice ?? "?";
  const kind = answers?.judgment_kind?.choice ?? "?";
  const tool = answers?.recommended_tool?.choice ?? "none";
  const noul = typeof answers?.needs_judgment?.noul === "number" ? answers.needs_judgment.noul : null;
  const label = TOOL_LABELS[tool] ?? "不需要";
  const parts = [
    "[Jev 自动预判 · 插件建议] 本轮意图=" + intent + "；判定需求=" + (noul == null ? "?" : Math.round(noul * 100) + "%") + "；判定类型=" + kind + "；建议工具=" + label + "。",
  ];
  if (tool === "jev_decision" || tool === "jev_choose") {
    parts.push("建议：先调用 " + tool + " 取得量化判定（或打分排序），再基于它的答案组织回复；不要只用直觉下结论。");
  } else if (tool === "jev_usage" || tool === "jev_verify") {
    parts.push("建议：按需调用 " + tool + "，不要凭记忆估算用量或端点状态。");
  } else {
    parts.push("本轮没有必须由 Jev 完成的原子判定，可直接作答。");
  }
  parts.push("（本次预判本身是一次真实 Jev 调用，已计入本机用量账本" + (Number.isFinite(latencyMs) ? "，" + Math.round(latencyMs) + " ms" : "") + "；证据仅为建议，若明显不适用可忽略。）");
  return parts.join(" ");
}

/**
 * Bind the auto-triage to a cordis context. Returns null when the host has no
 * agent/pre-step waterfall or when the feature is switched off.
 */
export function createTriageModule({ requestSystemOne }) {
  if (typeof requestSystemOne !== "function") throw new TypeError("createTriageModule requires requestSystemOne");

  // The host package is resolved lazily and defensively: without it the advice
  // is simply not injected, but the metered call still lands in the ledger.
  let userMessageFactory;
  function loadUserMessageFactory() {
    if (userMessageFactory === undefined) {
      userMessageFactory = import("@deepseek-ai/dsh-llm")
        .then((mod) => (typeof mod?.createUserMessage === "function" ? mod.createUserMessage : null))
        .catch(() => null);
    }
    return userMessageFactory;
  }

  function answerChoice(answers, key) {
    const value = answers?.[key]?.choice;
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  function answerNoul(answers, key) {
    const value = answers?.[key]?.noul;
    return typeof value === "number" ? value : null;
  }

  function applyAutoTriage(ctx, config, options, events = {}) {
    const cfg = Object.assign({}, DEFAULTS, config && typeof config === "object" ? config : {});
    if (cfg.enabled === false) return null;
    const minChars = Number.isFinite(Number(cfg.minChars)) ? Math.max(0, Number(cfg.minChars)) : DEFAULTS.minChars;
    const timeoutMs = Number.isFinite(Number(cfg.timeoutMs)) ? Math.max(200, Number(cfg.timeoutMs)) : DEFAULTS.timeoutMs;
    const maxCalls = Number.isFinite(Number(cfg.maxCallsPerSession)) ? Math.max(1, Number(cfg.maxCallsPerSession)) : DEFAULTS.maxCallsPerSession;
    const perAgentTurn = new WeakMap();
    let calls = 0;
    let injected = 0;
    let skipped = 0;
    let keyWarned = false;

    function note(level, message) {
      try {
        if (level === "warn") ctx.logger?.warn?.("[dsh-jev-verify] " + message);
        else ctx.logger?.debug?.("[dsh-jev-verify] " + message);
      } catch { /* logging must never break the step */ }
    }

    async function ask(text) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const { body, latencyMs } = await requestSystemOne(
          Object.assign({}, options, { toolName: "jev auto-triage" }),
          { state: text.slice(0, MAX_STATE_CHARS), model: options.model, questions: TRIAGE_QUESTIONS },
          controller.signal,
        );
        return { answers: body?.answers ?? {}, latencyMs: Number.isFinite(latencyMs) ? latencyMs : null, usage: body?.usage ?? null };
      } finally {
        clearTimeout(timer);
      }
    }

    ctx.on("agent/pre-step", async (payload, next) => {
      const decision = await next();
      try {
        const { agent, turn, step, signal } = payload ?? {};
        if (!decision || decision.kind === "reject" || signal?.aborted) return decision;
        if (step !== 1) return decision;
        if (calls >= maxCalls) return decision;
        if (agent && perAgentTurn.get(agent) === turn) return decision;
        if (agent) perAgentTurn.set(agent, turn);
        const text = lastUserText(decision.messages ?? payload?.messages);
        if (text.length < minChars) {
          skipped += 1;
          return decision;
        }
        let result;
        try {
          result = await ask(text);
        } catch (error) {
          const message = String(error?.message ?? error);
          // A missing key is a configuration state, not an incident: say it once.
          if (/requires a TypeSafe API key/.test(message)) {
            if (!keyWarned) { keyWarned = true; note("warn", "auto-triage skipped: " + message); }
          } else {
            note("warn", "auto-triage call failed (fail-open): " + message);
          }
          skipped += 1;
          return decision;
        }
        calls += 1;
        const answers = result.answers;
        const tool = answerChoice(answers, "recommended_tool") ?? "none";
        const needs = answerNoul(answers, "needs_judgment");
        const advice = buildAdvice(text, answers, result.latencyMs);
        // Advice is only worth context noise when a Jev tool is actually
        // indicated; a "none" verdict still counts as one metered call.
        const worthInjecting = tool !== "none" && (needs == null || needs >= 0.35);
        let created = null;
        if (worthInjecting) {
          const createUserMessage = await loadUserMessageFactory();
          if (typeof createUserMessage === "function" && Array.isArray(decision.messages)) {
            created = createUserMessage({
              content: [{ type: "text", text: advice }],
              source: { kind: "plugin", plugin: "dsh-jev-verify", form: "snapshot", sections: [{ name: "jev-auto-triage", text: advice }] },
            });
          }
        }
        // Exactly one event per call: the ledger must never double count.
        events.onTriage?.({
          tool,
          intent: answerChoice(answers, "intent"),
          judgmentKind: answerChoice(answers, "judgment_kind"),
          needsJudgment: needs,
          latencyMs: result.latencyMs,
          usage: result.usage ?? null,
          calls,
          injected: created !== null,
          stateHead: text.slice(0, 80),
        });
        if (created === null) {
          skipped += 1;
          return decision;
        }
        injected += 1;
        return Object.assign({}, decision, { messages: [...decision.messages, created] });
      } catch (error) {
        note("warn", "auto-triage step failed (fail-open): " + String(error?.message ?? error));
        return decision;
      }
    }, { prepend: true });

    return {
      get counters() { return { calls, injected, skipped, maxCalls }; },
    };
  }

  return { applyAutoTriage, buildAdvice, lastUserText, TRIAGE_QUESTIONS };
}

