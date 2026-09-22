/**
 * Jev dashboard — local HTTP visualization for decision history, latency,
 * confidence and guard events.
 */
import { appendFileSync, readFileSync } from "node:fs";

const MAX_ROLL = 300;
const MAX_TRY_BYTES = 32768;
const PAGE = readFileSync(new URL("./dashboard-page.html", import.meta.url), "utf8");

export function createDashboardModule({ requestSystemOne }) {
  const roll = [];
  let ledgerFile = null;
  let active = false;

  function ledgerPath() {
    const home = globalThis.process?.env?.DSH_HOME;
    return typeof home === "string" && home.length > 0 ? home + "/jev-roll.jsonl" : null;
  }

  function record(entry) {
    if (!active) return;
    if (typeof entry !== "object" || entry === null) return;
    roll.push(entry);
    if (roll.length > MAX_ROLL) roll.shift();
    if (ledgerFile === null) ledgerFile = ledgerPath();
    if (ledgerFile !== null) {
      try {
        appendFileSync(ledgerFile, JSON.stringify(entry) + "\n");
      } catch {
        /* ledger write must never break decisions */
      }
    }
  }
  function summary(slice) {
    const decisions = slice.filter((e) => e.kind === "decision");
    const guards = slice.filter((e) => e.kind === "guard");
    const latencies = decisions.map((d) => d.latencyMs ?? 0).filter((v) => v > 0);
    const sorted = [...latencies].sort((a, b) => a - b);
    const confidences = [];
    const typeCounts = {};
    for (const d of decisions) {
      for (const q of d.questions ?? []) {
        typeCounts[q.type ?? "?"] = (typeCounts[q.type ?? "?"] ?? 0) + 1;
        if (typeof q.confidence === "number") confidences.push(q.confidence);
      }
    }
    return {
      calls: decisions.length,
      verifies: slice.filter((e) => e.kind === "verify").length,
      guardDenials: guards.filter((g) => g.action === "deny").length,
      guardAdvisories: guards.filter((g) => g.action === "advise").length,
      medianLatencyMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
      avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
      totalInputTokens: decisions.reduce((s, d) => s + (d.inputTokens ?? 0), 0),
      totalCostUs: decisions.reduce((s, d) => s + (d.costUs ?? 0), 0),
      typeCounts,
      avgConfidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
    };
  }

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(new Error("body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  function sendJson(response, status, value) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  }
  /** Register dashboard routes. options may be a thunk; extraStatus adds guard info. */
  function registerRoutes(host, config, options, extraStatus) {
    const dash = config.dashboard ?? {};
    if (dash.enabled === false) return;
    const base = typeof dash.basePath === "string" && dash.basePath.length > 0 ? dash.basePath.replace(/\/+$/, "") : "/jev";
    active = true;

    host.webServer.register({
      kind: "exact",
      path: base,
      handler: async (_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(PAGE);
      },
    });

    host.webServer.register({
      kind: "exact",
      path: base + "/api",
      handler: async (_request, response) => {
        const optsNow = typeof options === "function" ? options() : options;
        let keyConfigured = false;
        try {
          const key = optsNow.apiKey ?? (optsNow.resolveApiKey ? await optsNow.resolveApiKey() : void 0);
          keyConfigured = typeof key === "string" && key.length > 0;
        } catch {
          keyConfigured = false;
        }
        const extra = typeof extraStatus === "function" ? extraStatus() : {};
        sendJson(response, 200, {
          status: {
            model: optsNow.model,
            endpoint: String(optsNow.baseURL).replace(/\/+$/, "") + "/systemone",
            keyConfigured,
            guardActive: extra.guardActive === true || false,
            guardThreshold: extra.denyThreshold ?? null,
            budgetRemaining: extra.budgetRemaining ?? null,
            updatedAt: new Date().toISOString(),
          },
          summary: summary(roll),
          roll: roll.slice(-40).map((e) => (e.kind === "decision" ? { ...e, stateHead: String(e.stateHead ?? "").slice(0, 90) } : e)),
          guards: roll.filter((e) => e.kind === "guard").slice(-30),
          latencySeries: roll.filter((e) => e.kind === "decision").slice(-60).map((e) => e.latencyMs ?? 0),
        });
      },
    });

    host.webServer.register({
      kind: "exact",
      path: base + "/api/try",
      handler: async (request, response) => {
        if (request.method !== "POST") {
          response.writeHead(405, { allow: "POST" });
          response.end();
          return;
        }
        let body;
        try {
          body = JSON.parse(await readBody(request, MAX_TRY_BYTES));
        } catch {
          sendJson(response, 400, { error: "invalid JSON body (max 32KB)" });
          return;
        }
        const questions = Array.isArray(body.questions) ? body.questions : [];
        const questionsOk = questions.length > 0 && questions.length <= 25 &&
          questions.every((q) => q && typeof q === "object" && typeof q.name === "string" && typeof q.type === "string");
        if (typeof body.state !== "string" || body.state.length === 0 || !questionsOk) {
          sendJson(response, 400, { error: "state:string and questions:array(1-25) of {name,type,instructions,criteria?} required" });
          return;
        }
        const optsNow = typeof options === "function" ? options() : options;
        let resolved;
        try {
          resolved = await requestSystemOne(
            optsNow,
            {
              state: body.state,
              model: typeof body.model === "string" && body.model.length > 0 ? body.model : optsNow.model,
              questions: Object.fromEntries(questions.map((q, i) => [String(i), q])),
            },
            void 0,
          );
        } catch (error) {
          sendJson(response, 502, { error: String(error?.message ?? error) });
          return;
        }
        const answers = {};
        const qMeta = [];
        for (const [qKey, q] of Object.entries(questions)) {
          const answer = resolved.body?.answers?.[qKey] ?? null;
          answers[q.name] = answer;
          qMeta.push({
            name: q.name,
            type: q.type ?? "noul",
            value: answer?.noul ?? answer?.choice ?? answer?.score ?? null,
            confidence: answer?.confidence ?? null,
          });
        }
        const costUs = ((resolved.body?.usage?.input_tokens ?? 0) * 0.042) / 1e6;
        record({
          kind: "decision",
          ts: new Date().toISOString(),
          source: "playground",
          stateHead: String(body.state).slice(0, 120),
          questions: qMeta,
          latencyMs: resolved.latencyMs,
          costUs,
          inputTokens: resolved.body?.usage?.input_tokens ?? 0,
        });
        sendJson(response, 200, {
          model: resolved.body?.model ?? optsNow.model,
          latencyMs: resolved.latencyMs,
          costUs,
          answers,
          usage: resolved.body?.usage ?? {},
        });
      },
    });
  }

  return { record, registerRoutes, summary, roll };
}
