/*!
 * dsh-jev-verify — browser half.
 * Registers the "Jev" card into Settings > Plugins > Plugin configuration
 * (settings.plugin.item slot, keyed by the jev-verify namespace), so the API
 * key, model, guard and dashboard switches are editable in the GUI without
 * touching the terminal.
 *
 * Styling mirrors the official DSH plugin cards
 * (@deepseek-ai/dsh-client-ui-settings-plugins): a <li> card with a 16px
 * radius, a collapsible header (title + description + chevron), stacked
 * fields separated by hairlines, and a right-aligned discard/save footer.
 * Every colour reads a --dsw-alias-* variable, so light and dark themes are
 * inherited from the shell instead of being hard-coded here.
 * Hand-written, build-free, defensive: any failure degrades only this card.
 */
window.__ModuleLoader__.load({ id: "dsh-jev-verify", factory: (require) => {
  globalThis.__DSH_JEV_CLIENT_VERSION__ = "0.7.4";
  "use strict";
  var module = { exports: {} };
  var react = require("react");
  var h = react.createElement;
  var useState = react.useState;
  var useEffect = react.useEffect;
  var useSyncExternalStore = react.useSyncExternalStore;

  var NS = "jev-verify";

  /* ------------------------------------------------------------------ *
   * Styles. Scoped with a djev- prefix and injected once, following the  *
   * official card metrics (see PluginCard.module.css / fields.module.css)*
   * ------------------------------------------------------------------ */
  var CSS = [
    ".djev-card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}",
    ".djev-card:hover{border-color:var(--dsw-alias-label-dimmed)}",
    ".djev-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
    ".djev-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
    ".djev-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
    ".djev-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
    ".djev-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
    ".djev-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
    ".djev-tag{flex:none;border:1px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:1px 7px;font-size:11px;line-height:1.6;white-space:nowrap}",
    ".djev-tagOk{color:var(--dsw-alias-label-success);border-color:var(--dsw-alias-label-success)}",
    ".djev-tagWarn{color:var(--dsw-alias-label-warning);border-color:var(--dsw-alias-label-warning)}",
    ".djev-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;width:14px;height:14px}",
    ".djev-chevronOpen{transform:rotate(180deg)}",
    ".djev-body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}",
    ".djev-group{color:var(--dsw-alias-label-tertiary);margin:14px 0 0;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}",
    ".djev-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
    ".djev-field+.djev-field{border-top:.5px solid var(--dsw-alias-border-l2)}",
    ".djev-head{align-items:center;gap:8px;display:flex}",
    ".djev-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
    ".djev-input{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;width:100%;box-sizing:border-box;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}",
    ".djev-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
    ".djev-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
    ".djev-inputInvalid{border-color:var(--dsw-alias-label-error)}",
    ".djev-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
    ".djev-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}",
    ".djev-toggleRow{color:var(--dsw-alias-label-primary);justify-content:space-between;align-items:flex-start;gap:16px;font-size:13px;line-height:1.5;display:flex;padding:12px 0;cursor:pointer}",
    ".djev-toggleRow+.djev-toggleRow{border-top:.5px solid var(--dsw-alias-border-l2)}",
    ".djev-toggleText{flex:1;min-width:0}",
    ".djev-toggleHint{display:block;color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:12px}",
    ".djev-switch{appearance:none;cursor:pointer;flex:none;margin:2px 0 0;width:34px;height:20px;border-radius:10px;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-4);position:relative;transition:background .16s,border-color .16s}",
    ".djev-switch:after{content:'';position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:transform .16s,background .16s}",
    ".djev-switch:checked{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}",
    ".djev-switch:checked:after{transform:translateX(14px);background:#fff}",
    ".djev-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
    ".djev-switch:disabled{opacity:.4;cursor:default}",
    ".djev-footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
    ".djev-status{min-width:0;flex:1;margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}",
    ".djev-ok{color:var(--dsw-alias-label-success)}",
    ".djev-failed{color:var(--dsw-alias-label-error)}",
    ".djev-discard,.djev-save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
    ".djev-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
    ".djev-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
    ".djev-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
    ".djev-discard:disabled,.djev-save:disabled{opacity:.4;cursor:default}",
    ".djev-discard:focus-visible,.djev-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
    ".djev-note{color:var(--dsw-alias-label-tertiary);margin:14px 0 0;font-size:12px;line-height:1.6}",
    /* ---- inline tool view (how one jev_decision call renders in a turn) ---- */
    ".djev-tv{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden;font-size:13px}",
    ".djev-tvHead{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;background:0 0;border:0;width:100%;font:inherit;color:inherit;text-align:left}",
    ".djev-tvHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}",
    ".djev-tvDot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary)}",
    ".djev-tvDotRun{background:var(--dsw-alias-brand-primary)}",
    ".djev-tvDotOk{background:var(--dsw-alias-label-success)}",
    ".djev-tvDotErr{background:var(--dsw-alias-label-error)}",
    ".djev-tvTitle{color:var(--dsw-alias-label-primary);font-weight:500}",
    ".djev-tvMeta{color:var(--dsw-alias-label-tertiary);font-size:12px;margin-left:auto;white-space:nowrap}",
    ".djev-tvBody{border-top:.5px solid var(--dsw-alias-border-l2);padding:10px 12px;display:flex;flex-direction:column;gap:8px}",
    ".djev-tvState{color:var(--dsw-alias-label-tertiary);font-size:12px;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;max-height:120px;overflow:auto}",
    ".djev-ans{display:grid;gap:4px;padding:8px 0}",
    ".djev-ans+.djev-ans{border-top:.5px solid var(--dsw-alias-border-l2)}",
    ".djev-ansTop{display:flex;align-items:baseline;gap:8px}",
    ".djev-ansName{color:var(--dsw-alias-label-tertiary);font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
    ".djev-ansVal{color:var(--dsw-alias-label-primary);font-weight:600}",
    ".djev-ansConf{margin-left:auto;color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}",
    ".djev-bar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-4);overflow:hidden}",
    ".djev-barFill{height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary)}",
    ".djev-barOk{background:var(--dsw-alias-label-success)}",
    ".djev-barWarn{background:var(--dsw-alias-label-warning)}",
    ".djev-ansWhy{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}",
    ".djev-chips{display:flex;gap:6px;flex-wrap:wrap;padding:2px 0 6px}",
    ".djev-chip{border-radius:10px;padding:1px 8px;font-size:11px;background:var(--dsw-alias-bg-l2,#0000000d);color:var(--dsw-alias-label-secondary)}",
    ".djev-chipOk{color:var(--dsw-alias-label-success,#1a7f37)}",
    ".djev-chipWarn{color:var(--dsw-alias-label-warning,#9a6700)}",
    ".djev-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;padding:2px 0 8px}",
    ".djev-stat{display:flex;flex-direction:column;gap:1px}",
    ".djev-statVal{font-variant-numeric:tabular-nums;font-size:14px;color:var(--dsw-alias-label-primary)}",
    ".djev-statLabel{font-size:11px;color:var(--dsw-alias-label-tertiary)}",
    ".djev-recent{display:flex;gap:8px;align-items:baseline;padding:2px 0;font-size:12px}",
    ".djev-recentMain{flex:1;color:var(--dsw-alias-label-secondary);word-break:break-word}",
    ".djev-recentTs{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}",
    ".djev-tvFoot{border-top:.5px solid var(--dsw-alias-border-l2);display:flex;gap:12px;flex-wrap:wrap;padding:8px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}",
    ".djev-table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}",
    ".djev-table th,.djev-table td{border-bottom:.5px solid var(--dsw-alias-border-l2);padding:5px 8px;text-align:left;vertical-align:top}",
    ".djev-table th{color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:11px}",
    ".djev-table td.djev-tdIdx{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,Menlo,monospace}",
    ".djev-table td.djev-tdLabel{max-width:320px;word-break:break-word}",
    ".djev-rowRec td{background:var(--dsw-alias-bg-l2,#0000000d);font-weight:600}",
    ".djev-noteChoose{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}",
  ].join("");

  var CSS_TAG_ID = "dsh-jev-verify/client-card.css";
  function ensureStyles() {
    try {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="' + CSS_TAG_ID + '"]')) return;
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-jev-verify";
      tag.dataset.pluginCss = CSS_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    } catch (e) { /* styling failure must never break the card */ }
  }

  /* ------------------------------------------------------------------ *
   * Field specs. Grouped so the body reads as sections rather than a    *
   * flat list, mirroring how official cards name what each control does.*
   * ------------------------------------------------------------------ */
  var GROUPS = [
    {
      heading: "凭据",
      fields: [
        { path: "apiKey", label: "API Key", control: "secret",
          hint: "只写入本机 settings，从不回显原文；留空则沿用已存值或环境变量。" },
        { path: "apiKeyEnv", label: "凭据引用 / 环境变量名", control: "text",
          hint: "例如 TYPESAFE_API_KEY。API Key 为空时用它解析。" },
        { path: "model", label: "模型", control: "text",
          hint: "默认 jev-latest；可固定版本以获得可复现的判定。" },
        { path: "baseURL", label: "API 端点", control: "text",
          hint: "默认 https://api.typesafe.ai/v1；仅私有网关才需修改。" },
        { path: "timeoutMs", label: "单次超时（毫秒）", control: "text", numeric: true, min: 1000, max: 120000,
          hint: "默认 15000。网络慢时上调；过小会让判定被误判为失败。" },
        { path: "maxQuestionsPerCall", label: "每次最多问题数", control: "text", numeric: true, min: 1, max: 50,
          hint: "默认 25（服务端上限 50）。一次调用内并行评估，不额外计费。" },
      ],
    },
    {
      heading: "工具",
      fields: [
        { path: "enabled", label: "启用 Jev 决策工具", control: "toggle",
          hint: "注册 jev_decision / jev_overview；关闭后 Jev 完全退出会话。" },
        { path: "verifyEnabled", label: "注册 jev_verify 自检工具", control: "toggle",
          hint: "让 Agent 能对内置基准跑一次真实 API 自检并给出实测报告。" },
      ],
    },
    {
      heading: "自动护栏",
      fields: [
        { path: "autoGuard.enabled", label: "高危命令 / 循环检测走 Jev", control: "toggle",
          hint: "确定性规则先拦；不确定的命令再交给 Jev 判定风险。" },
        { path: "autoGuard.denyThreshold", label: "拒绝阈值", control: "text", numeric: true, min: 0.5, max: 1,
          hint: "0.5–1 之间。Jev 置信度达到该值即拒绝执行。" },
        { path: "autoGuard.safetyCheck", label: "高风险命令安全判定", control: "toggle",
          hint: "对 bash/pwsh/run_code 等工具的调用做执行前安全判定。" },
        { path: "autoGuard.loopCheck", label: "循环 / 停滞检测", control: "toggle",
          hint: "同一状态反复出现时注入一次纠偏提示（每会话有限次）。" },
        { path: "autoGuard.determinismFirst", label: "确定性规则优先", control: "toggle",
          hint: "明显凭据外泄等模式直接拒绝，不消耗 Jev 调用。" },
        { path: "autoGuard.tools", label: "受护栏工具名", control: "list",
          hint: "逗号分隔，例如 bash, pwsh, run_code, terminal。" },
        { path: "autoGuard.statusTool", label: "注册 jev_guard_status 状态工具", control: "toggle",
          hint: "让 Agent 随时查询护栏计数器与预算。" },
        { path: "autoGuard.maxJevCallsPerSession", label: "会话护栏预算（次 Jev 调用）", control: "text", numeric: true, min: 1, max: 1000,
          hint: "默认 50。到达上限后护栏只做确定性规则判定。" },
        { path: "autoGuard.loopConsecutive", label: "停滞判定连续次数", control: "text", numeric: true, min: 2, max: 10,
          hint: "默认 3：同一状态连续出现 3 次即提示。" },
        { path: "autoGuard.loopCooldownMs", label: "停滞提示冷却（毫秒）", control: "text", numeric: true, min: 0, max: 3600000,
          hint: "默认 60000：两次提示之间的最小间隔。" },
        { path: "autoGuard.loopMinChars", label: "停滞判定最小字符数", control: "text", numeric: true, min: 0, max: 100000,
          hint: "默认 200：短输出不参与停滞比对。" },
      ],
    },
    {
      heading: "看板",
      fields: [
        { path: "dashboard.enabled", label: "独立 /jev 网页看板", control: "toggle",
          hint: "对话内可用 jev_overview 获得同样的指标，通常无需开启。" },
        { path: "dashboard.basePath", label: "看板路径", control: "text",
          hint: "默认 /jev。启用看板后在本机浏览器打开该路径。" },
      ],
    },
  ];

  /** Field spec by path, so save() can coerce text controls to their type. */
  var FIELD_BY_PATH = {};
  GROUPS.forEach(function (g) {
    g.fields.forEach(function (f) { FIELD_BY_PATH[f.path] = f; });
  });

  function pathGet(obj, path) {
    return path.split(".").reduce(function (acc, k) {
      return acc == null ? acc : acc[k];
    }, obj);
  }

  function Chevron(props) {
    return h("svg", {
      className: "djev-chevron" + (props.open ? " djev-chevronOpen" : ""),
      viewBox: "0 0 16 16", width: "14", height: "14", "aria-hidden": "true",
      fill: "none", stroke: "currentColor", strokeWidth: "1.5",
      strokeLinecap: "round", strokeLinejoin: "round",
    }, h("path", { d: "M4 6l4 4 4-4" }));
  }

  function TextField(props) {
    var invalid = props.invalid;
    return h("div", { className: "djev-field" },
      h("div", { className: "djev-head" },
        h("label", { className: "djev-label", htmlFor: props.id }, props.label)),
      h("input", {
        id: props.id,
        className: "djev-input" + (invalid ? " djev-inputInvalid" : ""),
        type: props.secret ? "password" : "text",
        autoComplete: props.secret ? "off" : undefined,
        inputMode: props.numeric ? "numeric" : undefined,
        "aria-invalid": invalid ? true : undefined,
        value: props.value == null ? "" : String(props.value),
        disabled: props.disabled,
        placeholder: props.placeholder || "",
        onChange: function (e) { props.onChange(e.target.value); },
      }),
      h("p", { className: invalid ? "djev-invalid" : "djev-hint" },
        invalid ? props.invalidLabel : props.hint));
  }

  function ToggleField(props) {
    return h("label", { className: "djev-toggleRow" },
      h("span", { className: "djev-toggleText" },
        props.label,
        props.hint ? h("span", { className: "djev-toggleHint" }, props.hint) : null),
      h("input", {
        className: "djev-switch",
        type: "checkbox",
        checked: !!props.value,
        disabled: props.disabled,
        onChange: function (e) { props.onChange(e.target.checked); },
      }));
  }

  function JevCard(props) {
    var scope = props.scope;
    var snapshot = useSyncExternalStore(scope.subscribe.bind(scope), scope.getSnapshot.bind(scope));
    var value = (snapshot && snapshot.value) || {};
    var writable = snapshot ? !!snapshot.writable : true;

    var [open, setOpen] = useState(false);
    var [draft, setDraft] = useState(null);
    var [saving, setSaving] = useState(false);
    var [failed, setFailed] = useState(false);
    var [savedAt, setSavedAt] = useState(0);

    var dirty = draft != null && Object.keys(draft).length > 0;

    useEffect(function () {
      if (savedAt > 0) {
        var t = setTimeout(function () { setSavedAt(0); }, 3000);
        return function () { clearTimeout(t); };
      }
    }, [savedAt]);

    function current(path) {
      return draft != null && Object.prototype.hasOwnProperty.call(draft, path)
        ? draft[path]
        : pathGet(value, path);
    }
    function edit(path, val) {
      setDraft(function (prev) {
        var next = Object.assign({}, prev || {});
        next[path] = val;
        return next;
      });
      setFailed(false);
    }
    function discard() {
      setDraft(null);
      setFailed(false);
    }
    function save() {
      if (draft == null) return;
      setSaving(true);
      setFailed(false);
      var paths = Object.keys(draft);
      var chain = Promise.resolve();
      paths.forEach(function (path) {
        var field = FIELD_BY_PATH[path];
        var next = draft[path];
        // Numeric controls collect text; the config schema expects a number.
        if (field && field.numeric && typeof next === "string" && next.trim() !== "" && isFinite(Number(next))) {
          next = Number(next);
        }
        chain = chain.then(function () { return scope.set(path, next); });
      });
      chain.then(function () {
        setSaving(false);
        setDraft(null);
        setSavedAt(Date.now());
      }, function () {
        setSaving(false);
        setFailed(true);
      });
    }

    var keyConfigured = !!(value.apiKey || value.apiKeyEnv);
    /**
     * Numeric fields hold text while they are being edited, so validity is
     * checked here against the field spec (min/max from the same schema the
     * server validates with) instead of per field at the call site.
     */
    function fieldInvalid(f) {
      if (!f.numeric) return false;
      var v = current(f.path);
      if (v === undefined || v === null || v === "") return false;
      var n = Number(v);
      if (!isFinite(n)) return true;
      if (f.min != null && n < f.min) return true;
      if (f.max != null && n > f.max) return true;
      return false;
    }
    var hasInvalid = false;
    GROUPS.forEach(function (g) {
      g.fields.forEach(function (f) { if (fieldInvalid(f)) hasInvalid = true; });
    });

    function renderField(f) {
      var id = "dsh-jev-" + f.path.replace(/\./g, "-");
      if (f.control === "toggle") {
        return h(ToggleField, {
          key: f.path, label: f.label, hint: f.hint, value: !!current(f.path),
          disabled: !writable, onChange: function (v) { edit(f.path, v); },
        });
      }
      if (f.control === "list") {
        var raw = current(f.path);
        return h(TextField, {
          key: f.path, id: id, label: f.label, hint: f.hint,
          value: Array.isArray(raw) ? raw.join(", ") : raw == null ? "" : String(raw),
          disabled: !writable,
          onChange: function (v) {
            edit(f.path, v.split(/[,\s]+/).filter(function (s) { return s.length > 0; }));
          },
        });
      }
      return h(TextField, {
        key: f.path, id: id, label: f.label, hint: f.hint,
        secret: f.control === "secret", numeric: f.numeric,
        value: current(f.path), disabled: !writable,
        invalid: fieldInvalid(f),
        invalidLabel: f.path === "autoGuard.denyThreshold" ? "需为 0.5–1 之间的数值。" : "需为有效数值。",
        onChange: function (v) { edit(f.path, v); },
      });
    }

    var body = [];
    GROUPS.forEach(function (g, gi) {
      body.push(h("p", { className: "djev-group", key: "g" + gi }, g.heading));
      g.fields.forEach(function (f) { body.push(renderField(f)); });
    });

    return h("li", { className: "djev-card" + (open ? " djev-cardOpen" : "") },
      h("button", {
        type: "button",
        className: "djev-header",
        "aria-expanded": open,
        onClick: function () { setOpen(!open); },
      },
        h("span", { className: "djev-headText" },
          h("span", { className: "djev-name" }, "Jev"),
          h("span", { className: "djev-description" },
            "TypeSafe System One 决策模型：毫秒级类型化判定，用于分流、分级与风险拦截。")),
        dirty ? h("span", { className: "djev-tag" }, "未保存") : null,
        h("span", {
          className: "djev-tag" + (keyConfigured ? " djev-tagOk" : " djev-tagWarn"),
          title: keyConfigured ? "已配置凭据" : "尚未配置 Key，工具会明确报错",
        }, keyConfigured ? "已配置" : "未配置"),
        h(Chevron, { open: open })),
      open ? h("div", { className: "djev-body" },
        !writable ? h("p", { className: "djev-hint", role: "status" }, "当前部署为只读，无法保存。") : null,
        body,
        h("div", { className: "djev-footer" },
          savedAt > 0 && !failed
            ? h("p", { className: "djev-status djev-ok", role: "status" }, "已保存，立即生效（无需重启）")
            : null,
          failed
            ? h("p", { className: "djev-status djev-failed", role: "status" }, "保存失败，请查看服务端日志。")
            : null,
          h("button", {
            type: "button", className: "djev-discard",
            disabled: !dirty || saving, onClick: discard,
          }, "放弃修改"),
          h("button", {
            type: "button", className: "djev-save",
            disabled: !dirty || saving || hasInvalid || !writable, onClick: save,
          }, saving ? "保存中…" : "保存")),
        h("p", { className: "djev-note" },
          "Jev = TypeSafe System One：jev_decision（快判定）、jev_verify（自检）、jev_overview（对话内看板）。Key 只写本机 settings，绝不外发；未配置 Key 时工具与护栏会明确报错，绝不伪造结果。"))
        : null);
  }

  /* ------------------------------------------------------------------ *
   * Inline tool view: how one jev_decision / jev_overview call renders   *
   * inside a turn (slot tool.call.toolview, keyed by wire tool name).    *
   * This is the "is Jev actually working?" surface: every call shows its *
   * answers, confidence, latency and cost right where it happened.       *
   * ------------------------------------------------------------------ */

  /** Parse the JSON argument/result text a tool call carries. */
  function parseJSON(text) {
    if (typeof text !== "string" || text.length === 0) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  /**
   * Flatten a settled result's content blocks to text. Mirrors the host-side
   * renderer: text blocks verbatim, anything else as readable JSON.
   */
  function contentText(content) {
    if (!Array.isArray(content)) return "";
    var parts = [];
    for (var i = 0; i < content.length; i++) {
      var b = content[i];
      if (!b || typeof b !== "object") continue;
      if (typeof b.text === "string") parts.push(b.text);
      else if (b.type === "text" && typeof b.value === "string") parts.push(b.value);
      else {
        try { parts.push(JSON.stringify(b)); } catch (e) { /* skip */ }
      }
    }
    return parts.join("\n");
  }

  /** Confidence dot/bar tone: high confidence reads as success, low as warning. */
  function toneFor(confidence) {
    if (typeof confidence !== "number" || !isFinite(confidence)) return "";
    if (confidence >= 0.8) return " djev-barOk";
    if (confidence >= 0.5) return "";
    return " djev-barWarn";
  }

  /**
   * Read one answer's decided value and its confidence.
   *
   * Wire shapes verified against the live API (jev-1.13.0):
   *   noul   -> { type:"noul",   noul: 0.98 }            (no `confidence`; the
   *             probability IS the confidence)
   *   choice -> { type:"choice", choice:"negative", confidence:1, probabilities:{...} }
   *   score  -> { type:"score",  score:2.98, confidence:0.98, legend:{...} }
   */
  function readAnswer(a) {
    if (!a || typeof a !== "object") return { value: "—", confidence: null, legend: null };

    if (typeof a.noul === "number") {
      // Probability of "yes": report the decided side plus how sure we are.
      return { value: a.noul >= 0.5 ? "yes" : "no", confidence: a.noul, legend: null };
    }
    if (a.noul === true || a.noul === false) {
      return { value: a.noul ? "yes" : "no", confidence: typeof a.confidence === "number" ? a.confidence : null, legend: null };
    }
    if (a.choice !== undefined) {
      return { value: String(a.choice), confidence: typeof a.confidence === "number" ? a.confidence : null, legend: null };
    }
    if (a.score !== undefined) {
      // A score legend maps level -> its label; showing it is the difference
      // between "2.98" and "major (2.98)".
      var legend = a.legend && typeof a.legend === "object" ? a.legend : null;
      var label = null;
      // Prefer the probability distribution: it is the model's actual belief,
      // whereas the raw score can be fractional (2.98) and would round to a
      // different level than the distribution peaks at.
      var probs = a.probabilities && typeof a.probabilities === "object" ? a.probabilities : null;
      if (probs) {
        var bestKey = null, bestVal = -Infinity;
        Object.keys(probs).forEach(function (k) {
          var v = Number(probs[k]);
          if (isFinite(v) && v > bestVal) { bestVal = v; bestKey = k; }
        });
        if (bestKey !== null) label = bestKey;
      }
      if (label === null && legend) {
        var rounded = String(Math.round(Number(a.score)));
        if (Object.prototype.hasOwnProperty.call(legend, rounded)) label = rounded;
      }
      if (label !== null && legend && Object.prototype.hasOwnProperty.call(legend, label)) {
        label = legend[label];
      } else if (label !== null) {
        label = "level " + label;
      }
      var shown = label ? label + "（" + a.score + "）" : String(a.score);
      return { value: shown, confidence: typeof a.confidence === "number" ? a.confidence : null, legend: legend };
    }
    return { value: "—", confidence: typeof a.confidence === "number" ? a.confidence : null, legend: null };
  }

  /** One answer row: the question name, its decided value, and the confidence bar. */
  function AnswerRow(props) {
    var a = props.answer || {};
    var read = readAnswer(a);
    var conf = read.confidence;
    var pct = conf == null ? 0 : Math.max(0, Math.min(1, conf));
    return h("div", { className: "djev-ans" },
      h("div", { className: "djev-ansTop" },
        h("span", { className: "djev-ansName" }, props.name),
        h("span", { className: "djev-ansVal" }, read.value),
        conf == null ? null : h("span", { className: "djev-ansConf" },
          "置信度 " + Math.round(pct * 100) + "%")),
      conf == null ? null : h("div", { className: "djev-bar", role: "img",
        "aria-label": "confidence " + Math.round(pct * 100) + "%" },
        h("div", { className: "djev-barFill" + toneFor(conf), style: { width: (pct * 100) + "%" } })),
      a.reasoning || a.reason ? h("p", { className: "djev-ansWhy" },
        String(a.reasoning || a.reason).slice(0, 400)) : null);
  }

  /** Round a 0..1 ratio to a whole percentage, or null when unusable. */
  function pct(ratio) {
    return typeof ratio === "number" && isFinite(ratio) ? Math.round(Math.max(0, Math.min(1, ratio)) * 100) : null;
  }

  /** One labelled figure on a board view (overview / guard / verify). */
  function Stat(props) {
    return h("div", { className: "djev-stat" },
      h("span", { className: "djev-statVal" }, props.value),
      h("span", { className: "djev-statLabel" }, props.label));
  }

  /**
   * Rebuild the wire answer shape from a persisted presentation answer.
   *
   * presentationMeta stores the decided value in a tool-agnostic form
   * (noul -> the yes-probability, choice -> the chosen option, score -> the
   * number). Decoding it back into the wire shape lets both paths share
   * readAnswer/AnswerRow, so the meta card and the legacy text card can never
   * disagree about what a decision means.
   */
  function metaAnswerToWire(a) {
    if (!a || typeof a !== "object") return a;
    if (a.type === "noul" && typeof a.value === "number") return { noul: a.value };
    if (a.type === "choice") return { choice: a.value, confidence: a.confidence, probabilities: a.probabilities };
    if (a.type === "score") return { score: a.value, confidence: a.confidence, legend: a.legend, probabilities: a.probabilities };
    return Object.assign({}, a);
  }

  /** jev_decision: one row per question with its decided value and confidence. */
  function DecisionBody(props) {
    var answers = props.answers || {};
    var names = Object.keys(answers);
    if (names.length === 0) return null;
    return h("div", null, names.map(function (n) {
      return h(AnswerRow, { key: n, name: n, answer: metaAnswerToWire(answers[n]) });
    }));
  }
  /** jev_overview: status chips, aggregate stats, and the recent-activity feed. */
  function OverviewBody(props) {
    var m = props.meta || {};
    var st = m.status || {};
    var sum = m.summary || {};
    var recent = (m.recent || []).slice().reverse();
    var guards = (m.guards || []).slice().reverse();
    return h("div", null,
      h("div", { className: "djev-chips" },
        h("span", { className: "djev-chip" }, "模型 " + (st.model || "—")),
        h("span", { className: "djev-chip " + (st.keyConfigured ? "djev-chipOk" : "djev-chipWarn") },
          st.keyConfigured ? "API Key 已配置" : "API Key 未配置"),
        h("span", { className: "djev-chip " + (st.guardActive ? "djev-chipOk" : "djev-chipWarn") },
          st.guardActive ? "自动护栏已启用" : "自动护栏未启用"),
        st.denyThreshold == null ? null : h("span", { className: "djev-chip" }, "拦截阈值 " + st.denyThreshold)),
      h("div", { className: "djev-stats" },
        h(Stat, { key: "calls", value: sum.calls, label: "次判定" }),
        h(Stat, { key: "verifies", value: sum.verifies, label: "次实测" }),
        h(Stat, { key: "deny", value: sum.guardDenials, label: "次拦截" }),
        h(Stat, { key: "adv", value: sum.guardAdvisories, label: "次提示" }),
        h(Stat, { key: "med", value: sum.medianLatencyMs == null ? "—" : sum.medianLatencyMs + " ms", label: "中位延迟" }),
        h(Stat, { key: "conf", value: sum.avgConfidence == null ? "—" : pct(sum.avgConfidence) + "%", label: "平均置信度" }),
        h(Stat, { key: "tok", value: sum.totalInputTokens, label: "input tokens" }),
        h(Stat, { key: "cost", value: "$" + Number(sum.totalCostUs || 0).toFixed(6), label: "累计成本" })),
      recent.length ? h("p", { className: "djev-ansWhy" }, "最近调用（新→旧）") : null,
      recent.map(function (e, i) {
        return h("div", { key: "r" + i, className: "djev-recent" },
          h("span", { className: "djev-tvDot " + (e.kind === "guard" ? "djev-tvDotErr" : "djev-tvDotOk") }),
          h("span", { className: "djev-recentMain" },
            e.kind === "decision"
              ? (e.questions || []).map(function (q) {
                  return q.name + "=" + (q.value == null ? "—" : q.value)
                    + (typeof q.confidence === "number" ? "（" + pct(q.confidence) + "%）" : "");
                }).join("、")
              : e.kind === "guard" ? (e.action + " · " + (e.detail || "")) : (e.report || "")),
          e.ts ? h("span", { className: "djev-recentTs" }, String(e.ts).slice(11, 19)) : null);
      }),
      guards.length ? h("p", { className: "djev-ansWhy" }, "护栏事件（新→旧）") : null,
      guards.map(function (g, i) {
        return h("div", { key: "g" + i, className: "djev-recent" },
          h("span", { className: "djev-tvDot djev-tvDotErr" }),
          h("span", { className: "djev-recentMain" }, (g.action || "?") + " · " + (g.detail || "")),
          g.ts ? h("span", { className: "djev-recentTs" }, String(g.ts).slice(11, 19)) : null);
      }));
  }

  /** jev_guard_status: whether the guard is armed, and what it has done. */
  function GuardBody(props) {
    var m = props.meta || {};
    var s = m.safety || {};
    var l = m.loop || {};
    return h("div", null,
      h("div", { className: "djev-chips" },
        h("span", { className: "djev-chip " + (m.enabled ? "djev-chipOk" : "djev-chipWarn") },
          m.enabled ? "护栏运行中" : "护栏未启用"),
        h("span", { className: "djev-chip" }, "拦截阈值 " + (m.denyThreshold == null ? "—" : m.denyThreshold)),
        h("span", { className: "djev-chip" }, "本会话剩余预算 " + (m.budgetRemaining == null ? "—" : m.budgetRemaining))),
      h("div", { className: "djev-stats" },
        h(Stat, { key: "checks", value: s.checks, label: "次安全判定" }),
        h(Stat, { key: "jev", value: s.jevCalls, label: "次 Jev 调用" }),
        h(Stat, { key: "denied", value: s.denied, label: "次拦截" }),
        h(Stat, { key: "det", value: s.deterministicDenied, label: "次规则拦截" }),
        h(Stat, { key: "audit", value: s.auditCalls, label: "次执行审计" }),
        h(Stat, { key: "loop", value: l.checks, label: "次循环检查" }),
        h(Stat, { key: "injected", value: l.injected, label: "次停滞提示" })),
      (m.tools || []).length
        ? h("p", { className: "djev-ansWhy" }, "受护栏工具：" + m.tools.join("、"))
        : h("p", { className: "djev-ansWhy" }, "受护栏工具：（未武装 — 检查 autoGuard.enabled 与工具名清单）"),
      s.lastSeenTool ? h("p", { className: "djev-ansWhy" }, "最近工具：" + s.lastSeenTool) : null,
      h("p", { className: "djev-tvFoot" },
        h("span", null, m.enabled ? "每次高风险调用都先经 Jev 判定，记录可审计" : "启用 autoGuard 后，高风险调用会先经 Jev 判定")));
  }
  /** jev_verify: the measured benchmark numbers, or an honest "not run". */
  function VerifyBody(props) {
    var m = props.meta || {};
    if (m.verified !== true) {
      return h("p", { className: "djev-tvState" }, m.reason || "验证未运行 — 未配置 API Key，不伪造结果。");
    }
    var failures = m.failures || [];
    return h("div", null,
      h("div", { className: "djev-chips" },
        h("span", { className: "djev-chip djev-chipOk" }, "实测数据"),
        h("span", { className: "djev-chip" }, "模型 " + (m.model || "—")),
        h("span", { className: "djev-chip" }, m.questionCount + " 题 / " + m.caseCount + " 用例")),
      h("div", { className: "djev-stats" },
        h(Stat, { key: "acc", value: m.accuracy == null ? "—" : pct(m.accuracy) + "%", label: "准确率" }),
        h(Stat, { key: "ok", value: m.correct + "/" + m.questionCount, label: "答对" }),
        h(Stat, { key: "hc", value: m.highConfidenceAccuracy == null ? "—" : pct(m.highConfidenceAccuracy) + "%", label: "高置信准确率" }),
        h(Stat, { key: "med", value: m.medianMs + " ms", label: "中位延迟" }),
        h(Stat, { key: "p95", value: m.p95Ms + " ms", label: "p95 延迟" }),
        h(Stat, { key: "tok", value: m.inputTokens, label: "input tokens" }),
        h(Stat, { key: "cost", value: m.estimatedUsd == null ? "—" : "$" + Number(m.estimatedUsd).toFixed(6), label: "成本" })),
      failures.length ? h("p", { className: "djev-ansWhy" }, "误判用例：") : null,
      failures.map(function (f, i) {
        return h("p", { key: "f" + i, className: "djev-tvState" },
          (f.caseId ? f.caseId + "/" : "") + f.question + "：期望 " + JSON.stringify(f.expected)
            + "，实得 " + JSON.stringify(f.actual)
            + (f.confidence == null ? "" : "（置信度 " + pct(f.confidence) + "%）"));
      }),
      m.ranAt ? h("p", { className: "djev-tvFoot" }, h("span", null, "实测时间 " + m.ranAt)) : null);
  }
  /** jev_choose: ranked candidate table with the recommended pick highlighted. */
  function ChooseBody(props) {
    var m = props.meta || {};
    var ranking = m.ranking || [];
    var rows = ranking.map(function (r) {
      return h("tr", { key: r.index, className: r.index === m.recommended ? "djev-rowRec" : null },
        h("td", { className: "djev-tdIdx" }, "#" + r.index),
        h("td", { className: "djev-tdLabel" }, r.label),
        h("td", null, r.fit == null ? "—" : r.fit + "/3"),
        h("td", null, r.risk == null ? "—" : Math.round(r.risk * 100) + "%"),
        h("td", null, r.composite == null ? "—" : Math.round(r.composite * 100) + "%"),
        h("td", null, r.confidence == null ? "—" : pct(r.confidence) + "%"));
    });
    var rec = m.recommended == null ? null : (ranking[m.recommended] || null);
    return h("div", null,
      ranking.length
        ? h("table", { className: "djev-table" },
            h("thead", null, h("tr", null,
              h("th", null, "#"), h("th", null, "候选方案"),
              h("th", null, "契合"), h("th", null, "风险"),
              h("th", null, "综合"), h("th", null, "置信"))),
            h("tbody", null, rows))
        : h("p", { className: "djev-tvState" }, m.reason || "（无评分数据）"),
      rec ? h("p", { className: "djev-noteChoose" },
          "推荐：#" + rec.index + " " + rec.label + " — Jev 只做特征打分，最终判断由你综合做出")
        : null,
      h("p", { className: "djev-tvFoot" },
        h("span", null, (m.optionCount || 0) + " 个候选"),
        h("span", null, "结构化结果（presentationMeta）")));
  }
  /**
   * The inline view for one Jev tool call.
   *
   * Two ways in, one shape out:
   *   1. Preferred — block.meta, the tool's own presentation payload persisted
   *      on tool/result (dsh-tools ToolResult.meta). It is already structured,
   *      so the card renders without re-parsing anything.
   *   2. Legacy — hosts without presentationMeta only carry the human-readable
   *      render text; that path parses it as JSON when it can.
   *
   * Running calls show what was asked; settled calls show real figures.
   */
  function JevToolView(props) {
    var block = props.block || {};
    var isResult = block.kind === "tool-result";
    var running = !isResult;
    var isError = !!(isResult && block.isError);
    var toolName = props.toolName || (block.call && block.call.toolName) || "";

    // Running calls carry argsRaw on the block itself; settled ones nest it
    // under block.call (backfilled from the in-window tool/call).
    var argsRaw = (block.call && block.call.argsRaw) || block.argsRaw || "";
    var args = parseJSON(argsRaw) || {};
    // The tool's wire schema takes `questions` as an ARRAY of {name,type,...}
    // (the host converts it to the API's dictionary form), so normalize both
    // shapes here and keep the question name alongside each entry.
    var questions = [];
    var rawQuestions = args.questions;
    if (Array.isArray(rawQuestions)) {
      questions = rawQuestions.filter(function (q) { return q && typeof q === "object"; });
    } else if (rawQuestions && typeof rawQuestions === "object") {
      Object.keys(rawQuestions).forEach(function (k) {
        var q = rawQuestions[k];
        if (q && typeof q === "object") questions.push(Object.assign({ name: k }, q));
      });
    }
    var state = typeof args.state === "string" ? args.state : "";
    var optCount = Array.isArray(args.options) ? args.options.length : 0;

    var resultText = isResult ? contentText(block.content) : "";
    // Preferred structured path (see the header comment).
    var view = isResult && block.meta && typeof block.meta === "object" && typeof block.meta.kind === "string"
      ? block.meta : null;
    var payload = parseJSON(resultText);
    var answers = view && view.kind === "decision" && view.answers ? view.answers
      : payload && payload.answers ? payload.answers : null;
    var answerNames = answers ? Object.keys(answers) : [];
    var kind = view ? view.kind : answerNames.length > 0 ? "decision" : "text";
    var sum = view && view.summary ? view.summary : {};

    // `__forceOpen` is a test-only escape hatch: the offline render tests mount
    // this view as static markup, where click state cannot be driven. It never
    // affects the shipped behaviour (the slot passes no such prop).
    var [open, setOpen] = useState(props.__forceOpen === true);
    var [showState, setShowState] = useState(false);

    var dot = running ? " djev-tvDotRun" : isError ? " djev-tvDotErr" : " djev-tvDotOk";
    var label = running
      ? (toolName === "jev_choose" ? "Jev 方案选型中…" : toolName === "jev_verify" ? "Jev 实测中…" : toolName === "jev_overview" ? "读取 Jev 总览…"
        : toolName === "jev_guard_status" ? "读取护栏状态…" : "Jev 判定中…")
      : isError ? "Jev 调用失败"
      : kind === "overview" ? "Jev 调用总览"
      : kind === "guard" ? "Jev 护栏状态"
      : kind === "verify" ? "Jev 实测验证"
      : kind === "choose" ? "Jev 方案选型"
      : "Jev 判定完成";

    // Header chips: the numbers that matter for this kind of call.
    var chips = [];
    if (running) chips.push((optCount ? optCount + " 个候选" : questions.length + " 个问题"));
    else if (kind === "decision") {
      var ms = view ? view.latencyMs : payload && payload.latencyMs;
      var cost = view ? view.estimatedCostUs : payload && payload.estimatedCostUs;
      var model = view ? view.model : payload && payload.model;
      if (typeof ms === "number") chips.push(Math.round(ms) + " ms");
      if (typeof cost === "number") chips.push("$" + cost.toFixed(6));
      if (model) chips.push(String(model));
    } else if (kind === "choose") {
      var ms2 = view ? view.latencyMs : payload && payload.latencyMs;
      var cost2 = view ? view.estimatedCostUs : payload && payload.estimatedCostUs;
      var model2 = view ? view.model : payload && payload.model;
      if (typeof ms2 === "number") chips.push(Math.round(ms2) + " ms");
      if (typeof cost2 === "number") chips.push("$" + cost2.toFixed(6));
      if (model2) chips.push(String(model2));
    } else if (kind === "overview") {
      chips.push(sum.calls + " 次判定");
      if (sum.guardDenials) chips.push(sum.guardDenials + " 次拦截");
      chips.push("$" + Number(sum.totalCostUs || 0).toFixed(6));
    } else if (kind === "guard") {
      chips.push(view.enabled ? "已启用" : "未启用");
      if (view.denyThreshold != null) chips.push("阈值 " + view.denyThreshold);
    } else if (kind === "verify") {
      chips.push(view.verified === true ? "实测准确率 " + (view.accuracy == null ? "—" : pct(view.accuracy) + "%") : "未运行");
    }

    return h("div", { className: "djev-tv", "data-dsh-jev-toolview": "1", "data-dsh-jev-kind": kind },
      h("button", {
        type: "button", className: "djev-tvHead", "aria-expanded": open,
        onClick: function () { setOpen(!open); },
      },
        h("span", { className: "djev-tvDot" + dot }),
        h("span", { className: "djev-tvTitle" }, label),
        chips.length ? h("span", { className: "djev-tvMeta" }, chips.join(" · ")) : null,
        h(Chevron, { open: open })),
      open ? h("div", { className: "djev-tvBody" },
        kind === "decision" && state
          ? h("div", null,
              h("p", { className: "djev-ansWhy" },
                "判定输入" + (state.length > 90 ? "（前 90 字）" : "")),
              h("p", { className: "djev-tvState" },
                showState ? state : state.slice(0, 90) + (state.length > 90 ? "…" : "")),
              state.length > 90
                ? h("button", {
                    type: "button", className: "djev-discard",
                    style: { padding: "2px 10px", fontSize: "12px" },
                    onClick: function () { setShowState(!showState); },
                  }, showState ? "收起" : "展开全文")
                : null)
          : null,

        running
          ? h("p", { className: "djev-ansWhy" },
              questions.length
                ? "已提交 " + questions.length + " 个问题："
                  + questions.map(function (q) { return q && q.name; }).filter(Boolean).join("、")
                : "等待 Jev 返回…")
          : null,

        isError ? h("p", { className: "djev-tvState" }, resultText || "（无错误详情）") : null,

        !running && !isError && kind === "overview" ? h(OverviewBody, { meta: view }) : null,
        !running && !isError && kind === "guard" ? h(GuardBody, { meta: view }) : null,
        !running && !isError && kind === "verify" ? h(VerifyBody, { meta: view }) : null,
        !running && !isError && kind === "decision" ? h(DecisionBody, { answers: answers }) : null,
        !running && !isError && kind === "choose" ? h(ChooseBody, { meta: view }) : null,

        !running && !isError && kind === "decision" && answerNames.length === 0 && questions.length > 0
          ? h("div", null, questions.map(function (q, i) {
              return h("p", { key: i, className: "djev-ansWhy" },
                (q && q.name ? q.name + " — " : "") + (q && q.instructions ? q.instructions : ""));
            }))
          : null,

        !running && !isError && kind === "text"
          ? h("p", { className: "djev-tvState" }, resultText.slice(0, 1200) || "（无输出）")
          : null,

        !running && !isError && (kind === "decision" || kind === "choose")
          ? h("p", { className: "djev-tvFoot" },
              h("span", null, ((view && view.inputTokens)
                || (payload && payload.usage && payload.usage.input_tokens) || 0) + " input tokens"),
              h("span", null, view ? "结构化结果（presentationMeta）" : "真实 API 调用，可审计"))
          : null)
        : null);
  }
  /**
   * Register the legacy plugin-configuration card.
   *
   * The caller supplies the bound scope because the service is requested
   * conditionally (see apply): dsh >= 0.1.7 ships no `settingsScope` and no
   * `settings.plugin.item` slot, so this card is a no-op there.
   */
  function registerCard(ctx, scope) {
    ctx.slots.inject("settings.plugin.item", function* () {
      yield ctx.slots.register(
        {
          name: "settings.plugin.item",
          key: NS,
          // No `hooks` face: hook sources must be observable objects
          // ({ getSnapshot, subscribe }); a primitive here makes the renderer's
          // observableHook throw "Invalid value used as weak map key" and the
          // whole entry dies before the card is painted. The card reads its
          // config through its own settingsScope binding instead.
          inject: function () { return {}; },
        },
        function JevSlot() {
          return h(JevCard, { scope: scope });
        },
      );
    });
  }

  /**
   * Own how Jev's calls render inside a turn. The slot is keyed by wire tool
   * name, so registering the names below takes over exactly those calls and
   * leaves every other tool on the generic row.
   */
  function registerToolViews(ctx) {
    ctx.slots.inject("tool.call.toolview", function* () {
      var names = ["jev_decision", "jev_choose", "jev_overview", "jev_guard_status", "jev_verify"];
      for (var i = 0; i < names.length; i++) {
        yield ctx.slots.register(
          {
            name: "tool.call.toolview",
            key: names[i],
            inject: function () { return {}; },
          },
          JevToolView,
        );
      }
    });
  }

  function apply(ctx) {
    var registered = [];
    /** Publish what actually registered, so a missing surface is diagnosable. */
    function mark() {
      try {
        document.documentElement.setAttribute("data-dsh-jev-card", "registered:" + (registered.join("+") || "none"));
      } catch (e) { /* ignore */ }
    }
    try {
      // Styles are cosmetic: a failure here must never cost any surface.
      try { ensureStyles(); } catch (e) { /* ignore */ }

      // The inline tool view must survive EVERY deployment: the
      // `tool.call.toolview` slot exists in both client generations. Register it
      // first, in its own quarantine — a failure in the legacy settings card
      // used to abort apply() before this ran, which silently removed the tool
      // view on hosts where the card could not register.
      try { registerToolViews(ctx); registered.push("toolview"); } catch (e) { /* ignore */ }
      mark();

      // The legacy card needs BOTH the slot and the `settingsScope` service.
      // dsh >= 0.1.7 ships neither (an entry-owned auto form replaces the card),
      // so request the service conditionally: a required-but-absent service
      // would leave this whole plugin unapplied, tool view included.
      try {
        ctx.inject(["settingsScope"], function (scoped) {
          try {
            var face = scoped.settingsScope;
            if (!face || typeof face.bind !== "function") return;
            registerCard(scoped, face.bind({ namespace: NS }));
            registered.push("card");
            mark();
          } catch (e) { /* card is optional */ }
        });
      } catch (e) { /* host without conditional injection */ }

      // Diagnostics: the describe mirror only exists on the generation that has
      // the service. On the newer generation the entry-owned form is used, and
      // there is nothing to mirror.
      try {
        var scopeFace = typeof ctx.get === "function" ? ctx.get("settingsScope") : undefined;
        if (!scopeFace || typeof scopeFace.describe !== "function") {
          document.documentElement.setAttribute("data-dsh-jev-ns", JSON.stringify({ mode: "entry-form", ns: NS }));
        } else {
          var mirror = scopeFace.describe();
          var snap = mirror && mirror.getSnapshot ? mirror.getSnapshot() : null;
          var view = snap && snap.view ? snap.view : null;
          var names = view && view.namespaces ? view.namespaces.map(function (v) { return v && v.ns ? v.ns : v; }) : [];
          document.documentElement.setAttribute("data-dsh-jev-ns", JSON.stringify({ mode: "scoped", status: snap && snap.status, names: names, hasJev: names.indexOf(NS) >= 0 }).slice(0, 300));
        }
      } catch (e) {
        try { document.documentElement.setAttribute("data-dsh-jev-ns", "err: " + String(e && e.message ? e.message : e).slice(0, 200)); } catch (e2) { /* ignore */ }
      }
    } catch (error) {
      try {
        try {
          document.documentElement.setAttribute("data-dsh-jev-card", "failed: " + String(error && error.message ? error.message : error));
          var banner = document.createElement("div");
          banner.setAttribute("data-dsh-jev-banner", "1");
          banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#f85149;color:#fff;font:13px/1.5 monospace;padding:8px 12px;white-space:pre-wrap";
          banner.textContent = "[dsh-jev-verify 客户端卡片注册失败] " + String(error && error.stack ? error.stack : error);
          (document.body || document.documentElement).appendChild(banner);
        } catch (e) { /* ignore */ }
        if (globalThis.console && console.error) console.error("[dsh-jev-verify] card registration failed (please report):", error);
        ctx.logger && ctx.logger.warn("[dsh-jev-verify] client card registration failed: " + String(error));
      } catch (e) {
        /* never break the GUI */
      }
    }
  }

  module.exports = {
    // Only `slots` is required. `settingsScope` is requested conditionally in
    // apply(): dsh >= 0.1.7 does not provide it, and requiring it there would
    // keep the entire client plugin (tool view included) from applying.
    inject: ["slots"],
    apply: apply,
    name: "jev-verify",
    // Internal, for the offline render tests only: decoding the wire answer
    // shapes is the part of this bundle most worth pinning down, and it needs
    // no DOM. Not part of the plugin's service surface.
    __internal: { readAnswer: readAnswer, contentText: contentText, parseJSON: parseJSON },
  };
  return module.exports;
}});
