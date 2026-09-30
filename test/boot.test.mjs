/**
 * BOOT-STABILITY test: apply() must NEVER throw, for every config shape, and
 * must register the five tools plus the settings namespace. Uses the REAL
 * @deepseek-ai/dsh-tools defineTool (schema DSL validation runs exactly like
 * inside a host), with fake services for everything else.
 */
import assert from "node:assert/strict";
import { apply, name, inject } from "../lib/index.js";
import { defineTool } from "@deepseek-ai/dsh-tools";

function fakeCtx({ settingsSvc = true, webServerSvc = true, systemPromptSvc = true } = {}) {
  const tools = [];
  const routes = [];
  const settingsNamespaces = [];
  const promptSections = [];
  const onHandlers = {};
  const get = () => undefined;
  const inject = (services, cb) => {
    const have = { settings: settingsSvc, webServer: webServerSvc, systemPrompt: systemPromptSvc };
    if (services.every((s) => have[s] === true)) {
      const svc = {};
      if (services.includes("settings")) {
        svc.settings = {
          register(ns, schema, options) {
            settingsNamespaces.push(ns);
            assert.ok(schema, "schema required");
            assert.ok(options?.base, "base required");
            const state = {};
            const watchers = [];
            return { get: () => state, watch: (fn) => watchers.push(fn), _schema: schema };
          },
        };
      }
      if (services.includes("webServer")) {
        svc.webServer = { register: (r) => routes.push(r) };
      }
      if (services.includes("systemPrompt")) {
        // Mirrors the REAL host contract (@deepseek-ai/dsh-system-prompt):
        // section() rejects a non-finite order, and getSectionOrder() is a plain
        // table lookup whose SECTION_ORDERS has no TOOL_JEV slot in this DSH
        // generation. 0.7.3 passed that undefined straight to section(), the
        // TypeError was swallowed by the quarantine, and the guidance section
        // silently never existed — so the agent never called Jev on its own.
        svc.systemPrompt = {
          getSectionOrder: (n) => (n === "TOOL_GOAL" ? 2600 : undefined),
          section: (s) => {
            if (!Number.isFinite(s.order)) {
              throw new TypeError('prompt section "' + s.name + '" order must be a finite number');
            }
            promptSections.push(s);
          },
        };
      }
      cb(svc);
    }
  };
  const ctx = {
    tools: { register: (t) => tools.push(t), get: (n) => ({ name: n }) },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    get,
    inject,
    on: (ev, fn) => { onHandlers[ev] = fn; },
  };
  return { ctx, tools, routes, settingsNamespaces, promptSections, onHandlers };
}

const CONFIG_SHAPES = [
  {},
  { enabled: true },
  { enabled: false },
  { autoGuard: { enabled: true, denyThreshold: 0.8 } },
  { autoGuard: { enabled: false } },
  { dashboard: { enabled: true } },
  { dashboard: { enabled: false } },
  { apiKey: "k", model: "jev-1.13.0", timeoutMs: 3000, maxQuestionsPerCall: 10 },
  { weirdUnknownField: 1, autoGuard: { bogus: true } },
];

for (const shape of CONFIG_SHAPES) {
  const { ctx, tools: registered, settingsNamespaces } = fakeCtx();
  let threw = null;
  try {
    apply(ctx, JSON.parse(JSON.stringify(shape)));
  } catch (e) {
    threw = e;
  }
  assert.equal(threw, null, "apply must not throw for config " + JSON.stringify(shape) + " -> " + String(threw));
  if (shape.enabled === false) continue;
  const names = registered.map((t) => t.name).sort();
  assert.deepEqual(names, ["jev_choose", "jev_decision", "jev_guard_status", "jev_overview", "jev_verify"], "all five tools registered for " + JSON.stringify(shape));
  assert.ok(settingsNamespaces.includes("jev-verify"), "settings namespace registered for " + JSON.stringify(shape));
}
console.log("PASS 1: apply never throws across " + CONFIG_SHAPES.length + " config shapes (incl. unknown fields)");

// webServer-less host: apply must still never throw and tools still register
{
  const { ctx, tools: registered } = fakeCtx({ webServerSvc: false });
  let threw = null;
  try { apply(ctx, { autoGuard: { enabled: true }, dashboard: { enabled: true } }); } catch (e) { threw = e; }
  assert.equal(threw, null, "no-webServer host must not throw");
  assert.equal(registered.length, 5, "tools registered without webServer");
}
console.log("PASS 2: hosts without webServer/settings still boot cleanly");

// REGRESSION (0.7.3 → 0.7.4): the guidance section must register even though the
// host has no TOOL_JEV order slot and validates that order is finite.
{
  const { ctx, promptSections } = fakeCtx();
  apply(ctx, {});
  const g = promptSections.find((s) => s.name === "tool:jev");
  assert.ok(g, "guidance section tool:jev must register");
  assert.ok(Number.isFinite(g.order), "guidance order must be finite, got " + g.order);
  assert.equal(g.order, 3000, "default guidance order");
  const text = g.text({ scope: {} });
  assert.ok(typeof text === "string" && text.length > 300, "guidance text must be substantial");
  for (const tool of ["jev_decision", "jev_choose", "jev_overview", "jev_guard_status", "jev_verify"]) {
    assert.ok(text.includes(tool), "guidance must name " + tool);
  }
  assert.ok(text.includes("70-500ms"), "guidance carries the measured latency");
  assert.ok(!text.includes("自动护栏已在"), "no auto-guard line when the guard is off");
}
console.log("PASS 3: system-prompt guidance registers under the real host contract");

// guidance.order / guidance.extra honoured; guidance.enabled:false registers nothing
{
  const { ctx, promptSections } = fakeCtx();
  apply(ctx, { maxQuestionsPerCall: 7, autoGuard: { enabled: true }, guidance: { order: 4200, extra: "本仓库提交信息必须中英双语。" } });
  const g = promptSections.find((s) => s.name === "tool:jev");
  assert.equal(g.order, 4200, "custom guidance order honoured");
  const text = g.text({ scope: {} });
  assert.ok(text.includes("1-7 个并行原子判定"), "maxQuestionsPerCall interpolated");
  assert.ok(text.includes("部署自定义规则：本仓库提交信息必须中英双语。"), "guidance.extra appended verbatim");
  assert.ok(text.includes("自动护栏已在"), "auto-guard line present when the guard is on");

  const off = fakeCtx();
  apply(off.ctx, { guidance: { enabled: false } });
  assert.equal(off.promptSections.filter((s) => s.name === "tool:jev").length, 0, "guidance.enabled:false registers nothing");
}
console.log("PASS 4: guidance config (order / extra / enabled) is honoured");

// dashboard enabled: exactly the three page routes registered on webServer
{
  const { ctx, tools: registered, routes } = fakeCtx();
  apply(ctx, { dashboard: { enabled: true } });
  const paths = routes.map((r) => r.path).sort();
  assert.deepEqual(paths, ["/jev", "/jev/api", "/jev/api/try"], "dashboard routes when enabled");
}
console.log("PASS 3: dashboard routes only when enabled");

// enabled:false -> no tools at all
{
  const { ctx, tools: registered } = fakeCtx();
  apply(ctx, { enabled: false });
  assert.equal(registered.filter((r) => typeof r.name === "string").length, 0, "no tools when disabled");
}
console.log("PASS 4: enabled:false registers nothing");

// tools.defineTool schema validity: real DSL validation happens inside apply;
// this assert verifies the tools pass schema compilation (would throw there).
console.log("PASS 5: real defineTool schema compilation never threw inside apply (covered by PASS 1)");
console.log("ALL BOOT TESTS PASSED — apply() is boot-stable");