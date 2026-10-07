# dsh-jev-verify 0.8.6

Fixes the startup crash reported in [#1](https://github.com/xienda/dsh-jev-verify/issues/1).

## Root cause

`@deepseek-ai/dsh-tools` was declared as a normal `dependency` (0.1.5-rc.2) - the only plugin in the ecosystem that did. On a profile using `nodeLinker: hoisted` + `hoistPattern: ["*"]`, pnpm materialised a real copy under `<profile>/node_modules/@deepseek-ai/dsh-tools`. The loader entry `id: tools` resolved to that copy instead of the host's built-in one; the copy could not import its own peers (`Cannot find package '@deepseek-ai/cordis'`), so the `tools` service never registered, every plugin with `inject: ["tools"]` stalled, and startup ended with:

```
DesktopHostFatalError: dsh: startup failed: 1 required plugin did not activate
```

## Fix

- `@deepseek-ai/dsh-tools` moved from `dependencies` to `peerDependencies` (`^0.1.5-rc.2`) and is marked `optional: true` in `peerDependenciesMeta`, so no installer will ever materialise it - it cannot shadow the host.
- `dependencies` now carries only the leaf library `@deepseek-ai/schemastery`.
- Runtime resolution is unchanged: `lib/index.js:28-39` imports both host packages defensively (null on failure) and the host's own store still provides them.
- New `test/manifest.test.mjs` fails if any host runtime package reappears in `dependencies` - verified by reintroducing the bug and watching the test go red. Full suite: **38/38**.

## Upgrading from a broken install

Removing the plugin entry is not enough, because the hoisted copy outlives it. After upgrading to 0.8.6, delete `<profile>/node_modules/@deepseek-ai/dsh-tools` (or re-run `pnpm install`) and the host boots again. The same applies to the manually installed copy of `@deepseek-ai/dsh-tools` under any profile that used a hoisted linker.

Everything else is identical to 0.8.5: seven tools including `jev_batch`, a ledger that survives restarts, a remaining balance derived from your declared balance minus locally measured spend, per-turn auto-triage, and the live 27-question benchmark (96.3%).
