/**
 * Usage/quota tests: measured recording, rolling windows, quota status, the
 * opt-in hard stop, persistence, pruning and the formatters — all offline
 * (no API call, no network) against a temp history file.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bar, createUsageModule, fmtDuration, fmtInt, fmtUsd, formatUsage, sparkline, usagePresentation,
} from "../lib/usage.js";

const file = join(tmpdir(), "jev-usage-test-" + process.pid + ".json");
if (existsSync(file)) rmSync(file);
let nowMs = Date.parse("2026-08-01T10:00:00Z");
const usage = createUsageModule({ now: () => nowMs, filePath: file });

// ---- 1) empty -------------------------------------------------------------
const s0 = usage.snapshot({});
assert.equal(s0.windows.today.calls, 0);
assert.equal(s0.windows.all.calls, 0);
assert.equal(s0.quota.status, "ok");
assert.equal(s0.quota.limits.dailyCalls, null, "0 means no limit, not a limit of zero");
assert.equal(s0.provider.balanceApiAvailable, false, "no provider balance is claimed");
assert.match(s0.provider.note, /404/);
assert.equal(s0.history.length, 30);
console.log("PASS 1: empty snapshot reports measured zeros plus the honest provider note");

// ---- 2) one decision ------------------------------------------------------
usage.record({
  kind: "decision", tool: "jev_decision", inputTokens: 1000, outputTokens: 40, latencyMs: 210,
  questions: [{ name: "is_urgent", type: "noul" }, { name: "dept", type: "choice" }],
});
let s = usage.snapshot({});
assert.equal(s.windows.today.calls, 1);
assert.equal(s.windows.today.inputTokens, 1000);
assert.equal(s.windows.today.outputTokens, 40);
assert.equal(s.windows.today.byTool.jev_decision, 1);
assert.equal(s.windows.today.byKind.decision, 1);
assert.equal(s.windows.today.typeCounts.noul, 1);
assert.equal(s.windows.today.typeCounts.choice, 1);
assert.equal(s.windows.today.medianLatencyMs, 210);
assert.ok(Math.abs(s.windows.today.costUs - 0.000042) < 1e-12, "cost derived from input tokens x price");
assert.equal(s.priceUsdPerMTok, 0.042);
assert.equal(s.windows.session.calls, 1);
console.log("PASS 2: one decision is counted, with cost derived from tokens");

// ---- 3) a verify batch counts as N calls; guard events cost nothing -------
usage.record({ kind: "verify", tool: "jev_verify", calls: 27, inputTokens: 27000, latencyMs: 4000 });
usage.record({ kind: "guard", tool: "auto-guard", action: "deny" });
usage.record({ kind: "guard", tool: "auto-guard", action: "advise" });
s = usage.snapshot({});
assert.equal(s.windows.today.calls, 28, "27 benchmark calls + 1 decision; guards add none");
assert.equal(s.windows.today.byTool.jev_verify, 27);
assert.equal(s.windows.today.byKind.verify, 27);
assert.equal(s.windows.today.guards.denied, 1);
assert.equal(s.windows.today.guards.advised, 1);
assert.equal(s.recent.filter((e) => e.kind === "guard").length, 2);
console.log("PASS 3: a batch counts as N calls and guard events add none");

// ---- 4) quota status + the opt-in hard stop ------------------------------
const quota = { enabled: true, enforce: false, warnAtPercent: 50, dailyCallLimit: 40 };
s = usage.snapshot({ quota });
assert.equal(Math.round(s.quota.percent.dailyCalls), 70);
assert.equal(s.quota.status, "warn", "70% is past the 50% warning threshold");
assert.equal(s.quota.remaining.dailyCalls, 12);

const hard = { enabled: true, enforce: true, warnAtPercent: 80, dailyCallLimit: 28 };
const denied = usage.checkBudget({ quota: hard });
assert.equal(denied.allowed, false);
assert.match(denied.reason, /daily call budget reached \(28\/28\)/);
assert.equal(usage.checkBudget({ quota: { ...hard, enforce: false } }).allowed, true, "display-only unless enforce");
assert.equal(usage.checkBudget({ quota: { ...hard, dailyCallLimit: 100 } }).allowed, true);
assert.match(usage.checkBudget({ quota: { enabled: true, enforce: true, sessionCallLimit: 28 } }).reason, /session call budget reached \(28\/28\)/);
assert.equal(usage.checkBudget({ quota: { enabled: false, enforce: true, dailyCallLimit: 1 } }).allowed, true, "a disabled panel never blocks");
console.log("PASS 4: quota status and the opt-in hard stop behave as configured");

// ---- 5) persistence + pruning across days --------------------------------
nowMs = Date.parse("2026-09-20T10:00:00Z");
usage.record({ kind: "decision", inputTokens: 100, latencyMs: 150 });
usage.configure({ persist: true, historyDays: 30, filePath: file });
assert.ok(existsSync(file), "history file written when persist is on");
const parsed = JSON.parse(readFileSync(file, "utf8"));
assert.equal(parsed.version, 1);
assert.deepEqual(Object.keys(parsed.days), ["2026-09-20"], "days older than historyDays were pruned");
assert.equal(usage.daily.size, 1);
console.log("PASS 5: history is persisted and pruned to historyDays");

// ---- 6) a fresh module reads the same file -------------------------------
const reloaded = createUsageModule({ now: () => nowMs, filePath: file });
const sr = reloaded.snapshot({});
assert.equal(sr.windows.today.calls, 1);
assert.equal(sr.windows.today.inputTokens, 100);
assert.equal(sr.windows.all.calls, 1, "everything on file is visible");
assert.equal(sr.history[sr.history.length - 1].calls, 1);
assert.equal(sr.persistence.enabled, false, "persistence is process config, not a file property");
console.log("PASS 6: a new instance reloads the same measured history");

// ---- 7) reset clears memory and file -------------------------------------
reloaded.configure({ persist: true, filePath: file });
reloaded.reset();
assert.equal(reloaded.snapshot({}).windows.today.calls, 0);
assert.equal(reloaded.recent.length, 0);
assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8")).days), []);
console.log("PASS 7: reset clears the ring and the file");

// ---- 8) formatters + both payload shapes ---------------------------------
assert.equal(fmtInt(1234567), "1,234,567");
assert.equal(fmtUsd(0.000042), "$0.000042");
assert.equal(fmtUsd(1e-9), "<$0.000001");
assert.equal(fmtDuration(3600000), "1h 0m");
assert.equal(bar(50, 10), "█████░░░░░");
assert.equal(bar(200, 7), "███████");
assert.equal(sparkline([0, 1, 2]), "▁▅█");
assert.equal(sparkline([]), "");
const text = formatUsage(usage.snapshot({ quota: hard }), "today");
assert.match(text, /本机实测 \+ 本地自设额度，非供应商余额/);
assert.match(text, /### 今日额度/);
assert.match(text, /按工具/);
assert.match(text, /边界：TypeSafe 未提供余额\/额度接口/);
assert.match(text, /quota\.enforce 设为 true/);
const view = usagePresentation(usage.snapshot({ quota: hard }));
assert.equal(view.kind, "usage");
assert.equal(view.enforce, true);
assert.equal(view.limits.dailyCalls, 28);
assert.equal(view.provider.balanceApiAvailable, false);
assert.ok(Array.isArray(view.history) && view.history.length === 30);
assert.equal(usagePresentation(null).kind, "usage");
console.log("PASS 8: formatters and both payload shapes are stable");

rmSync(file, { force: true });
console.log("ALL USAGE TESTS PASSED");
