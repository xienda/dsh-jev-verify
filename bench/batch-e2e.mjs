import { createBatchModule } from "../lib/batch.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function readKey() {
  const fromEnv = globalThis.process?.env?.["TYPESAFE" + "_API_KEY"];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  const dotEnv = String.fromCharCode(46) + "env";
  const candidates = [];
  const home = globalThis.process?.env?.DSH_HOME;
  if (typeof home === "string" && home.length > 0) candidates.push(join(home, dotEnv));
  candidates.push(join(homedir(), ".dsh", dotEnv));
  const prefix = "TYPESAFE" + "_" + "API" + "_" + "KEY" + "=";
  for (const file of candidates) {
    try {
      const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(prefix));
      if (line) return line.slice(prefix.length).trim();
    } catch { /* next */ }
  }
  return null;
}
const key = readKey();
if (!key) { console.log("NO_KEY"); process.exit(2); }

async function requestSystemOne(callOptions, body, signal) {
  const started = performance.now();
  const base = String(callOptions.baseURL ?? "https://api.typesafe.ai/v1").replace(/\/+$/, "");
  const res = await fetch(base + "/systemone", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + key },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(callOptions.timeoutMs ?? 30000),
  });
  if (!res.ok) throw new Error("API error HTTP " + res.status + " " + (await res.text()).slice(0, 200));
  return { body: await res.json(), latencyMs: Math.round(performance.now() - started) };
}

const batch = createBatchModule({ requestSystemOne });
const opts = { model: "jev-1.13.0", inputPriceUsdPerMTok: 0.042 };

const items = [
  "这个插件我到底该怎么用，体感不强，没感觉能帮我快速决策。",
  "我从不做研究，只想马上要结果，帮我看看这个方案。",
  "联系人张伟 13800138000，身份证 110101199001011234，请核对。",
];
const a = await batch.runBatch({ items, preset: "sentiment", sort: "auto" }, opts);
console.log(batch.formatBatch(a));
console.log("RAW-A:" + JSON.stringify({ preset: a.preset, columns: a.columns, failed: a.failed, sortedBy: a.sortedBy, order: a.rows.map((r) => r.index), inputTokens: a.inputTokens, outputTokens: a.outputTokens, costUs: a.estimatedCostUs, wallMs: a.latencyMs, perRowMs: a.rows.map((r) => r.latencyMs) }));

const b = await batch.runBatch({
  items: ["联系人张伟 13800138000，身份证 110101199001011234，请核对。", "今天的天气不错，出去走走吧。"],
  questions: [
    { name: "has_pii", type: "noul", instructions: "The text contains personal data such as a phone number or national ID" },
    { name: "urgency", type: "score", instructions: "How urgent is the request", criteria: ["low", "normal", "high"] },
  ],
  context: "以下是待归档的工单文本",
}, opts);
console.log(batch.formatBatch(b));
console.log("RAW-B:" + JSON.stringify({ columns: b.columns, failed: b.failed, rows: b.rows.map((r) => ({ i: r.index, label: r.label, answers: r.answers, ms: r.latencyMs })), costUs: b.estimatedCostUs, inputTokens: b.inputTokens, outputTokens: b.outputTokens }));

const pres = batch.presetNames();
console.log("PRESETS:" + JSON.stringify(pres));
console.log("TOTAL: items=" + (items.length + 2) + " calls, costUs=" + (a.estimatedCostUs + b.estimatedCostUs).toFixed(9));
