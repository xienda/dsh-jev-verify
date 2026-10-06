/**
 * Jev dashboard — local HTTP visualization for decision history, latency,
 * confidence and guard events.
 */
import { appendFileSync, readFileSync } from "node:fs";

const MAX_ROLL = 300;
const MAX_TRY_BYTES = 32768;
const PAGE = readFileSync(new URL("./dashboard-page.html", import.meta.url), "utf8");

/** Default mount path. */
const DEFAULT_BASE_PATH = "/jev";
/** Fixed mount for the composer-pill read-only JSON route (0.8.2). */
export const PILL_ROUTE = "/jev/api/usage";

/**
 * Normalize a configured mount path.
 * 0.8.2: a bare "jev" (no leading slash) used to mount the literal path
 * "jev", which no request can ever match — the user saw a browser 404
 * with `dashboard.basePath: jev` saved in settings.yaml.
 */
export function normalizeBasePath(value) {
  const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : DEFAULT_BASE_PATH;
  const withLead = raw.startsWith("/") ? raw : "/" + raw;
  const trimmed = withLead.replace(/[/]+$/, "");
  return trimmed.length > 0 ? trimmed : DEFAULT_BASE_PATH;
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  const n = num(value);
  return "$" + (n >= 0.01 ? n.toFixed(4) : n.toFixed(6));
}

function untilReset(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const mins = Math.round(n / 60000);
  return mins < 60 ? mins + " 分钟" : Math.floor(mins / 60) + " 小时 " + (mins % 60) + " 分";
}

/**
 * Served at the mount path while `dashboard.enabled` is false: a small live
 * status page instead of a 404, pointing at the always-on composer pill.
 */
function statusPage(snap) {
  const q = (snap && snap.quota) || {};
  const used = q.used || {};
  const lim = q.limits || {};
  const pc = q.percent || {};
  const today = (snap && snap.windows && snap.windows.today) || {};
  const rows = [
    ["今日调用", num(used.dailyCalls) + (lim.dailyCalls == null ? " 次（未设上限）" : " / " + num(lim.dailyCalls) + " 次") + (pc.dailyCalls == null ? "" : " · " + Math.round(num(pc.dailyCalls)) + "%")],
    ["今日成本", money(used.dailyCostUsd) + (lim.dailyCostUsd == null ? "（未设上限）" : " / $" + num(lim.dailyCostUsd).toFixed(2))],
    ["本插件实例", num(used.sessionCalls) + " 次" + (lim.sessionCalls == null ? "" : " / " + num(lim.sessionCalls) + " 次")],
    ["今日 tokens", num(today.inputTokens) + " 输入 · " + num(today.outputTokens) + " 输出"],
    ["额度状态", String(q.status ?? "ok") + " · 至本日重置 " + untilReset(q.resetInMs)],
  ];
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<title>Jev 本机用量</title><style>",
    ":root{color-scheme:light dark}body{padding:32px;font:14px/1.7 system-ui,-apple-system,sans-serif;",
    "background:#fdfdfd;color:#1b1d20;max-width:640px;margin:0 auto}h1{font-size:20px;margin:0 0 4px;font-weight:600}",
    "p.sub{margin:0 0 20px;color:#6b7280}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}",
    "td{padding:7px 0;border-bottom:1px solid #e5e7eb;vertical-align:top}td.k{color:#6b7280;width:112px}",
    "code{background:#f3f4f6;padding:1px 5px;border-radius:5px}footer{margin-top:20px;color:#6b7280;font-size:12px;line-height:1.7}",
    "@media (prefers-color-scheme:dark){body{background:#0f1115;color:#e6e8eb}p.sub,td.k,footer{color:#9aa4b2}td{border-bottom-color:#272b31}code{background:#1c2027}}",
    "</style></head><body>",
    "<h1>Jev 本机用量</h1>",
    '<p class="sub">轻量面板在对话输入框右侧的胶囊里（<code>Jev · 今日 N 次</code>），打开任意会话即可看到。</p>',
    "<table>",
    ...rows.map(([k, v]) => '<tr><td class="k">' + esc(k) + "</td><td>" + esc(v) + "</td></tr>"),
    "</table>",
    '<footer>本页就是看板挂载路径：完整看板（决策历史、时延曲线、护栏事件、判定演练场）需要在插件设置里打开 <code>dashboard.enabled</code>，也可用 <code>jev_overview</code> / <code>jev_usage</code> 工具在对话内查看。',
    "面板只报告本机实测用量与本地自设额度；TypeSafe 没有余额接口，这不代表账户余额。</footer>",
    "</body></html>",
  ].join("");
}

export function createDashboardModule({ requestSystemOne, inputPriceUsdPerMTok = 0.042 }) {
  const roll = [];
  let ledgerFile = null;
  /** HTTP routes are mounted (dashboard.enabled). */
  let active = false;
  /** JSONL persistence is on (implied by active). */
  let ledgerOn = false;

  function ledgerPath() {
    const home = globalThis.process?.env?.DSH_HOME;
    return typeof home === "string" && home.length > 0 ? home + "/jev-roll.jsonl" : null;
  }

  function record(entry) {
    if (typeof entry !== "object" || entry === null) return;
    // The in-memory ring ALWAYS records, so jev_overview (and the guard view)
    // stay truthful even when the /jev web page is disabled — dashboard.enabled
    // defaults to false. Only JSONL persistence needs the opt-in.
    roll.push(entry);
    if (roll.length > MAX_ROLL) roll.shift();
    if (!ledgerOn) return;
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
    const decisions = slice.filter((e) => e.kind === "decision" || e.kind === "choose");
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

  /** Compact, JSON-safe projection for the composer pill (0.8.2). */
  function pillPayload(extraStatus) {
    const extra = typeof extraStatus === "function" ? extraStatus() : (extraStatus || {});
    const snap = extra && extra.usage;
    if (!snap || typeof snap !== "object" || snap.error) {
      return {
        kind: "jev-usage-pill",
        ok: false,
        asOf: new Date().toISOString(),
        error: String((snap && snap.error) || "usage unavailable"),
      };
    }
    const q = snap.quota ?? {};
    const today = snap.windows?.today ?? {};
    const session = snap.windows?.session ?? null;
    return {
      kind: "jev-usage-pill",
      ok: true,
      asOf: snap.asOf ?? new Date().toISOString(),
      status: q.status ?? "ok",
      enabled: q.enabled !== false,
      enforce: q.enforce === true,
      warnAtPercent: q.warnAtPercent ?? 80,
      resetInMs: q.resetInMs ?? null,
      limits: q.limits ?? {},
      used: q.used ?? {},
      percent: q.percent ?? {},
      projection: q.projection ?? null,
      today: {
        calls: today.calls ?? 0,
        costUs: today.costUs ?? 0,
        inputTokens: today.inputTokens ?? 0,
        outputTokens: today.outputTokens ?? 0,
        medianLatencyMs: today.medianLatencyMs ?? null,
        p95LatencyMs: today.p95LatencyMs ?? null,
        guards: today.guards ?? { denied: 0, advised: 0 },
      },
      byTool: today.byTool ?? {},
      session: session ? { calls: session.calls ?? 0, since: session.since ?? null } : null,
      guard: snap.guard ?? null,
      history: (snap.history ?? []).map((h) => ({ day: h.day, calls: h.calls })),
      provider: snap.provider ?? null,
      priceUsdPerMTok: snap.priceUsdPerMTok ?? null,
      persistence: snap.persistence ?? null,
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
  /** Register web routes. options may be a thunk; extraStatus adds guard/usage. */
  function registerRoutes(host, config, options, extraStatus) {
    const dash = (config && config.dashboard) || {};
    const base = normalizeBasePath(dash.basePath);
    const enabled = dash.enabled === true;
    if (enabled) {
      active = true;
      ledgerOn = true;
    }

    // 0.8.2: the mount path ALWAYS answers. With the dashboard off this is a
    // small live status page (and a pointer at the composer pill) instead of
    // the browser 404 a disabled route used to produce.
    const usageNow = () => {
      try {
        const extra = typeof extraStatus === "function" ? extraStatus() : extraStatus;
        return extra && extra.usage ? extra.usage : null;
      } catch {
        return null;
      }
    };
    const pagePaths = base === "/" ? [base] : [base, base + "/"];
    for (const path of pagePaths) {
      host.webServer.register({
        kind: "exact",
        path,
        handler: async (_request, response) => {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
          response.end(enabled ? PAGE : statusPage(usageNow()));
        },
      });
    }

    // 0.8.2: the composer pill reads this. It is registered even while
    // dashboard.enabled is false, because the pill is the surface that is
    // always on; quota.enabled === false is what turns its numbers off.
    const usagePaths = base + "/api/usage" === PILL_ROUTE ? [PILL_ROUTE] : [PILL_ROUTE, base + "/api/usage"];
    for (const path of usagePaths) {
      host.webServer.register({
        kind: "exact",
        path,
        handler: async (_request, response) => {
          try {
            sendJson(response, 200, pillPayload(extraStatus));
          } catch (error) {
            sendJson(response, 200, { kind: "jev-usage-pill", ok: false, asOf: new Date().toISOString(), error: String(error?.message ?? error) });
          }
        },
      });
    }

    // Everything below is the FULL dashboard: explicit opt-in only.
    if (!enabled) return;

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
          // 0.8.0: the usage/quota panel rides along with the roll so the web
          // page and jev_usage tool can never disagree about the numbers.
          usage: extra && extra.usage ? extra.usage : null,
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
        const costUs = ((resolved.body?.usage?.input_tokens ?? 0) * inputPriceUsdPerMTok) / 1e6;
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

  return { record, registerRoutes, summary, roll, pillPayload };
}
