// PostToolUse(Edit|Write): remember which source files this session touched, so the
// Stop hook can run exactly the checks those paths imply — and nothing at all on a
// turn that only answered a question.
import { readHookInput, recordFile, toRepoPath } from "./lib.mjs";

// Extensions some check can actually fail on. `js`/`mjs`/`cjs` are here because ESLint lints them
// — `eslint.config.js` and every script under `.claude/hooks/` are exactly that, and `verify.mjs`
// has trigger prefixes for both, which were dead while this regex excluded them. Not `.css`:
// neither `vue-tsc` nor ESLint reads it, so recording one would only run checks that cannot
// detect a stylesheet error and report a pass that means nothing.
const VERIFIABLE = /\.(?:ts|mts|vue|json|js|mjs|cjs)$/;

const input = await readHookInput();
const repoPath = toRepoPath(input?.tool_input?.file_path);

// Append unconditionally — duplicates are collapsed on read, and skipping the write to avoid one
// would mean reading the file first, which is the read-modify-write this deliberately avoids.
if (repoPath && VERIFIABLE.test(repoPath)) {
  recordFile(input.session_id, repoPath);
}

process.exit(0);
