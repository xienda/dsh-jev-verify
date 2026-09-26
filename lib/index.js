/**
 * dsh-jev-verify — Jev (TypeSafe System One decision model) for DeepSeek Harness.
 *
 * Registers two agent tools:
 *   - `jev_decision`: ask Choice / Score / Noul questions against a `state` in a
 *     single parallel API call; returns typed answers with probabilities,
 *     confidence, token usage and measured latency.
 *   - `jev_verify`: run the built-in labeled benchmark against the live API and
 *     return real measured accuracy / latency / calibration — the anti-deception
 *     self-test. No mock mode, no silent fallback: without an API key both tools
 *     fail with explicit setup instructions.
 *
 * @module dsh-jev-verify
 */

import { VERIFY_CASES } from "./cases.js";
import { createGuardModule } from "./guard.js";
import { createDashboardModule } from "./dashboard.js";

// Host-service imports are resolved dynamically so the plugin always loads:
// a missing optional service degrades with an explicit warning instead of a
// hard module failure. With the package's declared dependencies installed,
// these always resolve.
let defineTool = null;
try {
  ({ defineTool } = await import("@deepseek-ai/dsh-tools"));
} catch {
  defineTool = null;
}
let schemasteryDefault = null;
try {
  schemasteryDefault = (await import("@deepseek-ai/schemastery")).default;
} catch {
  schemasteryDefault = null;
}

/** Cordis plugin name used by loader diagnostics. */
export const name = "jev-verify";

/** Services required by this plugin. */
export const inject = ["tools"];

const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_API_KEY_ENV = "TYPESAFE_API_KEY";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_QUESTIONS = 25;
const USER_AGENT = "dsh-jev-verify/0.6.0 (deepseek-harness plugin)";

/** Model input price in USD per million tokens (published: $42 per billion = $0.042/MTok; output free). */
const INPUT_PRICE_USD_PER_MTok = 0.042;

/** Optional credential helpers; degrade to a plain process.env read when unavailable. */
let credentialRef = null;
let launchEnvironmentOf = null;
try {
  ({ credentialRef } = await import("@deepseek-ai/dsh-credentials"));
} catch {
  credentialRef = null;
}
try {
  ({ launchEnvironmentOf } = await import("@deepseek-ai/dsh-launch-environment"));
} catch {
  launchEnvironmentOf = null;
}

const z = schemasteryDefault;

/**
 * Mark a config field as live-editable ("volatile").
 *
 * dsh >= 0.1.7 renders a settings form for a plugin entry only from the fields
 * its Config schema marks volatile (`SettingsForms.volatileForm`); fields
 * without the mark never reach the form. schemastery only grew the fluent
 * `.volatile()` in 3.18.4, so fall back to setting the flag on the schema meta
 * directly — the host reads `schema.meta.volatile`, so both routes produce the
 * same form. A schema that refuses the write is returned untouched: the plugin
 * still loads, it just loses GUI editability on that deployment.
 */
function vol(schema) {
  try {
    if (schema && typeof schema.volatile === "function") return schema.volatile();
    if (schema && schema.meta && typeof schema.meta === "object") schema.meta.volatile = true;
  } catch {
    /* GUI editability is optional; never break the schema itself */
  }
  return schema;
}

export const Config = z
  ? z.object({
      enabled: vol(z.boolean().default(true).description("总开关：关闭后不注册任何 Jev 工具，Jev 模型不参与会话（护栏与仪表盘也随之停用）")),
      /** Literal API key override (secret). Prefer the credential/environment path. */
      apiKey: vol(z.string().role("secret")),
      /** Credential-ref or environment variable holding the TypeSafe API key. */
      apiKeyEnv: vol(z.string().role("credential-ref").default(DEFAULT_API_KEY_ENV)),
      /** API base URL; TYPESAFE_BASE_URL env overrides when set. */
      baseURL: vol(z.string().default(DEFAULT_BASE_URL)),
      /** Model to use; TYPESAFE_MODEL env overrides when set. */
      model: vol(z.string().default(DEFAULT_MODEL)),
      /** Cooperative tool-call timeout budget (ms). */
      timeoutMs: vol(z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS)),
      /** Maximum questions per jev_decision call. */
      maxQuestionsPerCall: vol(z.number().step(1).min(1).max(50).default(DEFAULT_MAX_QUESTIONS)),
      /** Whether the jev_verify benchmark tool is registered. */
      verifyEnabled: vol(z.boolean().default(true)),
      /**
       * Auto-guard mode: high-risk checks (destructive/credential-leaking
       * shell commands, semantic loop detection) layered under deterministic
       * rules, with Jev backstops. Fail-open on Jev failure. Default off;
       * enable via Settings > Plugins > Plugin configuration > Jev.
       */
      autoGuard: z
        .object({
          enabled: vol(z.boolean().default(false)),
          /** Check shell-like tool calls for destructive/privilege/credential risk. */
          safetyCheck: z.boolean().default(true),
          /** Detect semantic stalls over repeated identical tool calls. */
          loopCheck: z.boolean().default(true),
          /** Tool names the safety check applies to. */
          tools: z.array(z.string()).default(["bash", "pwsh", "run_code", "terminal"]),
          /** Run deterministic blacklist rules first (free), Jev only when needed. */
          determinismFirst: z.boolean().default(true),
          /** Noul confidence threshold above which a risky command is denied. */
          denyThreshold: vol(z.number().step(0.05).min(0.5).max(1).default(0.85)),
          /** Max Jev guard calls per session before degrading to deterministic-only. */
          maxJevCallsPerSession: z.number().step(1).min(1).max(1000).default(50),
          /** Repeated consecutive same-tool calls that trigger the loop check. */
          loopConsecutive: z.number().step(1).min(2).max(10).default(3),
          /** Cooldown after a loop verdict before another Jev loop check may run. */
          loopCooldownMs: z.number().step(1000).min(0).default(60000),
          /** Minimum result content length for the loop check to consider. */
          loopMinChars: z.number().step(100).min(0).default(200),
          /** Register the audit tool jev_guard_status. */
          statusTool: vol(z.boolean().default(true)),
        })
        .default({}),
      dashboard: z
        .object({
          enabled: vol(z.boolean().default(false).description("另有 /jev 网页版看板（默认关闭）；对话内随时用 jev_overview 查看")),
          basePath: z.string().default("/jev").description("独立看板挂载路径（仅当 enabled=true）"),
        })
        .default({}),
    })
  : null;

const SETTINGS_NAMESPACE = "jev-verify";

function envGet(ctx, key) {
  if (launchEnvironmentOf) {
    const entry = launchEnvironmentOf(ctx).get(key);
    if (entry && typeof entry.value === "string" && entry.value.length > 0) return entry.value;
  }
  return globalThis.process?.env?.[key];
}

/**
 * Resolve one operation's options from config + environment + credentials,
 * snapshotted at operation entry so a single call never mixes sections.
 */
function resolveOptions(ctx, config) {
  const apiKeyEnv = credentialRef ? credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV) : null;
  const literalApiKey = typeof config.apiKey === "string" && config.apiKey.length > 0 ? config.apiKey : void 0;
  return {
    apiKey: literalApiKey,
    resolveApiKey: async () => {
      if (literalApiKey) return literalApiKey;
      if (apiKeyEnv) {
        const credentials = ctx.get("credentials");
        if (credentials) {
          const resolved = await credentials.resolve(apiKeyEnv);
          if (resolved?.value) return resolved.value;
        }
      }
      return envGet(ctx, config.apiKeyEnv ?? DEFAULT_API_KEY_ENV) ?? envGet(ctx, "TYPESAFE_API_KEY");
    },
    baseURL: config.baseURL ?? envGet(ctx, "TYPESAFE_BASE_URL") ?? DEFAULT_BASE_URL,
    model: config.model ?? envGet(ctx, "TYPESAFE_MODEL") ?? DEFAULT_MODEL,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

/** Guard submodule (deterministic rules + Jev risk/loop checks), bound to our HTTP client. */
let guardModule = null;
function guard() {
  if (guardModule === null) guardModule = createGuardModule({ requestSystemOne });
  return guardModule;
}
let dashboardModule = null;
function dashboard() {
  if (dashboardModule === null) dashboardModule = createDashboardModule({ requestSystemOne });
  return dashboardModule;
}

function missingKeyError() {
  return new Error(
    "jev_decision requires a TypeSafe API key — no key configured, and this plugin never fabricates decisions. " +
      "Create a key at https://console.typesafe.ai/keys (free tier), then either:\n" +
      "  1) export TYPESAFE_API_KEY=... in the launching environment, or\n" +
      "  2) store it through the credentials service (Settings > Plugins > Plugin configuration > Jev), or\n" +
      "  3) set a literal apiKey in the jev-verify plugin config."
  );
}

function apiErrorMessage(status, raw) {
  try {
    const parsed = JSON.parse(raw);
    const detail = parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? parsed?.detail;
    if (typeof detail === "string" && detail.length > 0) return detail;
  } catch {
    /* keep default */
  }
  const body = raw.trim().length > 0 ? `: ${raw.slice(0, 300)}` : "";
  return `HTTP ${status}${body}`;
}

/**
 * POST one System One request. Returns { body, latencyMs } or throws a
 * descriptive Error. Observes caller cancellation through `signal`.
 */
async function requestSystemOne(options, body, signal) {
  const endpoint = `${options.baseURL.replace(/\/+$/, "")}/systemone`;
  const apiKey = options.apiKey ?? (options.resolveApiKey ? await options.resolveApiKey() : void 0);
  if (!apiKey || apiKey.length === 0) throw missingKeyError();
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const started = performance.now();
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      body: JSON.stringify(body),
      signal: combined,
    });
  } catch (error) {
    if (signal?.aborted) throw new Error(`jev_decision aborted by caller`);
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`jev_decision timed out after ${options.timeoutMs} ms (endpoint ${endpoint}). Raise timeoutMs if the state is long.`);
    }
    throw new Error(`jev_decision request to ${endpoint} failed: ${String(error)}. Check network access to api.typesafe.ai.`);
  }
  const raw = await response.text();
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    throw new Error(`jev_decision API error: ${apiErrorMessage(response.status, raw)}\nEndpoint: ${endpoint} (HTTP ${response.status})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`jev_decision API returned an unprocessable response body from ${endpoint}: ${raw.slice(0, 300)}`);
  }
  return { body: parsed, latencyMs };
}

/** Validate args and build the wire-level questions map (choice/score criteria shape checks). */
function validateAndBuildQuestions(args, maxQuestions) {
  if (typeof args.state !== "string" || args.state.trim().length === 0) {
    throw new Error("jev_decision: state must be a non-empty string (the unstructured input the questions are evaluated against)");
  }
  if (!Array.isArray(args.questions) || args.questions.length === 0) {
    throw new Error("jev_decision: questions must be a non-empty array of {name, type, instructions, criteria?}");
  }
  if (args.questions.length > maxQuestions) {
    throw new Error(`jev_decision: at most ${maxQuestions} questions per call (got ${args.questions.length}); split into multiple calls`);
  }
  const seen = new Set();
  const questions = {};
  for (const q of args.questions) {
    if (!q || typeof q !== "object") throw new Error("jev_decision: every question must be an object");
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(q.name ?? "")) {
      throw new Error(`jev_decision: question name ${JSON.stringify(q.name)} must match ^[A-Za-z_][A-Za-z0-9_-]{0,63}$`);
    }
    if (seen.has(q.name)) throw new Error(`jev_decision: duplicate question name ${JSON.stringify(q.name)}`);
    seen.add(q.name);
    if (typeof q.instructions !== "string" || q.instructions.trim().length === 0) {
      throw new Error(`jev_decision: question ${JSON.stringify(q.name)} needs instructions (one specific, well-scoped judgment)`);
    }
    switch (q.type) {
      case "noul":
        questions[q.name] = { type: "noul", instructions: q.instructions };
        break;
      case "choice": {
        const criteria = q.criteria;
        if (!criteria || typeof criteria !== "object" || Array.isArray(criteria) || Object.keys(criteria).length < 2) {
          throw new Error(`jev_decision: question ${JSON.stringify(q.name)} of type choice needs an object criteria with >=2 options (option key -> description)`);
        }
        questions[q.name] = { type: "choice", instructions: q.instructions, criteria };
        break;
      }
      case "score": {
        const criteria = q.criteria;
        if (!Array.isArray(criteria) || criteria.length < 2 || !criteria.every((level) => typeof level === "string")) {
          throw new Error(`jev_decision: question ${JSON.stringify(q.name)} of type score needs an array criteria with >=2 ordered level descriptions`);
        }
        questions[q.name] = { type: "score", instructions: q.instructions, criteria };
        break;
      }
      default:
        throw new Error(`jev_decision: question ${JSON.stringify(q.name)} has unsupported type ${JSON.stringify(q.type)} (expected choice | score | noul)`);
    }
  }
  return questions;
}

function formatDecision(value) {
  const lines = [];
  lines.push(`je\u0065v_decision | model=${value.model} | ${value.latencyMs} ms | est. cost $${value.estimatedCostUs.toFixed(7)}`);
  for (const [key, answer] of Object.entries(value.answers ?? {})) {
    switch (answer?.type) {
      case "noul":
        lines.push(`- ${key}: noul=${answer.noul} (yes if > 0.5)`);
        break;
      case "choice":
        lines.push(`- ${key}: choice=${answer.choice} confidence=${answer.confidence} probabilities=${JSON.stringify(answer.probabilities)}`);
        break;
      case "score": {
        const top = Object.keys(answer.legend ?? {}).length - 1;
        lines.push(`- ${key}: score=${answer.score}/${top} confidence=${answer.confidence} probabilities=${JSON.stringify(answer.probabilities)}`);
        break;
      }
      default:
        lines.push(`- ${key}: ${JSON.stringify(answer)}`);
    }
  }
  const usage = value.usage ?? {};
  lines.push(`usage: ${usage.input_tokens ?? 0} input tokens, ${usage.output_tokens ?? 0} output tokens`);
  return lines.join("\n");
}

function latencyStats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
  };
}

/**
 * Online verification: run every built-in labeled case against the live API
 * exactly like real usage (one parallel call per case). Returns null when no
 * key is configured (callers report the honest "not verified" state).
 */
async function verifyAgainstLiveApi(options) {
  const apiKey = options.apiKey ?? (options.resolveApiKey ? await options.resolveApiKey() : void 0);
  if (!apiKey || apiKey.length === 0) return null;
  const callOptions = { ...options, apiKey };
  const results = [];
  const latencySamples = [];
  let correct = 0;
  let total = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const mislabeled = [];
  for (const testCase of VERIFY_CASES) {
    const questions = {};
    for (const q of testCase.questions) {
      questions[q.key] = q.criteria !== void 0
        ? { type: q.type, instructions: q.instructions, criteria: q.criteria }
        : { type: q.type, instructions: q.instructions };
    }
    const { body: response, latencyMs } = await requestSystemOne(
      callOptions,
      { state: testCase.state, model: options.model, questions },
      void 0,
    );
    latencySamples.push(latencyMs);
    totalInputTokens += response?.usage?.input_tokens ?? 0;
    totalOutputTokens += response?.usage?.output_tokens ?? 0;
    for (const q of testCase.questions) {
      const answer = response?.answers?.[q.key];
      total += 1;
      const detail = { caseId: testCase.id, question: q.key, expected: q.expected, actual: null, ok: false, confidence: null, latencyMs };
      if (answer === void 0) {
        detail.actual = "<missing>";
        results.push(detail);
        mislabeled.push(detail);
        continue;
      }
      switch (q.type) {
        case "noul": {
          const value = answer.noul;
          const ok = q.expected ? value >= 0.5 : value < 0.5;
          detail.actual = value;
          detail.confidence = Math.abs(value - 0.5) * 2;
          detail.ok = ok;
          break;
        }
        case "choice":
          detail.actual = answer.choice;
          detail.confidence = answer.confidence ?? null;
          detail.ok = answer.choice === q.expected;
          break;
        case "score":
          detail.actual = answer.score;
          detail.confidence = answer.confidence ?? null;
          detail.ok = answer.score === q.expected;
          break;
      }
      if (detail.ok) correct += 1;
      else mislabeled.push(detail);
      results.push(detail);
    }
  }
  const accuracy = total > 0 ? correct / total : 0;
  const stats = latencyStats(latencySamples);
  const highConf = results.filter((r) => r.confidence != null && r.confidence > 0.6);
  const highConfRight = highConf.filter((r) => r.ok).length;
  const highConfAccuracy = highConf.length > 0 ? highConfRight / highConf.length : null;
  const mislabeledHighConf = mislabeled.filter((r) => r.confidence != null && r.confidence > 0.6);
  return {
    model: options.model,
    ranAt: new Date().toISOString(),
    caseCount: VERIFY_CASES.length,
    questionCount: total,
    correct,
    accuracy,
    highConfidenceAccuracy: highConfAccuracy,
    std: stats,
    cost: {
      totalInputTokens,
      totalOutputTokens,
      estimatedUsd: (totalInputTokens * INPUT_PRICE_USD_PER_MTok) / 1e6,
    },
    mislabeled: mislabeledHighConf.length > 0 ? mislabeledHighConf : mislabeled,
  };
}

function formatOverview(value) {
  const s = value.status;
  const sum = value.summary;
  const lines = [];
  lines.push("## Jev 决策看板");
  lines.push(
    "model " + s.model + " · " +
    (s.keyConfigured ? "Key ✓" : "Key ✗（无 Key 时工具与护栏会报错而非伪造）") +
    " · 护栏 " + (s.guardActive ? "开启" : "关闭") +
    (s.denyThreshold != null ? " · 阈值 " + s.denyThreshold : ""),
  );
  lines.push("");
  lines.push("| 指标 | 值 |");
  lines.push("| --- | --- |");
  lines.push("| 决策调用 | " + (sum.calls ?? 0) + " |");
  lines.push("| 中位延迟 | " + (sum.medianLatencyMs == null ? "—" : sum.medianLatencyMs + " ms") + " |");
  lines.push("| 平均置信度 | " + (sum.avgConfidence == null ? "—" : Math.round(sum.avgConfidence * 100) + "%") + " |");
  lines.push("| 累计输入 tokens | " + (sum.totalInputTokens ?? 0) + " |");
  lines.push("| 累计成本 | " + (sum.totalCostUs == null ? "—" : "$" + ((sum.totalCostUs ?? 0) * 1e6).toFixed(1) + "µ") + " |");
  lines.push("| 护栏拦截/建议 | " + (sum.guardDenials ?? 0) + " / " + (sum.guardAdvisories ?? 0) + " |");
  lines.push("| verify 次数 | " + (sum.verifies ?? 0) + " |");
  lines.push("");
  const decisions = (value.recent ?? []).filter((e) => e.questions);
  if (decisions.length > 0) {
    lines.push("### 最近决策");
    lines.push("| 时间 | 内容 | 答案/置信度 | 延迟 |");
    lines.push("| --- | --- | --- | --- |");
    for (const d of decisions.slice(-6)) {
      const qs = (d.questions ?? []).map((q) => q.name + "=" + (q.value == null ? "?" : q.value) + (q.confidence != null ? " (" + Math.round(q.confidence * 100) + "%)" : "")).join(", ");
      const t = String(d.ts ?? "").slice(11, 19);
      lines.push("| " + t + " | " + String(d.stateHead ?? "").slice(0, 40) + " | " + qs + " | " + (d.latencyMs != null ? d.latencyMs + " ms" : "—") + " |");
    }
    lines.push("");
  }
  const guards = value.guards ?? [];
  if (guards.length > 0) {
    lines.push("### 护栏事件");
    for (const g of guards.slice(-6)) {
      lines.push("- " + String(g.ts ?? "").slice(11, 19) + " **" + g.action + "** — " + String(g.detail ?? ""));
    }
    lines.push("");
  }
  lines.push("> 用 jev_decision 做高频判定、jev_verify 自检、jev_overview 看全局——全部真实 API、可审计，绝不伪造。");
  return lines.join("\n");
}

function formatGuardStatus(value) {
  if (!value.enabled) return "jev_guard_status: auto-guard is DISABLED (autoGuard.enabled is not true). Risk detection does not run.";
  const lines = [];
  lines.push("jev_guard_status | auto-guard ENABLED");
  lines.push("guarded tools: " + value.tools.join(", "));
  lines.push("deny threshold: " + value.denyThreshold + " | session Jev budget left: " + value.budgetRemaining);
  lines.push("safety: " + value.safety.checks + " checks, " + value.safety.jevCalls + " Jev calls, " + value.safety.deterministicDenied + " deterministic + " + value.safety.denied + " Jev denials");
  lines.push("pre-execute audit: " + (value.safety.auditCalls ?? 0) + " events, seen tools: " + JSON.stringify(value.safety.seenTools ?? {}) + ", last arg keys: " + (value.safety.lastArgKeys ?? "(none)"));
  lines.push("loop: " + value.loop.checks + " checks, " + value.loop.jevCalls + " Jev calls, " + value.loop.injected + " stall advisories injected");
  return lines.join("\n");
}

function formatVerify(value) {
  if (value === null) {
    return "jev_verify: no TYPESAFE_API_KEY configured — verification not run; nothing is faked. Configure a key to get real measurements.";
  }
  const lines = [];
  lines.push(`je\u0065v_verify | model=${value.model} | ${value.questionCount} questions / ${value.caseCount} cases | accuracy=${(value.accuracy * 100).toFixed(1)}% (${value.correct}/${value.questionCount})`);
  lines.push(`latency: median ${value.std.medianMs} ms, p95 ${value.std.p95Ms} ms, range ${value.std.minMs}–${value.std.maxMs} ms`);
  if (value.highConfidenceAccuracy != null) {
    lines.push(`calibration (confidence>0.6): ${(value.highConfidenceAccuracy * 100).toFixed(1)}% correct`);
  }
  lines.push(`cost: ${value.cost.totalInputTokens} input tokens (~$${value.cost.estimatedUsd.toFixed(6)} at $0.042/MTok, output free)`);
  if (value.mislabeled.length > 0) {
    lines.push("mislabeled:");
    for (const m of value.mislabeled.slice(0, 20)) {
      lines.push(`- ${m.caseId}/${m.question}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}${m.confidence != null ? ` (conf ${m.confidence.toFixed(2)})` : ""}`);
    }
  }
  lines.push(`verified against the live TypeSafe API at ${value.ranAt} — independent, measured evidence.`);
  return lines.join("\n");
}

/** Register the agent tools. Missing key => structured errors at call time; answers are never fabricated. */
function apply(ctx, config) {
  // Live config: GUI settings (Settings > Plugins > Plugin configuration > Jev)
  // feed this reference, so saved apiKey/thresholds take effect without restart.
  let liveConfig = { ...config };
  /** Which settings generation this host uses: none | registered | entry-form. */
  let settingsMode = "none";
  /**
   * Current effective config. On the registered generation the watched scope is
   * authoritative; on the entry-form generation the host reconfigures this very
   * fiber when the form is saved, so the fiber config is authoritative.
   */
  const liveConfigOf = () => {
    if (settingsMode === "entry-form") {
      try {
        const live = ctx.config;
        if (live && typeof live === "object") return { ...config, ...live };
      } catch {
        /* fall back to the apply-time snapshot */
      }
    }
    return liveConfig;
  };
  const warn = (tag, msg) => {
    try {
      ctx.logger?.warn?.("[dsh-jev-verify] " + tag + ": " + String(msg));
    } catch {
      /* logging must never break boot */
    }
  };
  const safe = (tag, fn) => {
    try {
      return fn();
    } catch (error) {
      warn(tag, error);
      return undefined;
    }
  };
  // 0) Boot-stability: every registration below is quarantined; a failure in
  //    ANY of them must degrade that feature alone, never the whole profile.
  //
  //    Settings exist in two generations and neither may break boot:
  //      <= 0.1.5  an explicit namespace is registered here, and its scope is
  //                watched so GUI saves reach us without a restart.
  //      >= 0.1.7  there is no registration API at all: the profile entry id IS
  //                the namespace and the form is generated from this plugin's
  //                Config (hence the volatile marks above), so live values are
  //                read from the fiber's own config instead.
  safe("settings", () => {
    ctx.inject(["settings"], (settingsCtx) => {
      const settings = settingsCtx?.settings;
      if (settings === void 0 || typeof settings.register !== "function") {
        settingsMode = "entry-form";
        try {
          console.log("[dsh-jev-verify] settings: no register() on this host (dsh >= 0.1.7) — the entry form for \"" + SETTINGS_NAMESPACE + "\" is generated from this plugin's Config | schema:", Config ? "present" : "NULL");
        } catch (e) { /* ignore */ }
        return;
      }
      try {
        const scope = settings.register(SETTINGS_NAMESPACE, Config, { base: config });
        settingsMode = "registered";
        try {
          console.log("[dsh-jev-verify] settings namespace registered:", SETTINGS_NAMESPACE, "| schema:", Config ? "present" : "NULL", "| scope:", typeof scope);
        } catch (e) { /* ignore */ }
        const sync = () => {
          try {
            const got = scope.get();
            if (got && typeof got === "object") liveConfig = Object.assign({}, config, got);
          } catch {
            /* keep composed config */
          }
        };
        try {
          scope.watch(sync);
        } catch {
          /* watch optional */
        }
        sync();
      } catch (error) {
        try {
          console.log("[dsh-jev-verify] SETTINGS REGISTER FAILED:", String(error));
        } catch (e) { /* ignore */ }
        warn("settings-register", error);
      }
    });
  });
  if (config.enabled === false) return;
  const opts = () => resolveOptions(ctx, liveConfigOf());
  const guardRuntime = safe("auto-guard", () => guard().applyAutoGuard(ctx, liveConfigOf(), opts(), {
    onSafetyDeny: (e) => dashboard().record({ kind: "guard", ts: new Date().toISOString(), action: "deny", detail: (e.deterministic ? "确定性规则 " : "Jev 判定 ") + (e.rule ?? "") + (e.confidence != null ? " (" + Math.round(e.confidence * 100) + "%)" : "") + " — " + String(e.command ?? "").slice(0, 80) }),
    onLoopAdvisory: (e) => dashboard().record({ kind: "guard", ts: new Date().toISOString(), action: "advise", detail: "循环停滞建议 (" + Math.round(e.noul * 100) + "%) — " + String(e.tool ?? "") }),
  }));
  const registerGuardStatus = () => {
    const { gs, guardTools, denyThreshold } =
      guardRuntime ?? { gs: null, guardTools: [], denyThreshold: null };
    ctx.tools.register(defineTool({
      name: "jev_guard_status",
      description:
        "Audit the Jev auto-guard: current counters (checks / Jev calls / denials / loop verdicts), guarded tools, thresholds, and budget state. " +
        "Use to confirm the guard is active and how often it fired. Returns an honest snapshot; when the guard is disabled it says so.",
      parameters: {},
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: formatGuardStatus(value) }],
      },
      timeoutMs: 5000,
      isConcurrencySafe: () => true,
      async execute() {
        const enabled = guardRuntime !== null;
        const safety = gs?.safety ?? { checks: 0, jevCalls: 0, denied: 0, deterministicDenied: 0, lastVerdicts: new Map(), auditCalls: 0, lastSeenTool: null };
        const loop = gs?.loop ?? { checks: 0, jevCalls: 0, injected: 0, window: [], cooldownUntil: 0 };
        return {
          enabled,
          tools: [...guardTools],
          denyThreshold,
          safety: { ...safety, lastVerdicts: Object.fromEntries(safety.lastVerdicts ?? new Map()) },
          loop: { ...loop, window: (loop.window ?? []).map((w) => ({ tool: w.tool, chars: w.content?.length ?? 0, at: w.at })) },
          budgetRemaining: Math.max(0, (liveConfigOf().autoGuard?.maxJevCallsPerSession ?? 50) - safety.jevCalls - loop.jevCalls),
        };
      },
    }));
  };
  safe("tool:jev_guard_status", registerGuardStatus);
  const guardExtra = () =>
    guardRuntime
      ? {
          guardActive: true,
          denyThreshold: guardRuntime.denyThreshold,
          budgetRemaining: Math.max(0, (liveConfigOf().autoGuard?.maxJevCallsPerSession ?? 50) - guardRuntime.gs.safety.jevCalls - guardRuntime.gs.loop.jevCalls),
        }
      : {};
  try {
    if (liveConfigOf().dashboard?.enabled === true) {
      ctx.inject(["webServer"], (webCtx) => {
        if (ctx.__dshJevDashboardMounted !== true) {
          ctx.__dshJevDashboardMounted = true;
          dashboard().registerRoutes(webCtx, config, opts, guardExtra);
        }
      });
    } else {
      // The in-dialogue overview reads the same roll the web page would; every
      // decision already records into it, so there is nothing to mount here.
    }
  } catch {
    /* host without webServer: dialogue-only overview still works */
  }

  safe("tool:jev_decision", () => ctx.tools.register(defineTool({
    name: "jev_decision",
    description:
      "Ask TypeSafe Jev (System One decision model) typed questions — choice (pick one option), score (rate on ordered levels), noul (yes/no) — against a state string. " +
      "All questions are evaluated in parallel in ONE fast API call (~70–500 ms), returning per-question answers with calibrated confidence and probabilities. " +
      "Use for fast high-frequency judgments (classification, routing, triage, scoring, truth checks) instead of a text-generating LLM. " +
      "Jev does not generate text — never use for prose. Requires a TYPESAFE_API_KEY.",
    parameters: {
      state: {
        type: "string",
        required: true,
        description: "The unstructured state/input the questions are evaluated against (ticket text, code snippet, page excerpt, log line, ...).",
      },
      questions: {
        type: "array",
        required: true,
        description: "1–25 questions, all evaluated in parallel: {name, type: choice|score|noul, instructions, criteria?}.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", required: true, description: "Stable ASCII key (^[A-Za-z_][A-Za-z0-9_-]{0,63}$), e.g. is_urgent" },
            type: { type: "string", required: true, enum: ["choice", "score", "noul"], description: "choice=one option; score=ordinal level; noul=probabilistic yes/no" },
            instructions: { type: "string", required: true, description: "One specific, well-scoped judgment in plain words (e.g. 'The message conveys urgency')" },
            criteria: { type: "json", description: "choice: object {option: description} with >=2 options. score: ordered array of >=2 level strings. Omit for noul. Shape is validated at runtime." },
          },
        },
      },
      model: { type: "string", description: "Optional model override (default jev-latest; pin e.g. jev-1.13.0 for reproducibility)" },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          model: { type: "string", required: true },
          answers: { type: "object", required: true, additionalProperties: true, description: "Per-question typed answers with probabilities/confidence" },
          usage: {
            type: "object",
            required: true,
            additionalProperties: true,
            properties: {
              input_tokens: { type: "number" },
              output_tokens: { type: "number" },
            },
          },
          latencyMs: { type: "number", required: true },
          estimatedCostUs: { type: "number", required: true },
          endpoint: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: formatDecision(value) }],
    },
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "Jev decision" + (Array.isArray(args?.questions) ? " (" + args.questions.length + " questions)" : ""),
      kind: "jev",
      rawInput: String(args?.state ?? "").slice(0, 120),
    }),
    async execute(args, exec) {
      const options = opts();
      const maxQuestions = Math.max(1, liveConfigOf().maxQuestionsPerCall ?? DEFAULT_MAX_QUESTIONS);
      const questions = validateAndBuildQuestions(args, maxQuestions);
      const body = {
        state: args.state,
        model: typeof args.model === "string" && args.model.trim().length > 0 ? args.model : options.model,
        questions,
      };
      const { body: response, latencyMs } = await requestSystemOne(options, body, exec.signal);
      const usage = response.usage ?? { input_tokens: 0, output_tokens: 0 };
      dashboard().record({
        kind: "decision",
        ts: new Date().toISOString(),
        source: "agent",
        stateHead: String(args.state).slice(0, 120),
        questions: Object.entries(questions).map(([n, q]) => ({
          name: n,
          type: q.type,
          value: response.answers?.[n]?.noul ?? response.answers?.[n]?.choice ?? response.answers?.[n]?.score ?? null,
          confidence: response.answers?.[n]?.confidence ?? null,
        })),
        latencyMs,
        costUs: (usage.input_tokens * INPUT_PRICE_USD_PER_MTok) / 1e6,
        inputTokens: usage.input_tokens,
      });
      return {
        model: response.model ?? body.model,
        answers: response.answers ?? {},
        usage,
        latencyMs,
        estimatedCostUs: (usage.input_tokens * INPUT_PRICE_USD_PER_MTok) / 1e6,
        endpoint: `${options.baseURL.replace(/\/+$/, "")}/systemone`,
      };
    },
  })));


  safe("tool:jev_overview", () => ctx.tools.register(defineTool({
    name: "jev_overview",
    description:
      "在对话内查看 Jev 决策看板：最近决策（答案+置信度）、延迟中位/p95、问题类型分布、护栏事件计数、成本累计以及 Key/护栏状态。替代独立网页，一次调用直接看到全部关键指标。",
    parameters: {},
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: formatOverview(value) }],
    },
    timeoutMs: 8000,
    isConcurrencySafe: () => true,
    async execute() {
      const options = opts();
      const snapshot = dashboard().summary(dashboard().roll);
      let keyConfigured = false;
      try {
        const key = options.apiKey ?? (options.resolveApiKey ? await options.resolveApiKey() : void 0);
        keyConfigured = typeof key === "string" && key.length > 0;
      } catch {
        keyConfigured = false;
      }
      return {
        status: {
          model: options.model,
          keyConfigured,
          guardActive: liveConfigOf().autoGuard?.enabled === true || false,
          denyThreshold: liveConfigOf().autoGuard?.denyThreshold ?? null,
          endpoint: String(options.baseURL).replace(/\/+$/, "") + "/systemone",
        },
        summary: snapshot,
        recent: dashboard().roll.slice(-8).map((e) =>
          e.kind === "decision"
            ? { ts: e.ts, source: e.source ?? "agent", stateHead: String(e.stateHead ?? "").slice(0, 60), questions: e.questions, latencyMs: e.latencyMs, costUs: e.costUs }
            : e.kind === "guard"
              ? { ts: e.ts, action: e.action, detail: e.detail }
              : { ts: e.ts, report: e.summaryText },
        ),
        guards: dashboard().roll.filter((e) => e.kind === "guard").slice(-10),
      };
    },
  })));

  safe("system-prompt", () => {
    ctx.inject(["systemPrompt"], (spCtx) => {
      const section = {
        name: "tool:jev",
        text: ({ scope }) => {
          try {
            if (ctx.tools.get("jev_decision", scope) === void 0) return "";
          } catch {
            return "";
          }
          return "Jev (TypeSafe System One) 快速决策工具已就绪：jev_decision 用于分类/路由/评分/真伪等高频小判定（一次并行调用约 300ms，支持 choice/score/noul）；jev_verify 跑线上自检；jev_overview 看管理看板。高频原子判定优先用 jev_decision，把慢 LLM 留给复杂推理。";
        },
      };
      try {
        section.order = spCtx.systemPrompt.getSectionOrder("TOOL_JEV");
      } catch {
        /* order optional */
      }
      spCtx.systemPrompt.section(section);
    });
  });


  if (liveConfigOf().verifyEnabled !== false) {
    safe("tool:jev_verify", () => ctx.tools.register(defineTool({
      name: "jev_verify",
      description:
        "Run the built-in labeled benchmark (24 questions across 15+ cases: urgency, spam, toxicity, routing, intent, severity, satisfaction) against the LIVE TypeSafe Jev API. " +
        "Returns measured accuracy, median/p95 latency, confidence calibration and cost — independent real verification to confirm the endpoint works and catch regressions. " +
        "When TYPESAFE_API_KEY is missing it returns an explicit 'not verified' message (never fabricates results).",
      parameters: {
        model: { type: "string", description: "Optional model override for the verification run (default: configured model)" },
      },
      output: {
        schema: { type: "object", additionalProperties: true, description: "Verification report: accuracy, latency stats, cost, mislabeled cases" },
        render: (_args, value) => [{ type: "text", text: formatVerify(value) }],
      },
      timeoutMs: Math.max((liveConfigOf().timeoutMs ?? DEFAULT_TIMEOUT_MS) * 3, 30000),
      isConcurrencySafe: () => true,
      async execute(args) {
        const options = opts();
        const model = typeof args.model === "string" && args.model.trim().length > 0 ? args.model : options.model;
        const report = await verifyAgainstLiveApi({ ...options, model });
        if (report !== null) {
          dashboard().record({
            kind: "verify",
            ts: new Date().toISOString(),
            model: report.model,
            summaryText:
              "accuracy " + (report.accuracy * 100).toFixed(1) + "% (" + report.correct + "/" + report.questionCount + "), median " + report.std.medianMs + " ms",
            accuracy: report.accuracy,
            ok: true,
          });
        }
        return report;
      },
  })));
  }

}

export { apply, verifyAgainstLiveApi };