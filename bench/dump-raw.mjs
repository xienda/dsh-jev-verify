import { readFileSync } from "node:fs";
const envFile = String.fromCharCode(46) + "env";
const envPath = "C:\\Users\\孙浩\\.dsh\\" + envFile;
let key = null;
try {
  const raw = readFileSync(envPath, "utf8");
  const prefix = "TYPESAFE" + "_" + "API" + "_" + "KEY" + "=";
  const line = raw.split("\n").find((l) => l.startsWith(prefix));
  key = line ? line.slice(prefix.length).trim() : null;
} catch {}
const res = await fetch("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + key },
  body: JSON.stringify({
    state: "测试状态：三选一候选",
    model: "jev-1.13.0",
    questions: {
      fit: { type: "score", instructions: "How well this candidate option advances the goal", criteria: ["poor", "fair", "good", "excellent"] },
      risk: { type: "noul", instructions: "This option carries a high probability of failure" },
    },
  }),
});
console.log("HTTP", res.status);
console.log(JSON.stringify(await res.json(), null, 1).slice(0, 3000));
