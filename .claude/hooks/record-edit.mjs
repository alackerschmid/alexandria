// PostToolUse(Edit|Write): remember which source files this session touched, so the
// Stop hook can run exactly the checks those paths imply — and nothing at all on a
// turn that only answered a question.
import { readHookInput, recordFile, toRepoPath } from "./lib.mjs";

// Extensions some check can actually fail on. `js`/`mjs`/`cjs` are here because ESLint lints them
// — `eslint.config.js` and every script under `.claude/hooks/` are exactly that, and `verify.mjs`
// has trigger prefixes for both, which were dead while this regex excluded them.
//
// `.css` was excluded for the same reason until `test/appearance.spec.ts` existed: neither
// `vue-tsc` nor ESLint reads a stylesheet, so recording one ran checks that could not fail on
// its contents and reported a pass meaning nothing. That test reads `tailwind.css` directly and
// fails on the one drift the `appearance` rule warns about, so a css edit now has a check that
// can genuinely fail. It still doesn't cover a stylesheet *error* — only the token drift — so a
// visual look is still the rule for anything else in there.
const VERIFIABLE = /\.(?:ts|mts|vue|json|js|mjs|cjs|css)$/;

const input = await readHookInput();
const repoPath = toRepoPath(input?.tool_input?.file_path);

// Append unconditionally — duplicates are collapsed on read, and skipping the write to avoid one
// would mean reading the file first, which is the read-modify-write this deliberately avoids.
if (repoPath && VERIFIABLE.test(repoPath)) {
  recordFile(input.session_id, repoPath);
}

process.exit(0);
