#!/usr/bin/env node
/**
 * dsh-jev-verify standalone benchmark CLI.
 *
 * Runs the built-in labeled verification cases (lib/cases.js) against the LIVE
 * TypeSafe System One API and prints measured accuracy / latency / cost.
 * Mirrors the jev_verify agent tool, and is dependency-free so anyone can
 * reproduce the published numbers with any TypeSafe API key.
 *
 * Usage:
 *   TYPESAFE_API_KEY=... node bench/bench.mjs [--model jev-latest] [--base-url https://api.typesafe.ai/v1] [--repeat 1] [--json]
 *
 * Output: human table on stdout; full JSON at bench/results/<timestamp>.json
 * (unless --no-save).
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERIFY_CASES } from "../lib/cases.js";

const here = dirname(fileURLToPath(import.meta.url));
const INPUT_PRICE_USD_PER_MTok = 0.042;
const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
const DEFAULT_MODEL = "jev-latest";

function parseArgs(argv) {
  const opts = { model: process.env.TYPESAFE_MODEL || DEFAULT_MODEL, baseURL: process.env.TYPESAFE_BASE_URL || DEFAULT_BASE_URL, repeat: 1, save: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--model") opts.model = argv[++i];
    else if (arg === "--base-url") opts.baseURL = argv[++i];
    else if (arg === "--repeat") opts.repeat = Number(argv[++i]);
    else if (arg === "--json") opts.json = true;
    else if (arg === "--no-save") opts.save = false;
    else if (arg === "--help") { opts.help = true; }
    else { console.error("unknown option:", arg); process.exit(2); }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log("Usage: TYPESAFE_API_KEY=... node bench/bench.mjs [--model jev-latest] [--base-url URL] [--repeat N] [--json] [--no-save]");
  process.exit(0);
}

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey || apiKey.length === 0) {
  console.error("bench: no TYPESAFE_API_KEY in the environment. Get one at https://console.typesafe.ai/keys (free tier).");
  process.exit(1);
}

const endpoint = `${opts.baseURL.replace(/\/+$/, "")}/systemone`;

async function callCase(testCase) {
  const questions = {};
  for (const q of testCase.questions) {
    questions[q.key] = q.criteria !== undefined
      ? { type: q.type, instructions: q.instructions, criteria: q.criteria }
      : { type: q.type, instructions: q.instructions };
  }
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
        "user-agent": "dsh-jev-verify-bench/0.1.0",
      },
      body: JSON.stringify({ state: testCase.state, model: opts.model, questions }),
    });
  } catch (error) {
    return { error: String(error) };
  }
  const raw = await response.text();
  const latencyMs = Math.round(performance.now() - started);
  if (!response.ok) {
    return { error: `HTTP ${response.status}: ${raw.slice(0, 300)}` };
  }
  let body;
  try { body = JSON.parse(raw); } catch { return { error: `unprocessable body: ${raw.slice(0, 300)}` }; }
  return { body, latencyMs };
}

function grade(testCase, body) {
  const rows = [];
  for (const q of testCase.questions) {
    const answer = body?.answers?.[q.key];
    let ok = false;
    let actual = null;
    if (answer !== undefined) {
      if (q.type === "noul") { actual = answer.noul; ok = q.expected ? actual >= 0.5 : actual < 0.5; }
      else if (q.type === "choice") { actual = answer.choice; ok = actual === q.expected; }
      else if (q.type === "score") { actual = answer.score; ok = actual === q.expected; }
    }
    rows.push({ caseId: testCase.id, question: q.key, type: q.type, expected: q.expected, actual, ok, confidence: answer?.confidence ?? null, noul: answer?.noul ?? null });
  }
  return rows;
}

const startedAll = performance.now();
const rows = [];
const latencies = [];
let inputTokens = 0;
let outputTokens = 0;
let failures = 0;

for (let rep = 0; rep < opts.repeat; rep += 1) {
  for (const testCase of VERIFY_CASES) {
    const result = await callCase(testCase);
    if (result.error) {
      failures += 1;
      console.error(`case ${testCase.id} FAILED: ${result.error}`);
      continue;
    }
    latencies.push(result.latencyMs);
    inputTokens += result.body?.usage?.input_tokens ?? 0;
    outputTokens += result.body?.usage?.output_tokens ?? 0;
    rows.push(...grade(testCase, result.body));
  }
}

const total = rows.length;
const correct = rows.filter((r) => r.ok).length;
const accuracy = total > 0 ? correct / total : 0;
const sorted = [...latencies].sort((a, b) => a - b);
const stats = {
  count: sorted.length,
  medianMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
  p95Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : null,
  minMs: sorted.length ? sorted[0] : null,
  maxMs: sorted.length ? sorted[sorted.length - 1] : null,
};
const estimatedUsd = (inputTokens * INPUT_PRICE_USD_PER_MTok) / 1e6;
const wallMs = Math.round(performance.now() - startedAll);

const report = {
  schema: "dsh-jev-verify/bench/v1",
  ranAt: new Date().toISOString(),
  model: opts.model,
  endpoint,
  repeat: opts.repeat,
  caseCount: VERIFY_CASES.length,
  questionCount: total,
  correct,
  accuracy,
  latency: stats,
  cost: { totalInputTokens: inputTokens, totalOutputTokens: outputTokens, estimatedUsd },
  wallMs,
  failures,
  rows,
};

if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("dsh-jev-verify bench — model " + opts.model + " @ " + report.ranAt);
  console.log("endpoint: " + endpoint);
  console.log("");
  console.log("case/question".padEnd(38) + " type      expected        actual          ok   conf");
  console.log("-".repeat(100));
  for (const r of rows) {
    const actual = r.type === "noul" ? String(r.noul ?? r.actual) : String(r.actual ?? "");
    const conf = r.confidence != null ? String(r.confidence) : "";
    console.log(`${r.caseId}/${r.question}`.padEnd(38) + ` ${r.type.padEnd(7)}` + ` ${String(r.expected).padEnd(15)}` + ` ${actual.padEnd(15)}` + ` ${r.ok ? "✔" : "✘".padEnd(2)}` + ` ${conf}`);
  }
  console.log("-".repeat(100));
  console.log(`accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${total})`);
  console.log(`latency: median ${stats.medianMs} ms | p95 ${stats.p95Ms} ms | min ${stats.minMs} ms | max ${stats.maxMs} ms`);
  console.log(`cost: ${inputTokens} input tokens (~$${estimatedUsd.toFixed(6)}), ${outputTokens} output tokens, wall ${wallMs} ms`);
}

if (opts.save) {
  const dir = join(here, "results");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `${stamp}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log("saved: " + file);
}

process.exit(failures > 0 ? 1 : 0);
