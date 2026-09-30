/**
 * Jev option counsel — rank 2..10 candidate approaches with calibrated
 * System One scores (one parallel call per option: fit score + risk noul)
 * and return an honest ordering with a recommended pick.
 *
 * Jev explains nothing: these are feature scores, a fast tiebreaker for the
 * harness at multi-option decision forks. Final judgment stays with the agent.
 */
export function createCounselModule({ requestSystemOne }) {
  const MAX_OPTIONS = 10;
  const MIN_OPTIONS = 2;
  const MAX_OPTION_CHARS = 800;
  const MAX_CONTEXT_CHARS = 2000;

  const FIT_LEVELS = [
    "poor fit: likely to fail, misaligned with the user goal, or not viable",
    "fair fit: partial alignment with notable gaps or risks",
    "good fit: mostly aligned, minor gaps",
    "excellent fit: directly and efficiently advances the user goal",
  ];

  function validateOptions(args) {
    const raw = args.options;
    if (!Array.isArray(raw) || raw.length < MIN_OPTIONS || raw.length > MAX_OPTIONS) {
      throw new Error("jev_choose: options must be an array of " + MIN_OPTIONS + ".." + MAX_OPTIONS + " candidate option strings (got " + (Array.isArray(raw) ? raw.length : typeof raw) + ")");
    }
    const options = [];
    for (let i = 0; i < raw.length; i += 1) {
      const text = typeof raw[i] === "string" ? raw[i].trim() : "";
      if (text.length === 0) throw new Error("jev_choose: option " + i + " is empty");
      if (text.length > MAX_OPTION_CHARS) throw new Error("jev_choose: option " + i + " exceeds " + MAX_OPTION_CHARS + " chars (" + text.length + "); shorten it");
      options.push(text);
    }
    const context = typeof args.context === "string" ? args.context.trim().slice(0, MAX_CONTEXT_CHARS) : "";
    return { options, context };
  }

  function labelOf(text) {
    const first = text.split("\n").map((s) => s.trim()).find((s) => s.length > 0) ?? text;
    return first.length > 60 ? first.slice(0, 60) + "…" : first;
  }

  function stateFor(optionText, context) {
    return context.length > 0 ? context + "\n\nCandidate option:\n" + optionText : optionText;
  }

  async function rankOptions(args, callOptions) {
    const { options, context } = validateOptions(args);
    const model = typeof args.model === "string" && args.model.trim().length > 0 ? args.model : callOptions.model;
    const started = performance.now();
    // per-option calls are fully independent: fire them in parallel, not sequence
    const perOption = await Promise.all(options.map(async (text) => {
      const { body, latencyMs } = await requestSystemOne(callOptions, {
        state: stateFor(text, context),
        model,
        questions: {
          fit: { type: "score", instructions: "How well this candidate option advances the user goal and is efficient and sound to execute", criteria: FIT_LEVELS },
          risk: { type: "noul", instructions: "This option carries a high probability of failure, excessive cost, or harmful side effects" },
        },
      }, void 0);
      return { text, latencyMs, body };
    }));
    const latencyMs = Math.round(performance.now() - started);
    let inputTokens = 0;
    let outputTokens = 0;
    const ranking = [];
    for (let i = 0; i < perOption.length; i += 1) {
      const { text, latencyMs: perMs, body } = perOption[i];
      const fitAns = body?.answers?.fit;
      const riskAns = body?.answers?.risk;
      const fit = typeof fitAns?.score === "number" ? fitAns.score : null;
      const risk = typeof riskAns?.noul === "number" ? riskAns.noul : (fit === null ? null : 0.5);
      const confidence = typeof fitAns?.confidence === "number" ? fitAns.confidence : null;
      const composite = fit === null ? null : Math.round((fit / 3) * (1 - (risk ?? 0.5)) * 1000) / 1000;
      inputTokens += body?.usage?.input_tokens ?? 0;
      outputTokens += body?.usage?.output_tokens ?? 0;
      ranking.push({ index: i, label: labelOf(text), fit, risk: risk === null ? null : Math.round(risk * 1000) / 1000, composite, confidence, latencyMs: perMs });
    }
    const scored = ranking.filter((r) => r.composite !== null);
    scored.sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1) || (b.fit ?? -1) - (a.fit ?? -1));
    const recommended = scored.length > 0 ? scored[0].index : null;
    const pricePerMTok = typeof callOptions.inputPriceUsdPerMTok === "number" ? callOptions.inputPriceUsdPerMTok : 0.042;
    return {
      model,
      optionCount: options.length,
      contextHead: context.slice(0, 80),
      ranking,
      recommended,
      latencyMs,
      inputTokens,
      outputTokens,
      estimatedCostUs: (inputTokens * pricePerMTok) / 1e6,
      endpoint: String(callOptions.baseURL ?? "https://api.typesafe.ai/v1").replace(/\/+$/, "") + "/systemone",
    };
  }

  function formatChoose(value) {
    if (value === null || typeof value !== "object") return "jev_choose | 尚无结果（仍在运行或已失败）";
    const lines = [];
    lines.push("jev_choose | model=" + value.model + " | " + value.optionCount + " 个候选 | " + value.latencyMs + " ms | est. cost $" + value.estimatedCostUs.toFixed(7));
    for (const r of value.ranking) {
      const mark = r.index === value.recommended ? "推荐" : "    ";
      const fit = r.fit === null ? "—" : r.fit + "/3";
      const conf = r.confidence === null ? "—" : Math.round(r.confidence * 100) + "%";
      const riskTxt = r.risk == null ? "—" : Math.round(r.risk * 100) + "%";
      lines.push("- [" + mark + "] #" + r.index + " " + r.label + " — 契合 " + fit + " · 风险 " + riskTxt + " · 综合 " + (r.composite == null ? "—" : Math.round(r.composite * 100) + "%") + " · 置信 " + conf);
    }
    lines.push("推荐：" + (value.recommended == null ? "无（Jev 未能给出有效打分，请检查 API 响应）" : "#" + value.recommended));
    lines.push("> Jev 只做特征打分（System One），不解释理由；把得分当校准过的参考系，最终判断仍由你综合做出。");
    return lines.join("\n");
  }

  function choosePresentation(value) {
    // presentationMeta is also projected for running / failed / malformed calls.
    // It must never throw, and dsh persists the payload as JSON, so only defined
    // fields may appear (an undefined field would vanish on round-trip).
    const projected = { kind: "choose" };
    if (value === null || typeof value !== "object" || Array.isArray(value)) return projected;
    for (const key of ["model", "optionCount", "ranking", "recommended", "latencyMs", "estimatedCostUs"]) {
      if (value[key] !== undefined) projected[key] = value[key];
    }
    return projected;
  }

  return { rankOptions, formatChoose, choosePresentation, MAX_OPTIONS, MIN_OPTIONS };
}
