/**
 * Manifest guard for the crash reported in issue #1: a package the host loads
 * by entry id must never be a plain dependency. A normal dependency can be
 * hoisted over the host's own copy (pnpm nodeLinker: hoisted + hoistPattern),
 * and that copy fails to import its own peers, so the tools service never
 * activates and every inject: ["tools"] plugin stalls at startup.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Leaf libraries only: they are not cordis plugins, so a hoisted copy cannot
// shadow a loader entry. Everything else the host provides must be a peer.
const SAFE_TO_INSTALL = new Set(["@deepseek-ai/schemastery"]);

// ---- 1) no host runtime package is a plain dependency ---------------------
const offenders = Object.keys(pkg.dependencies ?? {}).filter(
  (dep) => dep.startsWith("@deepseek-ai/") && !SAFE_TO_INSTALL.has(dep),
);
assert.deepEqual(offenders, [], "host packages must be peers, not dependencies: " + offenders.join(", "));
assert.equal(pkg.dependencies?.["@deepseek-ai/dsh-tools"], undefined, "issue #1: dsh-tools must never be installed as a dependency");
console.log("PASS 1: no host runtime package is a plain dependency (issue #1 regression guard)");

// ---- 2) dsh-tools is an optional peer, so nothing is ever auto-installed --
assert.ok(pkg.peerDependencies?.["@deepseek-ai/dsh-tools"], "dsh-tools must still be declared as a peer");
assert.equal(pkg.peerDependenciesMeta?.["@deepseek-ai/dsh-tools"]?.optional, true, "an optional peer is never auto-installed, so it cannot be hoisted either");
assert.match(pkg.peerDependencies["@deepseek-ai/dsh-tools"], /0\.1\.5-rc\.2/);
console.log("PASS 2: dsh-tools is a declared, optional peer dependency");

// ---- 3) the plugin still loads when the host packages are unresolvable ---
const source = readFileSync(join(root, "lib", "index.js"), "utf8");
for (const dep of ["@deepseek-ai/dsh-tools", "@deepseek-ai/schemastery"]) {
  assert.ok(source.indexOf(dep) !== -1, dep + " must still be imported by lib/index.js");
}
assert.match(source, /defineTool = null;/);
assert.match(source, /schemasteryDefault = null;/);
console.log("PASS 3: both host imports stay optional and degrade to the fallback path");

console.log("ALL MANIFEST TESTS PASSED");
