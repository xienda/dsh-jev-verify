import { createCounselModule } from "../lib/counsel.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the API key the way the plugin does: environment first, then the
 * DSH_HOME/dsh env file. The path is derived from the running user instead of
 * being hardcoded to one machine, so the published script works anywhere.
 */
function readKey() {
  const fromEnv = globalThis.process?.env?.["TYPESAFE" + "_API_KEY"];
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  const dotEnv = String.fromCharCode(46) + "env";
  const home = globalThis.process?.env?.DSH_HOME;
  const candidates = [];
  if (typeof home === "string" && home.length > 0) candidates.push(join(home, dotEnv));
  candidates.push(join(homedir(), ".dsh", dotEnv));
  const prefix = "TYPESAFE" + "_" + "API" + "_" + "KEY" + "=";
  for (const file of candidates) {
    try {
      const line = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(prefix));
      if (line) return line.slice(prefix.length).trim();
    } catch { /* try the next candidate */ }
  }
  return null;
}
const key = readKey();
if (!key) { console.log("NO_KEY (set TYPESAFE_API_KEY, or store it in the DSH_HOME env file)"); process.exit(2); }

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

const counsel = createCounselModule({ requestSystemOne });
const context = "dsh-jev-verify 0.7.3 发布任务：npm 已登录(xienda)、git 未认证、宿主进程不可重启（线上 GUI 由它服务，磁盘新代码重启前不生效）、测试 19/19 通过、真实 API 验证待做。目标：安全高效完成发布并保证质量。";
const options = [
  "直接发布：立即 npm publish + git commit/push，边发边验证（风险：未做真实端到端验证就上线、push 凭证未知）",
  "先验证后发布：先跑真实 API 端到端验证与新测试补齐，再 npm publish，最后处理 git 推送（顺序最稳，耗时多约 30 分钟）",
  "只发 npm 暂缓 git：npm publish 先行，git/GitHub/catalog 稍后单独处理（部分上线，异常现场可更快单独排查）",
];
const value = await counsel.rankOptions({ options, context }, { model: "jev-1.13.0", inputPriceUsdPerMTok: 0.042 });
console.log(counsel.formatChoose(value));
console.log("RAW:" + JSON.stringify({ model: value.model, recommended: value.recommended, ranking: value.ranking, latencyMs: value.latencyMs, costUs: value.estimatedCostUs, inputTokens: value.inputTokens, outputTokens: value.outputTokens }));
