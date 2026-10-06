# dsh-jev-verify v0.8.2

**The board path stops 404ing, and the usage panel becomes a small pill by the composer.**

## What was wrong

Opening `http://127.0.0.1:3080/jev` returned the host's plain 404 page. Two independent mistakes:

1. **The routes were never mounted.** The board only registered itself when `dashboard.enabled === true`,
   and that option defaults to `false` — so the path a user had configured (`dashboard.basePath: jev`)
   existed nowhere.
2. **The path was not normalized.** `basePath` was used verbatim, so the value `jev` registered the literal
   path `jev`; a browser asks for `/jev`, which never matched. The trailing-slash form `/jev/` was not
   registered either.

And the panel the board showed was the wrong shape for the request: a full standalone page is not a
lightweight usage readout next to the input box.

## What changed

- **`basePath` is normalized** (`normalizeBasePath()`: trim, add a leading slash, trim trailing slashes, fall
  back to `/jev` for an empty value or a bare slash) and **both `base` and `base + "/"` are registered**.
- **`/jev` never 404s.** With `dashboard.enabled: false` the path now answers 200 with a server-rendered,
  JS-free status page (today's calls, today's cost, this plugin instance, today's tokens, median latency,
  quota state) that points at the composer pill and explains how to turn the full board on.
- **`/jev/api/usage` always mounts** — a small read-only JSON projection of the same locally measured
  snapshot `jev_usage` returns, with an honest `{ok:false, error}` body (still HTTP 200) when the snapshot
  fails. It does not wait for `dashboard.enabled`.
- **A composer usage pill** in the `conversation.input.right` slot (beside the submit button), modeled on
  `dsh-opencode-go`: `Jev · 今日 29 次 · $0.000534` with a warn/danger tone dot, expanding into a 270 px
  popover — today's calls and cost against their limits, this instance's calls, today's tokens, median and
  p95 latency, guard denials, the top three tools, time to reset, the last refresh and a manual refresh.
  It polls every 60 s and on tab focus, falls back to the full board API when the pill route is absent, and
  degrades to `Jev · 额度不可用` carrying the exact error. It never throws, and it reports local measurements
  only — never a vendor balance.

## Verification

- `test/dashboard.test.mjs` (rewritten, 10 assertions): the exact route table with the board on
  (`/jev`, `/jev/`, `/jev/api/usage`, `/jev/api`, `/jev/api/try`), with it off (three routes, `/jev` a 200
  status page), and on a custom `basePath: "/custom/"` (six routes, still the full board); the normalizer on
  six inputs including `/` and `///` (which fall back to `/jev` so the root is never hijacked); the pill
  payload's fields with no `roll` key; and a throwing snapshot still yielding 200 plus `ok:false`.
- `test/boot.test.mjs`: five routes registered, and with `dashboard: {enabled:false}` the `/jev` and
  `/jev/api/usage` routes exist while `/jev/api/try` does not.
- `test/client.test.mjs` PASS 6: the pill payload's three input shapes and three junk inputs, four label
  states, five tone states, both popover states by text, the slot registration (`id`, `order`, `name`) and
  the rendered fallback label.
- `npm test` → **29/29 passing** (2470 ms).

Nothing else changed: six tools, the two guard tiers, the prompt section, the settings card fix, the
usage/quota accounting and every measured number from 0.7.5 / 0.8.0 / 0.8.1 are exactly as published.

## Upgrading

`npm i dsh-jev-verify@0.8.2`. The server half (routes, normalizer, status page) needs a harness restart; the
client half (the pill) only needs a page refresh — the host's `client-hmr` row stat-polls client bundles and
re-hashes them within 500 ms.