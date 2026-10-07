/**
 * Test isolation: the host does not always export DSH_HOME, so 0.8.5 taught
 * lib/usage.js and lib/dashboard.js to fall back to %USERPROFILE%/.dsh. Without
 * this shim a test run would append fixture rows to the user's LIVE roll ledger
 * (observed: 4 extra lines in C:/Users/孙浩/.dsh/jev-roll.jsonl after a suite run).
 * Import this FIRST in any test that can record or save.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jev-test-home-"));
process.env.DSH_HOME = dir;

export const testHome = dir;