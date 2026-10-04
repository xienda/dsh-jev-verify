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
import { createCounselModule } from "./counsel.js";

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
const USER_AGENT = "dsh-jev-verify/0.7.5 (deepseek-harness plugin)";

/** Model input price in USD per million tokens (published: $42 per billion = $0.042/MTok; output free). */
const INPUT_PRICE_USD_PER_MTok = 0.042;

/** Max parallel cases in a jev_verify run (bounded so a run stays inside the tool timeout). */
const VERIFY_CONCURRENCY = 6;

/** Optional credential helpers; degrade to a plain process.env read when unavailable. */
let credentialRef = null;
let isCredentialRefName = null;
let launchEnvironmentOf = null;
try {
  ({ credentialRef, isCredentialRefName } = await import("@deepseek-ai/dsh-credentials"));
} catch {
  credentialRef = null;
  isCredentialRefName = null;
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
       * System-prompt guidance: the section that tells the harness WHEN to call
       * a Jev tool. Without it the model only sees the tool descriptions, so it
       * under-uses Jev on decisions a 300 ms judgment call would settle.
       */
      guidance: z
        .object({
          enabled: vol(z.boolean().default(true).description("向系统提示注入 Jev 主动使用指引（关闭后 harness 只能靠工具描述发现 Jev）")),
          order: vol(z.number().step(50).default(3000).description("引导段在系统提示中的排序位（默认 3000，位于内置工具段之后）")),
          extra: vol(z.string().default("").description("追加的部署自定义使用规则（原样附在指引末尾，留空则不加）")),
        })
        .default({}),
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
 * Normalize a configured credential-ref field into a bare identifier or "".
 *
 * The settings form can round-trip a credential-ref field as an object
 * ({ ref } / { name } / { value }) and the text control accepts arbitrary
 * input, while credentialRef() throws a TypeError for anything that is not a
 * bare identifier. Every input is therefore coerced before it is branded.
 */
/**
 * Volatile-field access.
 *
 * dsh marks GUI-editable settings fields volatile; schemastery then resolves
 * such a field to a Volatile reference — `{ get(), [Symbol.for("cosmokit.volatile.write")] }`
 * — instead of the plain value. Reading the reference directly yields an
 * object: that produced the historical `credential ref "[object Object]"`
 * crash and silently turned every settings toggle/number into a truthy
 * object (guard/dashboard gates never matched `=== true`, maxQuestions became
 * NaN). Every config read therefore goes through normalizeConfig().
 */
const VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

/** Is this value a schemastery Volatile reference rather than a plain value? */
function isVolatileRef(value) {
  return !!value && typeof value === "object" && typeof value.get === "function"
    && (VOLATILE_WRITE in value || Object.keys(value).length <= 1);
}

/** Read one config field through its volatile accessor when it has one. */
function unwrapField(raw) {
  if (!isVolatileRef(raw)) return raw;
  try {
    return raw.get();
  } catch {
    return undefined;
  }
}

/** Deep-unwrap a config object so every volatile field becomes its live value. */
function normalizeConfig(raw, depth = 0) {
  if (!raw || typeof raw !== "object") return raw;
  if (isVolatileRef(raw)) return depth > 6 ? undefined : normalizeConfig(unwrapField(raw), depth + 1);
  if (depth > 6) return raw;
  if (Array.isArray(raw)) return raw.map((item) => normalizeConfig(item, depth + 1));
  const out = {};
  for (const key of Object.keys(raw)) out[key] = normalizeConfig(raw[key], depth + 1);
  return out;
}

function credentialNameOf(raw) {
  if (typeof raw === "string") return raw.trim();
  if (raw && typeof raw === "object") {
    for (const key of ["ref", "name", "value", "key", "env", "id"]) {
      const candidate = raw[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
    }
  }
  return "";
}

/** Brand a credential-ref name, returning null instead of throwing on bad input. */
function toCredentialRef(rawName) {
  if (!credentialRef) return null;
  const name = credentialNameOf(rawName);
  if (name.length === 0) return null;
  if (isCredentialRefName && !isCredentialRefName(name)) return null;
  try {
    return credentialRef(name);
  } catch {
    return null;
  }
}

/**
 * Resolve one operation's options from config + environment + credentials,
 * snapshotted at operation entry so a single call never mixes sections.
 * Never throws: a malformed config degrades to the documented defaults.
 */
function resolveOptions(ctx, config) {
  const normalized = normalizeConfig(config);
  const cfg = normalized && typeof normalized === "object" ? normalized : {};
  const requestedEnv = credentialNameOf(cfg.apiKeyEnv);
  const envName = requestedEnv.length > 0 && (!isCredentialRefName || isCredentialRefName(requestedEnv))
    ? requestedEnv
    : DEFAULT_API_KEY_ENV;
  const apiKeyEnv = toCredentialRef(envName);
  const literalApiKey = typeof cfg.apiKey === "string" && cfg.apiKey.length > 0 ? cfg.apiKey : void 0;
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
      return envGet(ctx, envName) ?? envGet(ctx, "TYPESAFE_API_KEY");
    },
    // Environment overrides win over config (matching the documented comment on
    // the schema fields): the config object always carries schema defaults, so
    // `cfg.baseURL ?? env` could never observe TYPESAFE_BASE_URL.
    baseURL: envGet(ctx, "TYPESAFE_BASE_URL") ?? cfg.baseURL ?? DEFAULT_BASE_URL,
    model: envGet(ctx, "TYPESAFE_MODEL") ?? cfg.model ?? DEFAULT_MODEL,
    timeoutMs: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
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
  if (dashboardModule === null) dashboardModule = createDashboardModule({ requestSystemOne, inputPriceUsdPerMTok: INPUT_PRICE_USD_PER_MTok });
  return dashboardModule;
}

/** Counsel submodule (jev_choose multi-option ranking), bound to our HTTP client. */
let counselModule = null;
function counsel() {
  if (counselModule === null) counselModule = createCounselModule({ requestSystemOne });
  return counselModule;
}

function toolLabel(options) {
  const name = options && typeof options.toolName === "string" ? options.toolName.trim() : "";
  return name.length > 0 ? name : "jev_decision";
}

function missingKeyError(tool) {
  return new Error(
    toolLabel({ toolName: tool }) + " requires a TypeSafe API key — no key configured, and this plugin never fabricates decisions. " +
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
  const label = toolLabel(options);
  const endpoint = `${options.baseURL.replace(/\/+$/, "")}/systemone`;
  const apiKey = options.apiKey ?? (options.resolveApiKey ? await options.resolveApiKey() : void 0);
  if (!apiKey || apiKey.length === 0) throw missingKeyError(label);
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
    if (signal?.aborted) throw new Error(`${label} aborted by caller`);
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new Error(`${label} timed out after ${options.timeoutMs} ms (endpoint ${endpoint}). Raise timeoutMs if the state is long.`);
    }
    throw new Error(`${label} request to ${endpoint} failed: ${String(error)}. Check network access to api.typesafe.ai.`);
  }
  const raw = await response.text();
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    throw new Error(`${label} API error: ${apiErrorMessage(response.status, raw)}\nEndpoint: ${endpoint} (HTTP ${response.status})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} API returned an unprocessable response body from ${endpoint}: ${raw.slice(0, 300)}`);
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
  const runCase = async (testCase) => {
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
    const details = [];
    for (const q of testCase.questions) {
      const answer = response?.answers?.[q.key];
      const detail = { caseId: testCase.id, question: q.key, expected: q.expected, actual: null, ok: false, confidence: null, latencyMs };
      if (answer === void 0) {
        detail.actual = "<missing>";
        details.push(detail);
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
      details.push(detail);
    }
    return {
      details,
      latencyMs,
      inputTokens: response?.usage?.input_tokens ?? 0,
      outputTokens: response?.usage?.output_tokens ?? 0,
    };
  };
  // The 27 cases are independent HTTP calls. Running them with bounded
  // concurrency keeps the whole benchmark inside the host tool timeout: the
  // serial version measured ~36 s wall clock, close to the SDK 30 s floor.
  for (let start = 0; start < VERIFY_CASES.length; start += VERIFY_CONCURRENCY) {
    const batch = await Promise.all(
      VERIFY_CASES.slice(start, start + VERIFY_CONCURRENCY).map((testCase) => runCase(testCase)),
    );
    for (const item of batch) {
      latencySamples.push(item.latencyMs);
      totalInputTokens += item.inputTokens;
      totalOutputTokens += item.outputTokens;
      for (const detail of item.details) {
        total += 1;
        if (detail.ok) correct += 1;
        else mislabeled.push(detail);
        results.push(detail);
      }
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
    // Report every mislabel, not only the high-confidence ones: hiding low
    // confidence misses would flatter the benchmark. The high-confidence subset
    // stays available as its own field.
    mislabeled,
    mislabeledHighConfidence: mislabeledHighConf,
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
  const failures = value.registrations?.failures ?? [];
  lines.push("settings/tool registration failures: " + (value.registrations?.failureCount ?? 0) + (failures.length > 0 ? " (" + failures.map((f) => f.tag).join(", ") + ")" : ""));
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

/**
 * UI-facing presentation payloads.
 *
 * dsh persists output.presentationMeta(args, value) verbatim as the tool/result
 * "meta" field, which client-side tool views receive as block.meta. Our custom
 * tool views (client/client.js) switch on meta.kind to draw real cards, so the
 * model-facing render text stays human-readable while the UI gets structure.
 * Every projection is total and lossless-JSON (it is cloned by defineTool).
 */
function decisionPresentation(value) {
  const v = value && typeof value === "object" ? value : {};
  const answers = {};
  for (const [name, raw] of Object.entries(v.answers ?? {})) {
    const a = raw && typeof raw === "object" ? raw : {};
    answers[name] = {
      type: typeof a.type === "string" ? a.type : "unknown",
      value: a.noul ?? a.choice ?? a.score ?? null,
      confidence: typeof a.confidence === "number" ? a.confidence : null,
      probabilities: a.probabilities ?? null,
      legend: a.legend ?? null,
      reasoning: typeof a.reasoning === "string" ? a.reasoning.slice(0, 600) : null,
    };
  }
  return {
    kind: "decision",
    model: v.model ?? null,
    latencyMs: typeof v.latencyMs === "number" ? v.latencyMs : null,
    estimatedCostUs: typeof v.estimatedCostUs === "number" ? v.estimatedCostUs : null,
    inputTokens: v.usage?.input_tokens ?? 0,
    outputTokens: v.usage?.output_tokens ?? 0,
    endpoint: v.endpoint ?? null,
    answers,
  };
}

function overviewPresentation(value) {
  const v = value && typeof value === "object" ? value : {};
  const status = v.status && typeof v.status === "object" ? v.status : {};
  const summary = v.summary && typeof v.summary === "object" ? v.summary : {};
  return {
    kind: "overview",
    status: {
      model: status.model ?? null,
      keyConfigured: status.keyConfigured === true,
      guardActive: status.guardActive === true,
      denyThreshold: status.denyThreshold ?? null,
      endpoint: status.endpoint ?? null,
    },
    summary: {
      calls: summary.calls ?? 0,
      verifies: summary.verifies ?? 0,
      guardDenials: summary.guardDenials ?? 0,
      guardAdvisories: summary.guardAdvisories ?? 0,
      medianLatencyMs: summary.medianLatencyMs ?? null,
      avgLatencyMs: summary.avgLatencyMs ?? null,
      avgConfidence: summary.avgConfidence ?? null,
      totalInputTokens: summary.totalInputTokens ?? 0,
      totalCostUs: summary.totalCostUs ?? 0,
      typeCounts: summary.typeCounts ?? {},
    },
    recent: (Array.isArray(v.recent) ? v.recent : []).slice(-8).map((e) => {
      const entry = e && typeof e === "object" ? e : {};
      if (entry.questions) {
        return {
          kind: "decision",
          ts: entry.ts ?? null,
          source: entry.source ?? "agent",
          stateHead: String(entry.stateHead ?? "").slice(0, 80),
          latencyMs: entry.latencyMs ?? null,
          questions: (entry.questions ?? []).slice(0, 10).map((q) => ({
            name: q?.name ?? "?",
            type: q?.type ?? "?",
            value: q?.value ?? null,
            confidence: typeof q?.confidence === "number" ? q.confidence : null,
          })),
        };
      }
      if (entry.action) return { kind: "guard", ts: entry.ts ?? null, action: entry.action, detail: String(entry.detail ?? "").slice(0, 200) };
      return { kind: "verify", ts: entry.ts ?? null, report: String(entry.report ?? "").slice(0, 240) };
    }),
    guards: (Array.isArray(v.guards) ? v.guards : []).slice(-10).map((g) => ({
      ts: g?.ts ?? null,
      action: g?.action ?? "?",
      detail: String(g?.detail ?? "").slice(0, 200),
    })),
  };
}

function guardPresentation(value) {
  const v = value && typeof value === "object" ? value : {};
  const safety = v.safety && typeof v.safety === "object" ? v.safety : {};
  const loop = v.loop && typeof v.loop === "object" ? v.loop : {};
  const verdicts = safety.lastVerdicts instanceof Map ? Object.fromEntries(safety.lastVerdicts) : (safety.lastVerdicts ?? {});
  return {
    kind: "guard",
    enabled: v.enabled === true,
    tools: Array.isArray(v.tools) ? v.tools : [],
    denyThreshold: v.denyThreshold ?? null,
    budgetRemaining: v.budgetRemaining ?? null,
    safety: {
      checks: safety.checks ?? 0,
      jevCalls: safety.jevCalls ?? 0,
      denied: safety.denied ?? 0,
      deterministicDenied: safety.deterministicDenied ?? 0,
      auditCalls: safety.auditCalls ?? 0,
      lastSeenTool: safety.lastSeenTool ?? null,
      seenTools: safety.seenTools ?? {},
      lastVerdicts: verdicts,
    },
    loop: {
      checks: loop.checks ?? 0,
      jevCalls: loop.jevCalls ?? 0,
      injected: loop.injected ?? 0,
      cooldownUntil: loop.cooldownUntil ?? 0,
      window: Array.isArray(loop.window) ? loop.window.slice(-8) : [],
    },
  };
}

function verifyPresentation(value) {
  if (value === null || value === void 0) {
    return { kind: "verify", verified: false, reason: "no TYPESAFE_API_KEY configured — verification not run; nothing is faked" };
  }
  const v = value && typeof value === "object" ? value : {};
  const std = v.std && typeof v.std === "object" ? v.std : {};
  const cost = v.cost && typeof v.cost === "object" ? v.cost : {};
  return {
    kind: "verify",
    verified: true,
    model: v.model ?? null,
    ranAt: v.ranAt ?? null,
    caseCount: v.caseCount ?? 0,
    questionCount: v.questionCount ?? 0,
    correct: v.correct ?? 0,
    accuracy: typeof v.accuracy === "number" ? v.accuracy : null,
    highConfidenceAccuracy: typeof v.highConfidenceAccuracy === "number" ? v.highConfidenceAccuracy : null,
    medianMs: std.medianMs ?? null,
    p95Ms: std.p95Ms ?? null,
    minMs: std.minMs ?? null,
    maxMs: std.maxMs ?? null,
    inputTokens: cost.totalInputTokens ?? 0,
    outputTokens: cost.totalOutputTokens ?? 0,
    estimatedUsd: cost.estimatedUsd ?? null,
    failures: (Array.isArray(v.mislabeled) ? v.mislabeled : []).slice(0, 12).map((m) => ({
      caseId: m?.caseId ?? null,
      question: m?.question ?? "?",
      type: m?.type ?? "?",
      expected: m?.expected ?? null,
      actual: m?.actual ?? null,
      confidence: typeof m?.confidence === "number" ? m.confidence : null,
    })),
  };
}

/**
 * Default system-prompt slot for the Jev guidance section.
 *
 * WHY a literal: `SystemPrompt.section()` throws unless `order` is a finite
 * number, and this DSH generation has no TOOL_JEV slot in its SECTION_ORDERS
 * table, so `getSectionOrder("TOOL_JEV")` returns undefined. 3000 sits after
 * the first-party tool sections (… TOOL_REPORT = 2900) and before TOOLS_SDK.
 */
const DEFAULT_GUIDANCE_ORDER = 3000;

/**
 * Model-facing guidance injected as the `tool:jev` system-prompt section.
 *
 * This is the ONLY place the harness learns WHEN to reach for a Jev tool, so
 * the text is written as trigger rules (tool + situation + boundary), not as
 * marketing prose. Every claim is bound to a real implementation fact: the
 * per-call question budget, the 2-10 option window, the 27-question benchmark,
 * and the honest "Jev scores, it does not explain" contract.
 * @param config - effective plugin config (may be a partial/unknown shape).
 * @returns the section text, or an empty string when disabled by config.
 */
function guidanceText(config) {
  const maxQuestions = (() => {
    const raw = Number(config?.maxQuestionsPerCall);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_MAX_QUESTIONS;
  })();
  const lines = [
    "Jev（TypeSafe System One 判定模型）工具已就绪。分工原则：可判定的高频小决策交给 Jev（更快、更省、可审计），需要生成文字或长链推理的留给主模型。",
    "- jev_decision：对一段 state 文本做 1-" + maxQuestions + " 个并行原子判定（choice 单选 / score 有序打分 / noul 概率是-否），一次 HTTP 调用约 70-500ms，返回每个问题的答案与置信度。何时用：分类打标、路由分派、优先级/严重度/满意度打分、真伪与合规核查、从文本抽取结构化标签。不要用：生成文字、解释理由、多步推理。",
    "- jev_choose：对 2-10 个候选方案并行打分排序（契合度 0-3 + 风险概率），返回排序表、推荐项与置信度。何时用：面对多条可行路线、实现方式取舍、方案对比择优时——先取这份量化参考，再做最终决策并执行。",
    "- jev_overview / jev_guard_status：只读审计。前者=本会话 Jev 账本（最近判定、延迟中位与 p95、成本、护栏事件、Key 与阈值状态）；后者=自动护栏计数器、受管工具、阈值与调用预算。当用户问「Jev 刚才做了什么/拦了什么/花了多少」时调用，不要靠记忆回答。",
    "- jev_verify：对线上 API 跑内置的 27 题自检基准（每轮 27 次真实调用，有成本与耗时），只在确认端点可用性或做回归对比时使用，不要例行调用。",
    "- 判定类任务默认优先 Jev；答卷里的 confidence < 0.6 视为不确定，回主模型复核后再下结论。Jev 只给判定与分数，不写理由——需要理由时由你基于答案结构自行说明，不要编造 Jev 的推理过程。",
  ];
  if (config?.autoGuard?.enabled === true) {
    lines.push("- 自动护栏已在每次 shell 类调用（bash/pwsh/run_code/terminal）前审计：确定性硬规则免费先行，剩余可疑调用再由 Jev 判定，命中即拦截并给出原文。被拦时不要重试同类命令，而是向用户说明风险并请其明确授权。");
  }
  const extra = typeof config?.guidance?.extra === "string" ? config.guidance.extra.trim() : "";
  if (extra.length > 0) lines.push("- 部署自定义规则：" + extra);
  return lines.filter((line) => line.length > 0).join("\n");
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
        if (live && typeof live === "object") return normalizeConfig({ ...config, ...live });
      } catch {
        /* fall back to the apply-time snapshot */
      }
    }
    return normalizeConfig(liveConfig);
  };
  const warn = (tag, msg) => {
    try {
      ctx.logger?.warn?.("[dsh-jev-verify] " + tag + ": " + String(msg));
    } catch {
      /* logging must never break boot */
    }
  };
  /** Registration failures, surfaced through jev_guard_status (not just logged). */
  const regFailures = [];
  const recordRegFailure = (tag, error) => {
    try {
      regFailures.push({ tag, message: String(error?.message ?? error).slice(0, 240) });
    } catch {
      /* diagnostics must never break boot */
    }
    warn(tag, error);
  };
  const safe = (tag, fn) => {
    try {
      return fn();
    } catch (error) {
      recordRegFailure(tag, error);
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
        const scope = settings.register(SETTINGS_NAMESPACE, Config, { base: normalizeConfig(config) });
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
        recordRegFailure("settings-register", error);
      }
    });
  });
  if (unwrapField(config?.enabled) === false) return;
  const opts = (toolName) => {
    const tagged = (value) => (typeof toolName === "string" && toolName.length > 0 ? { ...value, toolName } : value);
    try {
      return tagged(resolveOptions(ctx, liveConfigOf()));
    } catch (error) {
      warn("config", "resolveOptions failed, using defaults: " + (error?.message ?? error));
      return tagged(resolveOptions(ctx, {}));
    }
  };
  const guardRuntime = safe("auto-guard", () => guard().applyAutoGuard(ctx, liveConfigOf(), opts("jev auto-guard"), {
    onSafetyDeny: (e) => dashboard().record({ kind: "guard", ts: new Date().toISOString(), action: "deny", detail: (e.deterministic ? "确定性规则 " : "Jev 判定 ") + (e.rule ?? "") + (e.confidence != null ? " (" + Math.round(e.confidence * 100) + "%)" : "") + " — " + String(e.command ?? "").slice(0, 80) }),
    onLoopAdvisory: (e) => dashboard().record({ kind: "guard", ts: new Date().toISOString(), action: "advise", detail: "循环停滞建议 (" + Math.round(e.noul * 100) + "%) — " + String(e.tool ?? "") }),
  }));
  const registerGuardStatus = () => {
    const { gs, guardTools, denyThreshold } =
      guardRuntime ?? { gs: null, guardTools: [], denyThreshold: null };
    ctx.tools.register(defineTool({
      name: "jev_guard_status",
      description:
      "Read-only audit of the Jev auto-guard: counters for the deterministic rules and the Jev backstop separately (checks / jevCalls / denied / deterministicDenied / auditCalls), the currently guarded tool names, denyThreshold, loop-check counts, and the remaining per-session Jev call budget. " +
      "Call it to confirm the guard is armed, to see how often it actually fired, or to explain why a command was blocked. When the guard is disabled it says so instead of reporting zeros.",    parameters: {},
      output: {
        schema: { type: "object", additionalProperties: true },
        render: (_args, value) => [{ type: "text", text: formatGuardStatus(value) }],
        presentationMeta: (_args, value) => guardPresentation(value),
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
          // 0.7.5: registration failures were previously swallowed into the boot
          // log only; two past releases shipped broken because of exactly that.
          registrations: { failures: regFailures.slice(-20), failureCount: regFailures.length },
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
      "Ask TypeSafe Jev (System One — a decision model, not a text LLM) up to " + (liveConfigOf().maxQuestionsPerCall ?? DEFAULT_MAX_QUESTIONS) + " typed questions about ONE state string. " +
      "All questions are answered in parallel in ONE API call (measured live: ~70-500 ms, median ~300 ms), and each answer carries a calibrated confidence plus probabilities. " +
      "Question types: noul = probabilistic yes/no; choice = exactly one option from criteria {option: description} (>=2 options); score = one level from an ordered criteria array (>=2 levels, low to high). " +
      "CALL IT for fast repeatable judgments: classification/labeling, routing or triage, priority/severity/satisfaction scoring, spam/toxicity/PII checks, intent or truth checks, and extracting structured tags from free text. " +
      "Batch related judgments into ONE call — they run in parallel at no extra latency, so 10 questions cost one round trip, not ten. " +
      "DO NOT call it to write, explain, summarize, generate code, or reason in steps: it returns verdicts only, never reasoning. " +
      "It never fabricates results — without a TYPESAFE_API_KEY it fails with an explicit error. Treat confidence below ~0.6 as uncertain and check that answer yourself.",    parameters: {
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
      presentationMeta: (_args, value) => decisionPresentation(value),
    },
    timeoutMs: unwrapField(config?.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "Jev decision" + (Array.isArray(args?.questions) ? " (" + args.questions.length + " questions)" : ""),
      kind: "jev",
      rawInput: String(args?.state ?? "").slice(0, 120),
    }),
    async execute(args, exec) {
      const options = opts("jev_decision");
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
          // noul answers carry no `confidence` on the wire — the probability is
          // the belief, so the decided side's confidence is noul (yes) or
          // 1 - noul (no). Without this the ledger showed a confident "no" as 2%.
          confidence: response.answers?.[n]?.confidence
            ?? (typeof response.answers?.[n]?.noul === "number" ? Math.abs(response.answers[n].noul - 0.5) * 2 : null),
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


  safe("tool:jev_choose", () => ctx.tools.register(defineTool({
    name: "jev_choose",
    description:
      "让 Jev 对 2-10 个候选方案/路线并行打分排序：每个候选一次调用（契合度 score 0-3 + 风险 noul 概率），返回排序表（契合度/风险/综合/置信）、推荐项与本次成本。 " +
      "何时用：存在多条可行路线、实现方式取舍、方案对比择优，或需要为若干候选排序时——先取这份校准过的量化参考，再做最终决策并执行。 " +
      "何时不用：候选不是若干条可独立描述的方案（如开放式创作、需要逐字生成的文案），这类任务交给主模型。 " +
      "参数边界：options 每项 <=800 字符，建议第一行写一句摘要、后续行写细节；可选 context（<=2000 字符）给出当前目标与约束以提升校准度。 " +
      "Jev 只给分不解释——理由由你基于排序自行说明，不要编造 Jev 的推理过程。",    parameters: {
      options: {
        type: "array",
        description: "候选方案文本（2-10 个，每个 ≤800 字符，建议每行一个：第一行一句摘要，后续行细节）。",
        items: { type: "string" },
      },
      context: { type: "string", description: "可选背景：当前目标、约束、环境（≤2000 字符），帮助 Jev 校准打分。" },
      model: { type: "string", description: "Optional model override (default jev-latest; pin e.g. jev-1.13.0 for reproducibility)" },
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: counsel().formatChoose(value) }],
      presentationMeta: (_args, value) => counsel().choosePresentation(value),
    },
    timeoutMs: Math.max((liveConfigOf().timeoutMs ?? DEFAULT_TIMEOUT_MS) * 3, 30000),
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: "generic",
      title: "Jev choose (" + (Array.isArray(args?.options) ? args.options.length : 0) + " options)",
      kind: "jev",
      rawInput: String(args?.options?.[0] ?? "").slice(0, 120),
    }),
    async execute(args) {
      const options = opts("jev_choose");
      const value = await counsel().rankOptions(args, { ...options, inputPriceUsdPerMTok: INPUT_PRICE_USD_PER_MTok });
      const stateHead =
        String(value.contextHead || (Array.isArray(args.options) && args.options.length > 0 ? args.options[0] : "")).slice(0, 120);
      dashboard().record({
        kind: "choose",
        ts: new Date().toISOString(),
        source: "agent",
        stateHead,
        questions: value.ranking.map((r) => ({
          name: "opt_" + r.index,
          type: "score",
          value: r.fit,
          confidence: r.confidence,
        })),
        latencyMs: value.latencyMs,
        costUs: value.estimatedCostUs,
        inputTokens: value.inputTokens,
      });
      return value;
    },
  })));

  safe("tool:jev_overview", () => ctx.tools.register(defineTool({
    name: "jev_overview",
    description:
      "本会话 Jev 账本的只读快照：最近判定与择案（问题/答案/置信度）、延迟中位与 p95、问题类型分布、护栏事件计数、累计 tokens 与成本，以及 Key、护栏与阈值状态。 " +
      "何时用：用户问「Jev 刚才做了什么 / 拦了什么 / 花了多少」，或需要不重启会话就核对端点与预算状态时。 " +
      "如实边界：账本以插件实例的生命周期为起点——新会话或宿主重启后计数从零开始；护栏计数由 jev_guard_status 单独维护。",    parameters: {},
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: formatOverview(value) }],
      presentationMeta: (_args, value) => overviewPresentation(value),
    },
    timeoutMs: 8000,
    isConcurrencySafe: () => true,
    async execute() {
      const options = opts("jev_overview");
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
          (e.kind === "decision" || e.kind === "choose")
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
      const log = (msg) => {
        try { console.log("[dsh-jev-verify] system prompt: " + msg); } catch { /* logging must never break boot */ }
      };
      const sp = spCtx?.systemPrompt;
      if (sp === void 0 || typeof sp.section !== "function") {
        log("host has no SystemPrompt.section() — guidance not injected (tools remain usable)");
        return;
      }
      if (liveConfigOf().guidance?.enabled === false) {
        log("guidance disabled by config (guidance.enabled = false)");
        return;
      }
      // ORDER IS LOAD-BEARING: SystemPrompt.section() throws unless order is a
      // finite number, and this DSH generation ships no TOOL_JEV slot, so
      // getSectionOrder() yields undefined. 0.7.3 passed that undefined straight
      // through, the TypeError was swallowed by the surrounding quarantine, and
      // the harness never saw the guidance — which is exactly why it did not call
      // Jev on its own. Fall back to guidance.order, then to a safe literal.
      let order = NaN;
      try { order = Number(sp.getSectionOrder?.("TOOL_JEV")); } catch { order = NaN; }
      if (!Number.isFinite(order)) order = Number(liveConfigOf().guidance?.order);
      if (!Number.isFinite(order)) order = DEFAULT_GUIDANCE_ORDER;
      const section = {
        name: "tool:jev",
        order,
        text: ({ scope }) => {
          try {
            if (ctx.tools.get("jev_decision", scope) === void 0) return "";
          } catch {
            return "";
          }
          return guidanceText(liveConfigOf());
        },
      };
      try {
        sp.section(section);
        log("guidance registered | section tool:jev | order " + order + " | chars " + guidanceText(liveConfigOf()).length);
      } catch (error) {
        log("guidance FAILED: " + String(error));
        recordRegFailure("system-prompt", error);
      }
    });
  });


  if (liveConfigOf().verifyEnabled !== false) {
    safe("tool:jev_verify", () => ctx.tools.register(defineTool({
      name: "jev_verify",
      description:
      "Run the built-in labeled benchmark (27 labeled questions from lib/cases.js covering urgency, spam, toxicity, personal data, department routing, intent, search type, priority, severity, satisfaction, and destructive/benign guard verdicts) against the LIVE TypeSafe Jev API. " +
      "Returns measured accuracy overall and on the high-confidence subset, median/p95/min/max latency, confidence calibration, token and cost totals, and the list of mislabeled cases. " +
      "Call it to confirm the endpoint works, compare model versions, or check for a regression — not routinely: one run is 27 real API calls (~8.7K input tokens, ~$0.0004). " +
      "When TYPESAFE_API_KEY is missing it returns an explicit not-verified message and never fabricates results.",    parameters: {
        model: { type: "string", description: "Optional model override for the verification run (default: configured model)" },
      },
      output: {
        schema: { type: "object", additionalProperties: true, description: "Verification report: accuracy, latency stats, cost, mislabeled cases" },
        render: (_args, value) => [{ type: "text", text: formatVerify(value) }],
        presentationMeta: (_args, value) => verifyPresentation(value),
      },
      timeoutMs: Math.max((liveConfigOf().timeoutMs ?? DEFAULT_TIMEOUT_MS) * 3, 30000),
      isConcurrencySafe: () => true,
      async execute(args) {
        const options = opts("jev_verify");
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

/**
 * Test-only surface. The config helpers are pure and are exercised by
 * test/config.test.mjs to lock in the "a malformed config never throws"
 * contract: credentialRef() throws on any field value that is not a bare
 * identifier, which previously broke both jev_overview and the boot-time
 * auto-guard setup (the guard silently stayed disarmed).
 */
export const __internal = {
  credentialNameOf,
  decisionPresentation,
  overviewPresentation,
  guardPresentation,
  verifyPresentation,
  toCredentialRef,
  resolveOptions,
  isVolatileRef,
  unwrapField,
  normalizeConfig,
  DEFAULT_API_KEY_ENV,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
};