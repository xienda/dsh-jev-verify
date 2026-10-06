## What

Refreshes the entry for `xienda/dsh-jev-verify` to match the plugin as of **v0.8.2** (npm). One file changes:
`data/plugins/xienda__dsh-jev-verify.yml` — no other entry is touched.

v0.8.2 fixes the plugin's own board path and adds a lightweight usage surface, and the entry now describes
both.

- **`/jev` no longer returns the host's 404.** Two causes, both fixed: the board only registered its routes
  when `dashboard.enabled === true` (default `false`), and `dashboard.basePath` was used verbatim, so a
  configured value of `jev` registered a literal path `jev` that no browser request matched. Paths are now
  normalized (leading slash added, trailing slashes trimmed, empty or `/` falls back to `/jev`) and both
  `/jev` and `/jev/` are registered.
- **The board being off is no longer a dead end.** `/jev` answers 200 with a server-rendered, JS-free status
  page — today's calls, cost, this instance, tokens, latency, quota state — that points at the composer pill
  and explains how to enable the full board.
- **A read-only `/jev/api/usage` JSON route always mounts** (independent of `dashboard.enabled`) and projects
  the same locally measured snapshot the `jev_usage` tool returns.
- **A compact composer usage pill** (`conversation.input.right`, beside the submit button), shaped after
  `dsh-opencode-go`: `Jev · 今日 29 次 · $0.000534` with a warn/danger tone dot, expanding into a 270 px
  popover with today's calls and cost against their limits, this instance's calls, today's tokens, median and
  p95 latency, guard denials, the top three tools, time to reset, the last refresh and a manual refresh. It
  refreshes every 60 s and on tab focus, falls back to the full board API when the pill route is absent, and
  degrades to `Jev · 额度不可用` with the exact error — never throwing, and never claiming a vendor balance.

`url`, `name` and `category` are unchanged, and every earlier claim (two-tier position-aware guard, always-on
ledger, concurrency-6 verification, usage/quota panel with its stated boundary, measured latency bands, the
0.8.1 settings-card fix) stays exactly as written.

## Why

A documented configuration path that answers 404 is a broken surface, not a cosmetic one — and the request
behind this release was explicitly for a small, lightweight usage readout, not a standalone page. The entry
should describe what a user actually gets: a path that always answers, and a pill by the composer that shows
locally measured usage at a glance.

## Verification of the claims

- `npm test` → **29/29 passing** (2470 ms). `test/dashboard.test.mjs` (rewritten) asserts the exact route
  table with the board on, off and on a custom `basePath`, the normalizer's six inputs (including `/` and
  `///`, which fall back to `/jev`), the pill payload's fields, and a throwing snapshot that still yields
  HTTP 200 with `ok:false`. `test/boot.test.mjs` asserts five registered routes and the board-off trio.
  `test/client.test.mjs` PASS 6 asserts the pill's three input shapes, its label and tone states, and the
  rendered popover text, plus the `conversation.input.right` registration.
- The pill's popover text under the sample snapshot is asserted verbatim in the suite, for example
  `今日调用 29 / 200 次`, `今日成本 $0.000534 / $0.50`, `中位 933 ms` and `本机实测，非账户余额`.
- The 0.7.5 live benchmark (96.3%, 26/27, median 282 ms, p95 1468 ms, ≈$0.000365) is unaffected by this
  release.

Update to an existing entry, submitted by the plugin author.