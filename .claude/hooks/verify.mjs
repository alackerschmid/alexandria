// Stop: the project's verification contract, enforced instead of described.
// Runs only the checks the files edited this turn imply, and blocks the turn if any
// fail. CLAUDE.md documents the same matrix in two lines; this is what applies it.
import { spawnSync } from "node:child_process";
import {
  readHookInput,
  readFiles,
  readBlocks,
  writeBlocks,
  clearState,
  PROJECT_ROOT,
} from "./lib.mjs";

// A failing check blocks, Claude fixes, and Stop fires again. If it still fails after
// this many rounds, warn and let the turn end rather than trapping the user in a loop.
const MAX_BLOCKS = 3;
const MAX_OUTPUT = 4000;

const input = await readHookInput();
const sessionId = input.session_id;
const files = readFiles(sessionId);
const blocks = readBlocks(sessionId);

if (files.length === 0) process.exit(0);

if (blocks >= MAX_BLOCKS) {
  clearState(sessionId);
  console.log(
    JSON.stringify({
      systemMessage: `Verification still failing after ${MAX_BLOCKS} attempts — not blocking again. Run \`npm run type-check\` and \`npm run lint\` manually.`,
    }),
  );
  process.exit(0);
}

const touched = (prefix) => files.some((file) => file.startsWith(prefix));
const touchedAny = (...prefixes) => prefixes.some((prefix) => touched(prefix));

// What the root `vue-tsc` build covers. `vitest.config` is listed separately from `vite.config`:
// it does not start with it (they diverge at the `s`), so the shorter prefix never matched.
const TYPE_CHECKED = [
  "src/",
  "test/",
  "vite.config",
  "vitest.config",
  "tsconfig",
  "eslint.config",
  ".claude/hooks/",
];

// What root ESLint covers — which includes `worker/`: `npm run lint` lints 34 files under it, and
// `worker/package.json` has no lint script of its own, so this is the *only* thing that lints
// worker code. Leaving `worker/` out meant a worker-only turn ran `tsc` and the worker tests but
// never linted, so anything ESLint catches and `tsc` doesn't (an unused import, `no-empty`, a
// `unicorn/*` rule) passed the turn and failed in CI instead. That is the exact failure
// `be2b6a3 fix: pass lint` was written to stop.
const LINTED = [...TYPE_CHECKED, "worker/"];

const checks = [];
if (touchedAny(...TYPE_CHECKED)) {
  checks.push({ label: "type-check", command: "npm run type-check" });
}
if (touchedAny(...LINTED)) {
  checks.push({ label: "lint", command: "npm run lint" });
}
if (touchedAny("src/utils/", "src/locales/", "test/")) {
  checks.push({ label: "frontend tests", command: "npm test" });
}
if (touched("worker/")) {
  checks.push(
    { label: "worker type-check", command: "npm --prefix worker run type-check" },
    { label: "worker tests", command: "npm --prefix worker test" },
  );
}

if (checks.length === 0) {
  clearState(sessionId);
  process.exit(0);
}

const failures = [];
for (const check of checks) {
  // shell: true so `npm` resolves to npm.cmd on Windows without a shim.
  const result = spawnSync(check.command, {
    cwd: PROJECT_ROOT,
    shell: true,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    failures.push(`--- ${check.label} failed ---\n${output.slice(-MAX_OUTPUT)}`);
  }
}

if (failures.length === 0) {
  clearState(sessionId);
  process.exit(0);
}

// Only the counter is rewritten; the edited-file list stays as it is, so the next round still
// checks everything this turn touched.
writeBlocks(sessionId, blocks + 1);
process.stderr.write(
  `Verification failed for the files edited this turn. Fix these before finishing:\n\n${failures.join("\n\n")}\n`,
);
process.exit(2);
