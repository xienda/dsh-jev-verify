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
  globalThis.__DSH_JEV_CLIENT_VERSION__ = "0.5.0";
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
    ".djev-tvFoot{border-top:.5px solid var(--dsw-alias-border-l2);display:flex;gap:12px;flex-wrap:wrap;padding:8px 12px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}",
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
        { path: "autoGuard.denyThreshold", label: "拒绝阈值", control: "text", numeric: true,
          hint: "0.5–1 之间。Jev 置信度达到该值即拒绝执行。" },
      ],
    },
    {
      heading: "看板",
      fields: [
        { path: "dashboard.enabled", label: "独立 /jev 网页看板", control: "toggle",
          hint: "对话内可用 jev_overview 获得同样的指标，通常无需开启。" },
      ],
    },
  ];

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
        chain = chain.then(function () { return scope.set(path, draft[path]); });
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
    var threshold = current("autoGuard.denyThreshold");
    var thresholdInvalid = (function () {
      if (threshold === undefined || threshold === null || threshold === "") return false;
      var n = Number(threshold);
      return !isFinite(n) || n < 0.5 || n > 1;
    })();

    function renderField(f) {
      var id = "dsh-jev-" + f.path.replace(/\./g, "-");
      if (f.control === "toggle") {
        return h(ToggleField, {
          key: f.path, label: f.label, hint: f.hint, value: !!current(f.path),
          disabled: !writable, onChange: function (v) { edit(f.path, v); },
        });
      }
      var invalid = f.path === "autoGuard.denyThreshold" ? thresholdInvalid : false;
      return h(TextField, {
        key: f.path, id: id, label: f.label, hint: f.hint,
        secret: f.control === "secret", numeric: f.numeric,
        value: current(f.path), disabled: !writable,
        invalid: invalid, invalidLabel: "需为 0.5–1 之间的数值。",
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
            disabled: !dirty || saving || thresholdInvalid || !writable, onClick: save,
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

  /**
   * The inline view for one Jev tool call. Running calls show what was asked;
   * settled calls show the parsed answers with confidence, plus latency/cost.
   */
  function JevToolView(props) {
    var block = props.block || {};
    var isResult = block.kind === "tool-result";
    var running = !isResult;
    var isError = !!(isResult && block.isError);

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

    // The settled result text is the tool's rendered text block; parse it back
    // into the structured payload when it is JSON, else keep it verbatim.
    var resultText = isResult ? contentText(block.content) : "";
    var payload = parseJSON(resultText);
    var answers = payload && payload.answers ? payload.answers : null;
    var answerNames = answers ? Object.keys(answers) : [];

    // `__forceOpen` is a test-only escape hatch: the offline render tests mount
    // this view as static markup, where click state cannot be driven. It never
    // affects the shipped behaviour (the slot passes no such prop).
    var [open, setOpen] = useState(props.__forceOpen === true);
    var [showState, setShowState] = useState(false);

    var dot = running ? " djev-tvDotRun" : isError ? " djev-tvDotErr" : " djev-tvDotOk";
    var label = running ? "Jev 判定中…"
      : isError ? "Jev 调用失败"
      : "Jev 判定完成";

    var meta = [];
    if (running) meta.push(questions.length + " 个问题");
    else if (payload && typeof payload.latencyMs === "number") meta.push(Math.round(payload.latencyMs) + " ms");
    if (payload && typeof payload.estimatedCostUs === "number")
      meta.push("$" + payload.estimatedCostUs.toFixed(6));
    if (payload && payload.model) meta.push(String(payload.model));

    var canShowAnswers = answerNames.length > 0;

    return h("div", { className: "djev-tv", "data-dsh-jev-toolview": "1" },
      h("button", {
        type: "button", className: "djev-tvHead", "aria-expanded": open,
        onClick: function () { setOpen(!open); },
      },
        h("span", { className: "djev-tvDot" + dot }),
        h("span", { className: "djev-tvTitle" }, label),
        meta.length ? h("span", { className: "djev-tvMeta" }, meta.join(" · ")) : null,
        h(Chevron, { open: open })),
      open ? h("div", { className: "djev-tvBody" },
        state
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
                ? "已提交 " + questions.length + " 个问题：" + questions.map(function (q) { return q && q.name; }).filter(Boolean).join("、")
                : "等待 Jev 返回…")
          : null,

        isError
          ? h("p", { className: "djev-tvState" }, resultText || "（无错误详情）")
          : null,

        !running && !isError && canShowAnswers
          ? h("div", null, answerNames.map(function (n) {
              return h(AnswerRow, { key: n, name: n, answer: answers[n] });
            }))
          : null,

        !running && !isError && !canShowAnswers && questions.length > 0
          ? h("div", null, questions.map(function (q, i) {
              return h("p", { key: i, className: "djev-ansWhy" },
                (q && q.name ? q.name + " — " : "") + (q && q.instructions ? q.instructions : ""));
            }))
          : null,

        !running && !isError && answerNames.length === 0 && !questions.length
          ? h("p", { className: "djev-tvState" }, resultText.slice(0, 1200) || "（无输出）")
          : null,

        !running && !isError && payload && answerNames.length > 0
          ? h("p", { className: "djev-tvFoot" },
              payload.usage && typeof payload.usage.input_tokens === "number"
                ? h("span", null, payload.usage.input_tokens + " input tokens")
                : null,
              h("span", null, "真实 API 调用，可审计"))
          : null)
        : null);
  }

  function registerCard(ctx) {
    var scope = ctx.settingsScope.bind({ namespace: NS });
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
      var names = ["jev_decision", "jev_overview", "jev_guard_status", "jev_verify"];
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
    try {
      // Styles are cosmetic: a failure here must never cost the user the card.
      try { ensureStyles(); } catch (e) { /* ignore */ }
      registerCard(ctx);
      // The inline tool view is additive: if it cannot register (an older
      // deployment without the tool slot), the settings card must still work.
      try { registerToolViews(ctx); } catch (e) { /* ignore */ }
      try {
        document.documentElement.setAttribute("data-dsh-jev-card", "registered");
      } catch (e) { /* ignore */ }
      try {
        var mirror = ctx.settingsScope.describe();
        var snap = mirror && mirror.getSnapshot ? mirror.getSnapshot() : null;
        var view = snap && snap.view ? snap.view : null;
        var names = view && view.namespaces ? view.namespaces.map(function (v) { return v && v.ns ? v.ns : v; }) : [];
        document.documentElement.setAttribute("data-dsh-jev-ns", JSON.stringify({ status: snap && snap.status, names: names, hasJev: names.indexOf(NS) >= 0 }).slice(0, 300));
      } catch (e) {
        document.documentElement.setAttribute("data-dsh-jev-ns", "err: " + String(e && e.message ? e.message : e).slice(0, 200));
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
    inject: ["slots", "settingsScope"],
    apply: apply,
    name: "jev-verify",
    // Internal, for the offline render tests only: decoding the wire answer
    // shapes is the part of this bundle most worth pinning down, and it needs
    // no DOM. Not part of the plugin's service surface.
    __internal: { readAnswer: readAnswer, contentText: contentText, parseJSON: parseJSON },
  };
  return module.exports;
}});
