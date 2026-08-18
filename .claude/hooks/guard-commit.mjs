// PreToolUse(Bash): this project omits AI-attribution trailers.
//
// Wired for `gh pr create` only. The `git commit` guard was removed deliberately: a PreToolUse
// hook can only see `tool_input.command`, so it catches an inline `-m "…"` and misses every other
// way a message reaches git — `-m "$(cat …)"`, `--template`, `--amend --no-edit` re-using an
// earlier message. A guard that covers the easy case and silently misses the rest is worse than
// none, because it reads as solved. If commit-side enforcement is wanted, it belongs in a
// `commit-msg` git hook, which sees the final message however it was supplied.
//
// The file-backed case *is* covered here, and has to be: CLAUDE.md's Shell section requires
// multi-line strings go to a file first, so `--body-file` is the path this project actually
// takes and an inline `--body` is the exception. Guarding only `--body` would have been a guard
// on the one form the conventions tell you not to use.
import { readFileSync } from "node:fs";
import path from "node:path";
import { readHookInput, PROJECT_ROOT } from "./lib.mjs";

const ATTRIBUTION = [
  /Co-Authored-By:\s*Claude/i,
  /Co-Authored-By:.*@anthropic\.com/i,
  /Generated with \[Claude Code\]/i,
  /🤖 Generated with/i,
];

// `--body-file <path>`, `--body-file=<path>` and gh's short `-F <path>`, with or without quotes.
const BODY_FILE = /(?:--body-file[=\s]+|-F\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/g;

/** Contents of every --body-file the command points at, best effort. */
function bodyFileContents(command) {
  const contents = [];
  for (const match of command.matchAll(BODY_FILE)) {
    const file = match[1] ?? match[2] ?? match[3];
    // `-F -` reads stdin, which a PreToolUse hook cannot see. Nothing to scan.
    if (!file || file === "-") continue;
    try {
      contents.push(readFileSync(path.resolve(PROJECT_ROOT, file), "utf8"));
    } catch {
      // Unreadable or not yet written — the command may still fail on its own. Don't block
      // on a path this hook simply couldn't resolve.
    }
  }
  return contents;
}

const input = await readHookInput();
const command = input?.tool_input?.command ?? "";
const haystacks = [command, ...bodyFileContents(command)];

if (haystacks.some((text) => ATTRIBUTION.some((pattern) => pattern.test(text)))) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          "This project omits AI-attribution trailers. Rewrite the message without the Co-Authored-By / 'Generated with Claude Code' line.",
      },
    }),
  );
}

process.exit(0);
