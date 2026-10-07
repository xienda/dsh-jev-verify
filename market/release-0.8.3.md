# dsh-jev-verify v0.8.3

**Settings you save now actually reach the plugin.**

## What was wrong

Saving a value in Settings → Plugins → Jev reported success and changed nothing. The card sent the
field name straight to `scope.set(field)`, and that call stores `path: [field]` — a single
segment. A field such as `dashboard.basePath` was therefore written into the settings document as one
literal key named `dashboard.basePath`, which no schema resolves, so the value was stored and then
ignored by every reader.

Found on a live host, not by inspection: after the 0.8.2 restart the settings document was read over the
`settings/describe` RPC and its `user` layer held two literal keys —
`"autoGuard.maxJevCallsPerSession": 60` and `"dashboard.basePath": "jev"` — while the resolved document
still showed the schema defaults (`50` and `/jev`). The card had lied politely for several releases.

The same read confirmed that the 0.8.1 fix is live: the decoded value has no empty-object paths and
carries `apiKeyEnv: "TYPESAFE_API_KEY"`.

## What changed

- **Nested writes.** The card builds `{ op: "set", path: [<segment>, …] }` operations and commits them
  in a single atomic `scope.mutate(ops)` call. Hosts that expose no `mutate` still get the old chained
  `scope.set` fallback, so nothing regresses on older harness builds.
- **Repair on open.** A one-time mount effect rewrites documents written by <= 0.8.2 that contain literal
  dotted keys: for each one it sets the nested path and unsets the literal key, all inside one atomic
  mutation. A `WeakSet` makes it run once per settings scope, and the whole effect is wrapped, so a
  failed repair can never break the card.
- **Client-only.** Refresh the page; no harness restart is required.

## Verification

- `test/client.test.mjs` PASS 7: path splitting, the generated operations (including numeric coercion),
  exactly one atomic repair mutation with the expected operation order, no repeat on a second render, and
  zero writes for a clean document.
- `npm test` → **29/29 passing** (2725.8 ms); `node --check client/client.js` clean.
- Live evidence (2026-10-07): the running host's `/jev` answered 200 with the status page and
  `/jev/api/usage` answered 200 with the pill payload; the served client bundle already carried 0.8.2,
  confirming that a page refresh is enough for the client half.

Nothing else changed: six tools, the two guard tiers, the prompt section, the usage/quota accounting, the
`/jev` status page and pill, and every measured number from 0.7.5 / 0.8.0 / 0.8.1 / 0.8.2 stand as
published.

## Upgrading

`npm i dsh-jev-verify@0.8.3` and reload the page. The first time the card opens it repairs any literal
dotted keys left by an earlier version.
