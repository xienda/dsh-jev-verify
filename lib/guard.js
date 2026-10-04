/**
 * Auto-guard submodule for dsh-jev-verify.
 *
 * Two deterministic tiers (free, zero-latency) layered under a Jev backstop:
 *   - hard (dangerous): catastrophic, irreversible operations — recursive
 *     deletion of a filesystem, drive or directory tree, disk formatting,
 *     database destruction, credential exfiltration and force-pushed git
 *     history. Blocked outright, but only when the match sits in executable
 *     position (see atCommandPosition), so quoting or documenting a dangerous
 *     command in prose is never hard-blocked by the deterministic layer; a hard
 *     match found elsewhere is downgraded to a soft hint.
 *   - soft (suspect): operations that are destructive but often legitimate
 *     (host restart or power-off, git-history rewrites short of a force push,
 *     always-true DELETE/UPDATE conditions) plus any text a hard rule matched
 *     outside executable position. These go to Jev.
 * Fail-open: on Jev failure, calls pass through with a warning.
 */
export function createGuardModule({ requestSystemOne }) {
  /** Cap on the per-session command->verdict cache. */
  const MAX_VERDICTS = 200;
  /** Words that may sit between a command boundary and the executable token. */
  const WRAPPERS = /^(?:sudo|doas|env|nohup|command|time|exec|busybox|nice|ionice|setsid|stdbuf|bash|sh|powershell|pwsh|cmd)$/i;
  /** End of a shell separator / opening delimiter: the start of a new command. */
  const BOUNDARY = /(?:^|[\n;|&(`]|\$\()\s*$/;
  /** Targets whose recursive deletion is unrecoverable. */
  const ROOT_TARGETS = /^(?:\/|\/\*|~|~\/|~\/\*|[a-zA-Z]:|[a-zA-Z]:\/|\/(?:bin|boot|dev|etc|home|lib|lib64|opt|proc|root|sbin|srv|sys|usr|var)\/?|\.|\.\/|\.\/\*|\.\\\*)$/;

  /** True when `index` starts an executable token rather than prose or a quote. */
  function atCommandPosition(text, index) {
    const head = text.slice(0, index).replace(/\s+$/, "");
    if (head.length === 0) return true;
    if (BOUNDARY.test(head)) return true;
    const tail = head.match(/(?:^|[\n;|&(`]|\$\()([^;&|(`\n]*)$/);
    if (tail === null) return false;
    const words = tail[1].trim().split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return true;
    if (words.length > 4) return false;
    return words.every((w) => WRAPPERS.test(w) || /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(w) || /^-{1,2}\S+$/.test(w));
  }

  /** Index of the first match of a non-global regex, or -1. */
  function indexOfRe(text, re) {
    const m = text.match(re);
    return m === null ? -1 : m.index;
  }

  /**
   * Index of the first recursive delete aimed at a root or home target. Tokens
   * are walked one by one, so flag order, extra flags, `--flag=value` forms and
   * `--` separators are all irrelevant: only the first non-flag token (the
   * target) decides, and that target must be a root, home or cwd path.
   * A recursive delete of an ordinary relative path (for example a build
   * directory) is NOT fatal here - it falls through to the soft tier.
   */
  function findRootWipe(text) {
    const verb = /\brm\b/gi;
    let m;
    while ((m = verb.exec(text)) !== null) {
      const segment = text.slice(m.index + m[0].length).split(/[;&|<>,]/)[0];
      const flags = [];
      let target = null;
      for (const token of segment.split(/\s+/).filter((t) => t.length > 0)) {
        if (/^-{1,2}[\w=/:,.-]*$/.test(token)) { flags.push(token); continue; }
        target = token;
        break;
      }
      if (target === null) continue;
      if (!/[rR]/.test(flags.join(" "))) continue;
      if (ROOT_TARGETS.test(target.replace(/\\/g, "/"))) return m.index;
    }
    return -1;
  }

  /** Index of the first recursive delete aimed at a whole Windows drive. */
  function findDriveRootWipe(text) {
    const re = /\b(del|rd|rmdir|erase)\s+((?:\/[a-z]+\s+)*)([a-zA-Z]:[\\/]?)(?=\s|$)/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!/\/[a-z]*[sq]/i.test(m[2] ?? "")) continue;
      return m.index;
    }
    return -1;
  }

  /** Hard tier: irreversible, blocked when in executable position. */
  const HARD_RULES = [
    { name: "rm -rf root/home/all", find: (text) => findRootWipe(text) },
    {
      name: "disk format/partition",
      find: (text) => indexOfRe(text, /\bformat\s+[a-z]:|mkfs\.|diskpart|fdisk\s+\/|pvcreate|vgremove|dd\s+if=.*of=\/dev\//i),
    },
    { name: "drop/truncate database", find: (text) => indexOfRe(text, /\bdrop\s+database\b|\bdrop\s+table\b|\btruncate\s+table\b/i) },
    { name: "drive-root recursive delete", find: (text) => findDriveRootWipe(text) },
    { name: "git force push", find: (text) => indexOfRe(text, /git\s+push\s+--force/i) },
    { name: "recursive delete of a directory tree", find: (text) => indexOfRe(text, /(del|rmdir)\s+\/[a-z]*[srfq][a-z]*\s+(\/|\*|\.)|remove-item[\s\S]{0,60}-recurse|-recurse[\s\S]{0,60}remove-item/i) },
    {
      name: "credential exfiltration",
      find: (text) =>
        indexOfRe(
          text,
          /(?:cat|type|get-content|printenv)\s+[\w.\/\\: -]*\.env\b|aws\s+secretsmanager[^\n]*get-secret|\bexport\s+[A-Za-z_]+(?:KEY|TOKEN|SECRET)=|token\s*=\s*["\x27]?(?:ghp_|sk-)[A-Za-z0-9_-]{8,}/i,
        ),
    },
  ];

  /** Soft tier: destructive but often legitimate — Jev decides. */
  const SUSPECT_RULES = [
    { name: "shutdown/reboot host", re: /\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b|restart-computer/i },
    { name: "wipe git history/force push", re: /git\s+filter-branch|reflog\s+expire|git\s+gc\s+--prune/i },
    { name: "delete from ... where 1=1", re: /\bdelete from ... where 1=1\b/i },
  ];

  /** Flat view for documentation and tests. */
  const SAFETY_PATTERNS = [
    ...HARD_RULES.map((r) => ({ name: r.name, level: "dangerous" })),
    ...SUSPECT_RULES.map((r) => ({ name: r.name, level: "suspect" })),
  ];

  const RISKY_VERB = /\b(rm|del|remove|drop|truncate|wipe|format|overwrite|sudo|su\s+|reset-password|kill\s+-9|taskkill|reg\s+delete|netsh)\b/i;

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
    let quoted = null;
    for (const rule of HARD_RULES) {
      const at = rule.find(text);
      if (at < 0) continue;
      if (atCommandPosition(text, at)) return { level: "dangerous", pattern: rule.name };
      if (quoted === null) quoted = rule.name;
    }
    for (const rule of SUSPECT_RULES) {
      if (rule.re.test(text)) return { level: "suspect", pattern: rule.name };
    }
    if (quoted !== null) return { level: "suspect", pattern: quoted + " (quoted/described)" };
    if (RISKY_VERB.test(text)) return { level: "suspect", pattern: "risky verb" };
    return { level: "clear" };
  }

  /**
   * Jev guard verdict: probability that executing `text` is high-risk. The
   * wording separates executing a command from merely quoting one, so prose
   * that documents a dangerous command is not judged as if it ran it.
   */
  async function judgeRisky(options, text, toolName) {
    const instructions =
      typeof toolName === "string" && toolName.length > 0
        ? 'The tool call "' + toolName + '" is about to EXECUTE the text below, and that execution is destructive and irreversible, escalates privileges, or leaks credentials or secrets. Merely quoting, documenting or discussing a dangerous command is NOT risky.'
        : "The described command or operation is destructive and irreversible, escalates privileges, or leaks credentials or secrets";
    const { body } = await requestSystemOne(
      options,
      {
        state: text,
        model: options.model,
        questions: { risky: { type: "noul", instructions } },
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
   * @param events - audit sinks: onSafetyDeny / onLoopAdvisory.
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
          events.onSafetyDeny?.({ deterministic: true, rule: det.pattern, command, tool: exec.name });
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
              noul = await judgeRisky(options, command, exec.name);
              gs.safety.jevCalls += 1;
              if (gs.safety.lastVerdicts.size >= MAX_VERDICTS) {
                const oldest = gs.safety.lastVerdicts.keys().next().value;
                if (oldest !== undefined) gs.safety.lastVerdicts.delete(oldest);
              }
              gs.safety.lastVerdicts.set(key, noul);
            } catch (error) {
              ctx.logger?.warn?.("[dsh-jev-verify] auto-guard Jev check failed (fail-open): " + String(error));
              return next();
            }
          }
          if (typeof noul === "number" && noul >= denyThreshold) {
            gs.safety.denied += 1;
            events.onSafetyDeny?.({ deterministic: false, rule: "Jev high-risk", confidence: noul, command, tool: exec.name });
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
          events.onLoopAdvisory?.({ noul, tool: exec.name });
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