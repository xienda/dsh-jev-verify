/**
 * Auto-guard submodule for dsh-jev-verify.
 *
 * Deterministic dangerous-command rules (free, zero-latency) layered with
 * Jev-backstopped risk and loop checks. Fail-open: on Jev failure, calls pass
 * through with a warning; the deterministic layer always keeps the final say
 * for hard blacklist patterns.
 */
export function createGuardModule({ requestSystemOne }) {
  /** Deterministic dangerous-command patterns (free, zero-latency first layer). */
  const SAFETY_PATTERNS = [
    { name: "rm -rf root/home/all", re: /\brm\s+-[a-z]*r[a-z]*f[a-z]*\s+(\/|~|\*|\/[*]|\.(\/|\\)?\*)/i },
    { name: "disk format/partition", re: /\bformat\s+[a-z]:|mkfs\.|diskpart|fdisk\s+\/|pvcreate|vgremove|dd\s+if=.*of=\/dev\//i },
    { name: "drop/truncate database", re: /\bdrop\s+database\b|\bdrop\s+table\b|\btruncate\s+table\b|\bdelete\s+from\s+.*\bwhere\b.*\b(1=1|true)\b/i },
    { name: "full-dir recursive delete", re: /(del|rmdir)\s+\/[a-z]*[srfq][a-z]*\s+(\/|\*|\.)|remove-item\s+-recurse|rm\s+-[a-z]*r[a-z]*\s+\.\s/i },
    { name: "shutdown/reboot host", re: /\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b|restart-computer/i },
    { name: "wipe git history/force push", re: /git\s+filter-branch|git\s+push\s+--force|reflog\s+expire|git\s+gc\s+--prune/i },
    { name: "credential exfiltration", re: /(cat|type|get-content|printenv)\s+[\w.\/\\: -]*\.env\b|aws\s+secretsmanager.*get-secret|\bexport\s+[A-Za-z_]+(KEY|TOKEN|SECRET)=|token\s*=\s*["']?(ghp_|sk-)/i },
  ];

  /** Quick stable hash for command-dedup caching. */
  function hashText(text) {
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
    return h.toString(36);
  }

  /**
   * Deterministic first layer. Returns { level, pattern? } with level in
   * clear | suspect | dangerous.
   */
  function evaluateDeterministic(text) {
    if (typeof text !== "string" || text.trim().length === 0) return { level: "clear" };
    for (const p of SAFETY_PATTERNS) {
      if (p.re.test(text)) return { level: "dangerous", pattern: p.name };
    }
    if (/\b(rm|del|remove|drop|truncate|wipe|format|overwrite|sudo|su\s+|reset-password|kill\s+-9|taskkill|reg\s+delete|netsh)\b/i.test(text)) {
      return { level: "suspect", pattern: "risky verb" };
    }
    return { level: "clear" };
  }

  /** Jev guard verdict: noul probability the described operation is high-risk. */
  async function judgeRisky(options, text) {
    const { body } = await requestSystemOne(
      options,
      {
        state: text,
        model: options.model,
        questions: {
          risky: {
            type: "noul",
            instructions: "The described command or operation is destructive and irreversible, escalates privileges, or leaks credentials or secrets",
          },
        },
      },
      void 0,
    );
    const noul = body?.answers?.risky?.noul;
    return typeof noul === "number" ? noul : 0.5;
  }

  /** Jev loop-stall verdict: noul probability the agent is semantically stalled. */
  async function judgeStall(options, recent, previous) {
    const state =
      "Latest tool result (tail):\n" + (recent || "").slice(-1200) + "\n\nPrevious same-tool result (tail):\n" + (previous || "").slice(-1200);
    const { body } = await requestSystemOne(
      options,
      {
        state,
        model: options.model,
        questions: {
          stalled: {
            type: "noul",
            instructions: "The agent is stuck in a loop: the latest tool output shows no meaningful progress compared to the previous attempt",
          },
        },
      },
      void 0,
    );
    const noul = body?.answers?.stalled?.noul;
    return typeof noul === "number" ? noul : 0.5;
  }

  /** Per-plugin-instance guard runtime state. */
  function createGuardState() {
    return {
      safety: { checks: 0, jevCalls: 0, denied: 0, deterministicDenied: 0, lastVerdicts: new Map(), auditCalls: 0, lastSeenTool: null, seenTools: {}, lastArgKeys: null },
      loop: { checks: 0, jevCalls: 0, injected: 0, window: [], cooldownUntil: 0 },
    };
  }

  /**
   * Register auto-guard hooks on a cordis context.
   * @param ctx - plugin context with tools events.
   * @param config - plugin config (autoGuard section).
   * @param options - resolved Jev API options snapshot.
   * @returns runtime state + settings, or null when disabled.
   */
  function applyAutoGuard(ctx, config, options, events = {}) {
    const guard = config.autoGuard ?? {};
    if (guard.enabled !== true) return null;
    const gs = createGuardState();
    const guardTools = new Set(Array.isArray(guard.tools) && guard.tools.length > 0 ? guard.tools : ["bash", "pwsh", "run_code", "terminal"]);
    const denyThreshold = guard.denyThreshold ?? 0.85;
    const maxJev = guard.maxJevCallsPerSession ?? 50;
    const loopN = guard.loopConsecutive ?? 3;
    const loopCooldown = guard.loopCooldownMs ?? 60000;
    const loopMinChars = guard.loopMinChars ?? 200;
    const guardBudget = () => gs.safety.jevCalls + gs.loop.jevCalls < maxJev;

    if (guard.safetyCheck !== false) {
      ctx.on("tools/pre-execute", async (exec, next) => {
        gs.safety.auditCalls += 1;
        gs.safety.lastSeenTool = exec.name;
        gs.safety.seenTools[exec.name] = (gs.safety.seenTools[exec.name] ?? 0) + 1;
        if (!guardTools.has(exec.name)) return next();
        const rawArgs = exec.arguments ?? exec.args;
        const argKeys = typeof rawArgs === "object" && rawArgs !== null ? Object.keys(rawArgs) : [];
        gs.safety.lastArgKeys = argKeys.join(",");
        const command =
          typeof rawArgs === "object" && rawArgs !== null
            ? String(rawArgs.command ?? rawArgs.code ?? rawArgs.script ?? rawArgs.arguments ?? JSON.stringify(rawArgs))
            : "";
        if (command.trim().length === 0) return next();
        gs.safety.checks += 1;
        const det = evaluateDeterministic(command);
        if (det.level === "dangerous") {
          gs.safety.deterministicDenied += 1;
          events.onSafetyDeny?.({ deterministic: true, rule: det.pattern, command });
          ctx.logger?.warn?.("[dsh-jev-verify] auto-guard denied " + exec.name + " (deterministic: " + det.pattern + ")");
          return {
            kind: "deny",
            reason:
              '[jev auto-guard] Blocked by deterministic safety rule "' + det.pattern + '". ' +
              "If this command is intended and safe, adjust or disable autoGuard in Settings > Plugins > Plugin configuration > Jev.",
          };
        }
        if (guard.determinismFirst === false || det.level === "suspect") {
          if (!guardBudget()) return next();
          const key = hashText(command);
          const cached = gs.safety.lastVerdicts.get(key);
          let noul = cached;
          if (noul === undefined) {
            try {
              noul = await judgeRisky(options, command);
              gs.safety.jevCalls += 1;
              gs.safety.lastVerdicts.set(key, noul);
            } catch (error) {
              ctx.logger?.warn?.("[dsh-jev-verify] auto-guard Jev check failed (fail-open): " + String(error));
              return next();
            }
          }
          if (typeof noul === "number" && noul >= denyThreshold) {
            gs.safety.denied += 1;
            ctx.logger?.warn?.("[dsh-jev-verify] auto-guard denied " + exec.name + " (Jev noul=" + noul.toFixed(2) + ")");
            return {
              kind: "deny",
              reason:
                "[jev auto-guard] Jev judged this command high-risk (confidence " + (noul * 100).toFixed(0) + "%). " +
                "If intended, allow it explicitly or tune autoGuard.denyThreshold.",
            };
          }
        }
        return next();
      });
    }

    if (guard.loopCheck !== false) {
      ctx.on("tools/post-execute", async (exec, result, next) => {
        if (result.isError) return next();
        const content = (result.content ?? []).map((b) => (b?.type === "text" ? b.text : "")).join(" ");
        gs.loop.window.push({ tool: exec.name, at: Date.now(), content });
        if (gs.loop.window.length > loopN + 4) gs.loop.window.shift();
        const window = gs.loop.window.slice(-loopN);
        const sameTool = window.length === loopN && window.every((w) => w.tool === exec.name);
        if (!sameTool) return next();
        if (window.some((w) => w.content.length < loopMinChars)) return next();
        if (Date.now() < gs.loop.cooldownUntil) return next();
        if (!guardBudget()) return next();
        gs.loop.checks += 1;
        let noul;
        try {
          noul = await judgeStall(options, window[window.length - 1].content, window[0].content);
          gs.loop.jevCalls += 1;
        } catch (error) {
          ctx.logger?.warn?.("[dsh-jev-verify] loop guard Jev check failed (fail-open): " + String(error));
          return next();
        }
        if (typeof noul === "number" && noul >= denyThreshold) {
          gs.loop.injected += 1;
          gs.loop.cooldownUntil = Date.now() + loopCooldown;
          return {
            kind: "accept",
            additionalContexts: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      "[jev auto-guard] The last " + loopN + " " + exec.name + " calls appear semantically stalled (Jev probability " + (noul * 100).toFixed(0) + "%). " +
                      "Reconsider the approach: change strategy, inspect the tool output, or ask the user. Advice only, not a block.",
                  },
                ],
              },
            ],
          };
        }
        return next();
      });
    }

    return { gs, guardTools, denyThreshold };
  }

  return { SAFETY_PATTERNS, hashText, evaluateDeterministic, judgeRisky, judgeStall, createGuardState, applyAutoGuard };
}