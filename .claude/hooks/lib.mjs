import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Hooks live at <project>/.claude/hooks/, so the project root is two levels up.
// Derived from the script location rather than cwd, which a hook can't rely on.
//
// `realpathSync.native` is load-bearing on Windows, not decoration: the hook is launched as
// `node ${CLAUDE_PROJECT_DIR}/.claude/hooks/verify.mjs`, and that variable carries a lowercase
// drive letter (`d:\...`). Spawning `vitest` with a cwd cased differently from the filesystem's
// own makes Vite resolve the `vitest` package twice — once per spelling — so the runner
// registered by one module instance is invisible to the other, and *every* suite dies with
// "Vitest failed to find the runner" / "Cannot read properties of undefined (reading 'config')".
// The tests are fine; only the path spelling is wrong. `.native` returns the canonical casing.
export const PROJECT_ROOT = realpathSync.native(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
);

const STATE_DIR = path.join(PROJECT_ROOT, ".claude", "hooks", ".state");

export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

const slug = (sessionId) =>
  String(sessionId || "unknown").replace(/[^\w-]/g, "");

// Two files, because they have two very different writers.
//
// The edited-file list is **append-only**: Claude Code spawns one PostToolUse hook process per
// tool call, and batching independent edits into a single message is normal, so several processes
// record at once. A read-modify-write loses updates under exactly that load — measured at 4
// concurrent edits dropping an entry 1 round in 6, and 25 concurrent recording only 7. A lost
// entry is silent and skips the checks that path implied; a reader catching a half-written JSON
// array was worse still, discarding the whole turn. Appending one line per edit has no
// read-modify-write to lose, and a torn line costs at most that one record rather than all of
// them. Dedup happens on read, where it is free.
const filesPath = (sessionId) => path.join(STATE_DIR, `${slug(sessionId)}.files`);

// The block counter is only ever touched by the Stop hook, which runs once per turn. No
// concurrency, so a plain rewrite is correct here.
const blocksPath = (sessionId) => path.join(STATE_DIR, `${slug(sessionId)}.json`);

/** Append one edited path. Safe to call concurrently. */
export function recordFile(sessionId, repoPath) {
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(filesPath(sessionId), `${repoPath}\n`, "utf8");
}

/** Every distinct path recorded this session, in first-seen order. */
export function readFiles(sessionId) {
  const file = filesPath(sessionId);
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, "utf8").split("\n");
    return [...new Set(lines.map((line) => line.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function readBlocks(sessionId) {
  const file = blocksPath(sessionId);
  if (!existsSync(file)) return 0;
  try {
    return JSON.parse(readFileSync(file, "utf8")).blocks ?? 0;
  } catch {
    return 0;
  }
}

export function writeBlocks(sessionId, blocks) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(blocksPath(sessionId), JSON.stringify({ blocks }), "utf8");
}

export function clearState(sessionId) {
  rmSync(filesPath(sessionId), { force: true });
  rmSync(blocksPath(sessionId), { force: true });
}

/** Absolute or relative path -> forward-slashed path relative to the project root. */
export function toRepoPath(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(PROJECT_ROOT, filePath);
  const rel = path.relative(PROJECT_ROOT, resolved);
  // `..` covers a sibling directory; `path.isAbsolute` covers a different drive, where
  // `path.relative` can't express the answer as a traversal and hands back the absolute path.
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}
