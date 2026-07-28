// PreToolUse(Bash): this project omits AI-attribution trailers.
//
// Wired for `gh pr create` only. The `git commit` guard was removed deliberately: a PreToolUse
// hook can only see `tool_input.command`, so it catches an inline `-m "…"` and misses every other
// way a message reaches git — `-F msg.txt`, `-m "$(cat …)"`, `--template`, `--amend --no-edit`
// re-using an earlier message. A guard that covers the easy case and silently misses the rest is
// worse than none, because it reads as solved. If commit-side enforcement is wanted, it belongs
// in a `commit-msg` git hook, which sees the final message however it was supplied.
//
// The same caveat applies here: this catches a `--body "…"` and not a `--body-file`.
import { readHookInput } from "./lib.mjs";

const ATTRIBUTION = [
  /Co-Authored-By:\s*Claude/i,
  /Co-Authored-By:.*@anthropic\.com/i,
  /Generated with \[Claude Code\]/i,
  /🤖 Generated with/i,
];

const input = await readHookInput();
const command = input?.tool_input?.command ?? "";

if (ATTRIBUTION.some((pattern) => pattern.test(command))) {
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
