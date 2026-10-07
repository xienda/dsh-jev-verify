/**
 * Jev batch — one high-level "judge + organize" tool: run the SAME 1..5 typed
 * questions against 1..20 text items (one real System One call per item, in a
 * bounded parallel pool) and return a paste-ready markdown table.
 *
 * Why this exists: jev_decision judges ONE state string, so labeling a list of
 * tickets / comments / log lines / rows meant the harness hand-rolling one call
 * per item and formatting the table itself — which almost never happened. This
 * tool is the single entry point for that job: give it the items, say what to
 * judge (or name a preset), and get the table back.
 *
 * Nothing here is fabricated: every row is one real response, a failed row is
 * reported as a failed row (never guessed), and the cost is the sum of the
 * measured token usage of the calls that actually happened.
 */
export function createBatchModule({ requestSystemOne, inputPriceUsdPerMTok = 0.042 }) {
  const MAX_ITEMS = 20;
  const MAX_QUESTIONS = 5;
  const MAX_ITEM_CHARS = 2000;
  const MAX_CONTEXT_CHARS = 1000;
  const MAX_CONCURRENCY = 6;
  const DEFAULT_CONCURRENCY = 4;
  const LABEL_CHARS = 40;
  const NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

  /** Common one-question jobs, so the tool is usable without writing criteria. */
  const PRESETS = {
    sentiment: [
      {
        name: "sentiment",
        type: "score",
        instructions: "The sentiment this text expresses toward its subject, from very negative to very positive",
        criteria: ["very negative", "negative", "neutral", "positive", "very positive"],
      },
    ],
    priority: [
      {
        name: "priority",
        type: "score",
        instructions: "How urgently a human should act on this item",
        criteria: [
          "P3 low - can wait indefinitely",
          "P2 normal - handle this week",
          "P1 high - handle today",
          "P0 urgent - blocks work or money right now",
        ],
      },
    ],
    intent: [
      {
        name: "intent",
        type: "choice",
        instructions: "The single intent this text expresses",
        criteria: {
          question: "is asking for information",
          request: "is asking for an action to be performed",
          report: "is reporting a result or status",
          problem: "is reporting a problem or dissatisfaction",
          chat: "is social or off-topic conversation",
        },
      },
    ],
    pii: [
      { name: "has_personal_data", type: "noul", instructions: "The text contains personal data (a real name, phone, address, email, ID number or bank detail)" },
      { name: "has_secret", type: "noul", instructions: "The text contains a credential or secret (password, API key, access token)" },
    ],
    spam: [
      { name: "is_spam", type: "noul", instructions: "The text is spam, promotional, or unsolicited bulk content" },
    ],
  };

  function presetNames() {
    return Object.keys(PRESETS);
  }

  /** Validate user-supplied question specs and build the wire-level questions map. */
  function buildQuestions(specs, maxQuestions, label) {
    if (!Array.isArray(specs) || specs.length === 0) {
      throw new Error(label + ": questions must be a non-empty array of {name, type, instructions, criteria?}");
    }
    if (specs.length > maxQuestions) {
      throw new Error(label + ": at most " + maxQuestions + " questions per batch (got " + specs.length + "); ask fewer questions or split the work");
    }
    const seen = new Set();
    const wire = {};
    const meta = [];
    for (const q of specs) {
      if (!q || typeof q !== "object") throw new Error(label + ": every question must be an object");
      if (!NAME_RE.test(q.name ?? "")) {
        throw new Error(label + ": question name " + JSON.stringify(q.name) + " must match ^[A-Za-z_][A-Za-z0-9_-]{0,63}$");
      }
      if (seen.has(q.name)) throw new Error(label + ": duplicate question name " + JSON.stringify(q.name));
      seen.add(q.name);
      if (typeof q.instructions !== "string" || q.instructions.trim().length === 0) {
        throw new Error(label + ": question " + JSON.stringify(q.name) + " needs instructions (one specific, well-scoped judgment)");
      }
      if (q.type === "noul") {
        wire[q.name] = { type: "noul", instructions: q.instructions };
        meta.push({ name: q.name, type: "noul", top: null });
        continue;
      }
      if (q.type === "choice") {
        const criteria = q.criteria;
        if (!criteria || typeof criteria !== "object" || Array.isArray(criteria) || Object.keys(criteria).length < 2) {
          throw new Error(label + ": question " + JSON.stringify(q.name) + " of type choice needs an object criteria with >=2 options (option key -> description)");
        }
        wire[q.name] = { type: "choice", instructions: q.instructions, criteria };
        meta.push({ name: q.name, type: "choice", top: null });
        continue;
      }
      if (q.type === "score") {
        const criteria = q.criteria;
        if (!Array.isArray(criteria) || criteria.length < 2 || !criteria.every((level) => typeof level === "string")) {
          throw new Error(label + ": question " + JSON.stringify(q.name) + " of type score needs an array criteria with >=2 ordered level descriptions");
        }
        wire[q.name] = { type: "score", instructions: q.instructions, criteria };
        meta.push({ name: q.name, type: "score", top: criteria.length - 1 });
        continue;
      }
      throw new Error(label + ": question " + JSON.stringify(q.name) + " has unsupported type " + JSON.stringify(q.type) + " (expected choice | score | noul)");
    }
    return { wire, meta };
  }

  function labelOf(text) {
    const first = String(text).split("\n").map((s) => s.trim()).find((s) => s.length > 0) ?? String(text);
    const flat = first.replace(/\s+/g, " ").trim();
    return flat.length > LABEL_CHARS ? flat.slice(0, LABEL_CHARS) + "…" : flat;
  }

  function validate(args, maxItems) {
    const label = "jev_batch";
    const raw = args.items;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(label + ": items must be a non-empty array of strings (got " + (Array.isArray(raw) ? "0" : typeof raw) + ")");
    }
    if (raw.length > maxItems) {
      throw new Error(label + ": at most " + maxItems + " items per call (got " + raw.length + "); split into batches");
    }
    const items = [];
    for (let i = 0; i < raw.length; i += 1) {
      const text = typeof raw[i] === "string" ? raw[i].trim() : "";
      if (text.length === 0) throw new Error(label + ": item " + i + " is empty");
      if (text.length > MAX_ITEM_CHARS) throw new Error(label + ": item " + i + " exceeds " + MAX_ITEM_CHARS + " chars (" + text.length + "); shorten it");
      items.push(text);
    }
    const hasQuestions = Array.isArray(args.questions) && args.questions.length > 0;
    const preset = typeof args.preset === "string" ? args.preset.trim() : "";
    if (hasQuestions && preset.length > 0) {
      throw new Error(label + ": pass either questions or preset, not both (preset " + preset + " was ignored) ");
    }
    let spec = null;
    if (hasQuestions) spec = args.questions;
    else if (preset.length > 0) {
      if (!Array.isArray(PRESETS[preset])) {
        throw new Error(label + ": unknown preset " + JSON.stringify(preset) + " (available: " + presetNames().join(", ") + ")");
      }
      spec = PRESETS[preset];
    } else {
      throw new Error(label + ": pass questions (what to judge) or preset (" + presetNames().join(" | ") + ")");
    }
    const { wire, meta } = buildQuestions(spec, MAX_QUESTIONS, label);
    const context = typeof args.context === "string" ? args.context.trim().slice(0, MAX_CONTEXT_CHARS) : "";
    const rawConcurrency = Number(args.concurrency);
    const concurrency = Number.isFinite(rawConcurrency) && rawConcurrency >= 1
      ? Math.min(Math.floor(rawConcurrency), MAX_CONCURRENCY)
      : DEFAULT_CONCURRENCY;
    const sortOptions = ["auto", "desc", "asc", "none"];
    const sort = typeof args.sort === "string" && sortOptions.includes(args.sort) ? args.sort : "auto";
    const sortBy = typeof args.sortBy === "string" && args.sortBy.trim().length > 0 ? args.sortBy.trim() : null;
    if (sortBy !== null && !meta.some((m) => m.name === sortBy)) {
      throw new Error(label + ": sortBy " + JSON.stringify(sortBy) + " is not one of the questions (" + meta.map((m) => m.name).join(", ") + ")");
    }
    return { items, context, concurrency, sort, sortBy, meta, wire, preset: preset.length > 0 ? preset : null };
  }

  /** One row of answers (or the explicit per-row error) for one item. */
  function answersOf(body, meta) {
    const out = {};
    for (const m of meta) {
      const answer = body?.answers?.[m.name];
      const value = answer?.noul ?? answer?.choice ?? answer?.score ?? null;
      out[m.name] = {
        type: m.type,
        top: m.top,
        value: typeof value === "string" || typeof value === "number" ? value : null,
        confidence: typeof answer?.confidence === "number" ? answer.confidence : null,
        probabilities: answer?.probabilities ?? null,
      };
    }
    return out;
  }

  function sortValue(row, name) {
    const answer = row.answers?.[name];
    if (!answer) return null;
    return typeof answer.value === "number" ? answer.value : null;
  }

  async function runBatch(args, callOptions) {
    const signal = callOptions?.signal;
    const { items, context, concurrency, sort, sortBy, meta, wire, preset } = validate(args, MAX_ITEMS);
    const model = typeof args.model === "string" && args.model.trim().length > 0 ? args.model : callOptions.model;
    const stateFor = (item) => (context.length > 0 ? context + "\n\nItem:\n" + item : item);
    const rows = new Array(items.length);
    let cursor = 0;
    const started = performance.now();
    const workerCount = Math.min(concurrency, items.length);
    const workers = [];
    for (let w = 0; w < workerCount; w += 1) {
      workers.push((async () => {
        for (;;) {
          const i = cursor;
          cursor += 1;
          if (i >= items.length) return;
          try {
            const { body, latencyMs } = await requestSystemOne(callOptions, { state: stateFor(items[i]), model, questions: wire }, signal);
            rows[i] = {
              index: i,
              label: labelOf(items[i]),
              latencyMs,
              inputTokens: body?.usage?.input_tokens ?? 0,
              outputTokens: body?.usage?.output_tokens ?? 0,
              answers: answersOf(body, meta),
              error: null,
            };
          } catch (error) {
            rows[i] = {
              index: i,
              label: labelOf(items[i]),
              latencyMs: null,
              inputTokens: 0,
              outputTokens: 0,
              answers: null,
              error: String(error?.message ?? error),
            };
          }
        }
      })());
    }
    await Promise.all(workers);
    const wallMs = Math.round(performance.now() - started);
    const failed = rows.filter((r) => r.error !== null).length;
    if (failed === rows.length && rows.length > 0) throw new Error(rows[0].error);
    let inputTokens = 0;
    let outputTokens = 0;
    for (const row of rows) {
      inputTokens += row.inputTokens;
      outputTokens += row.outputTokens;
    }
    // Sorting is OPTIONAL and only ever applies to a numeric answer (score or
    // noul). A failed row has no score and is always pushed to the end.
    let activeSort = "none";
    let activeSortBy = null;
    if (sort !== "none") {
      const candidate = sortBy ?? (meta.filter((m) => m.type === "score").length === 1 && meta.length === 1 ? meta[0].name : null);
      if (candidate !== null && (sort === "desc" || sort === "asc" || sort === "auto")) {
        activeSortBy = candidate;
        activeSort = sort === "auto" ? "desc" : sort;
      }
    }
    let ordered = rows;
    if (activeSortBy !== null) {
      const dir = activeSort === "asc" ? 1 : -1;
      ordered = rows.slice().sort((a, b) => {
        const av = sortValue(a, activeSortBy);
        const bv = sortValue(b, activeSortBy);
        if (av === null && bv === null) return a.index - b.index;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av - bv) * dir || a.index - b.index;
      });
    }
    return {
      model,
      itemCount: items.length,
      questionCount: meta.length,
      preset,
      columns: meta,
      rows: ordered,
      failed,
      sortedBy: activeSortBy,
      sortDirection: activeSortBy === null ? null : activeSort,
      latencyMs: wallMs,
      inputTokens,
      outputTokens,
      estimatedCostUs: (inputTokens * inputPriceUsdPerMTok) / 1e6,
      endpoint: String(callOptions.baseURL ?? "https://api.typesafe.ai/v1").replace(/\/+$/, "") + "/systemone",
    };
  }

  function cellOf(answer) {
    if (!answer || answer.value === null) return "—";
    if (answer.type === "noul") return Math.round(answer.value * 100) + "%";
    const conf = typeof answer.confidence === "number" ? " (" + Math.round(answer.confidence * 100) + "%)" : "";
    if (answer.type === "score") return answer.value + "/" + answer.top + conf;
    return String(answer.value) + conf;
  }

  function formatBatch(value) {
    if (!value || typeof value !== "object") return "jev_batch | 尚无结果（仍在运行或已失败）";
    const lines = [];
    lines.push("jev_batch | model=" + value.model + " | " + value.itemCount + " 条 x " + value.questionCount + " 问 | " + value.latencyMs + " ms | est. cost $" + value.estimatedCostUs.toFixed(7) + (value.failed > 0 ? " | " + value.failed + " 条失败" : ""));
    const names = value.columns.map((c) => c.name);
    lines.push("| # | 文本 | " + value.columns.map((c) => c.name + " (" + c.type + ")").join(" | ") + " | ms |");
    lines.push("| --- | --- | " + value.columns.map(() => "---").join(" | ") + " | --- |");
    for (const row of value.rows) {
      const label = String(row.label).replace(/\|/g, "\\|");
      if (row.error !== null) {
        lines.push("| " + row.index + " | " + label + " | " + value.columns.map(() => "失败").join(" | ") + " | — |");
        continue;
      }
      lines.push("| " + row.index + " | " + label + " | " + names.map((n) => cellOf(row.answers?.[n])).join(" | ") + " | " + (row.latencyMs ?? "—") + " |");
    }
    if (value.sortedBy !== null) {
      lines.push("排序：按 " + value.sortedBy + " " + (value.sortDirection === "asc" ? "升序" : "降序") + "（失败行置后）");
    }
    for (const row of value.rows) {
      if (row.error !== null) lines.push("失败 #" + row.index + " " + row.label + " — " + String(row.error).slice(0, 200));
    }
    lines.push("usage: " + value.inputTokens + " input tokens, " + value.outputTokens + " output tokens（每行一次真实调用，共 " + value.itemCount + " 次）");
    return lines.join("\n");
  }

  /** Lossless-JSON projection for the client card (kind: "batch"). */
  function batchPresentation(value) {
    const v = value && typeof value === "object" ? value : {};
    const names = Array.isArray(v.columns) ? v.columns.map((c) => c.name) : [];
    const rows = Array.isArray(v.rows) ? v.rows.map((row) => ({
      index: row?.index ?? null,
      label: String(row?.label ?? ""),
      cells: names.map((n) => (row?.error !== null && row?.error !== void 0 ? "失败" : cellOf(row?.answers?.[n]))),
      latencyMs: typeof row?.latencyMs === "number" ? row.latencyMs : null,
      error: typeof row?.error === "string" ? String(row.error).slice(0, 200) : null,
    })) : [];
    return {
      kind: "batch",
      model: v.model ?? null,
      itemCount: v.itemCount ?? rows.length,
      questionCount: v.questionCount ?? names.length,
      columns: Array.isArray(v.columns) ? v.columns.map((c) => ({ name: c.name, type: c.type })) : [],
      rows,
      failed: v.failed ?? rows.filter((r) => r.error !== null).length,
      latencyMs: typeof v.latencyMs === "number" ? v.latencyMs : null,
      estimatedCostUs: typeof v.estimatedCostUs === "number" ? v.estimatedCostUs : null,
      inputTokens: v.inputTokens ?? 0,
      outputTokens: v.outputTokens ?? 0,
      endpoint: v.endpoint ?? null,
    };
  }

  return { MAX_ITEMS, MAX_QUESTIONS, MAX_CONCURRENCY, PRESETS, presetNames, runBatch, formatBatch, batchPresentation, cellOf, labelOf };
}
