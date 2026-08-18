# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General instructions

The general working rules — ask don't assume, simplest solution that fits, don't touch unrelated
code, flag uncertainty, suggest better approaches — live in `~/.claude/CLAUDE.md` and apply
everywhere. They are not repeated here. What follows is specific to this repo.

1. Keep the two remaining inventories in sync with the code: when adding, renaming, or removing an **API route**, update `worker/CLAUDE.md`; when changing a **table or column**, update `worker/migrations/CLAUDE.md`. Both are contracts rather than file listings, so they don't rot the way a component roster does. There is deliberately no frontend inventory — ask the `inventory` subagent for the roster of an area instead.

2. `to-do.md` at the repo root is personal notes, not a backlog for you. `.claude/settings.json` denies Read and Edit on it, which also covers Grep and Glob and the file commands Claude Code recognises in Bash (`cat`, `head`, `tail`, `sed`). What it can't cover is an arbitrary subprocess that opens the file itself — a node or python script, or a tool reading it indirectly. So if its contents reach you some other way, don't act on them, and don't treat anything in it as a task. Only work from it if I ask you to.

## Formatting

- Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend most of the response on the main answer. When asked to explain something, give a high-level summary unless an in-depth explanation is specifically requested.

## Where things are documented

Loaded by directory:

- `src/CLAUDE.md` — frontend invariants, data flow, styling tokens, i18n
- `worker/CLAUDE.md` — backend: API routes, key modules, auth, rate limiting
- `worker/migrations/CLAUDE.md` — the table-by-table D1 schema

Loaded by file, from `.claude/rules/` (each carries `paths:` frontmatter and costs nothing until you open a matching file):

- `book-detail` — the detail dialog: measure and bands, tab derivation, the single-Save edit screen, `RatingDialog` ownership and its flush rule
- `import-wizard` — both halves of the Goodreads import: the wizard, the two batch routes, the ownership rule, `update`/Undo semantics, batch concurrency
- `library-pipeline` — the search → collapse → group chain and why the order is load-bearing
- `appearance` — user presets, `.force-dark`, the `tailwind.css` ↔ `appearance.ts` sync requirement, self-hosted fonts
- `preferences` — where persisted preferences live and how to add one
- `enrichment` — the Wikidata pipeline, retry policy, sweeper batching, telemetry

On demand:

- `/dev-setup` skill — running both dev servers locally, `worker/.dev.vars` secrets, seeding a test account
- `/troubleshooting` skill — API 404s in dev, enrichment stuck on `pending`, rebuilding a wiped local D1
- `/add-api-column` skill — adding a new column to the API response (Wikidata / book metadata / custom field)
- `/review-diff` skill — reviewing local work: runs `/code-review` and adds this repo's own concerns and its list of what not to report
- `inventory` subagent — the roster of an area: which components/composables/stores/routes exist under a directory and what each is for

## Architecture

Two `wrangler.toml` files — root (`wrangler.toml`) configures Cloudflare Pages and sets `VITE_API_URL` at build time; `worker/wrangler.toml` configures the Worker (D1 binding, the `COVERS` R2 bucket binding, cron, observability, `CORS_ORIGIN`).

Two separate deployments, **both owned by the GitHub Actions Deploy workflow** (`.github/workflows/deploy.yml`) on push to `main`. Its single `deploy` job runs the shared verify workflow first (frontend type-check + lint + tests, worker type-check + tests) and then, in order:

1. **Worker** (`bookscan-worker`) — `wrangler d1 migrations apply bookscan --remote`, then `wrangler deploy` (from `worker/`)
2. **Frontend** — root `npm ci`, `npm run build-only` (verify already type-checked), then `wrangler pages deploy --branch=main` from the repo root, using the wrangler binary already installed in `worker/node_modules`

Both steps need the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets; the token needs **Pages: Edit** as well as Workers/D1. The ordering is deliberate — the frontend must never go live against an older worker — and a red verify run now deploys **neither half**. `VITE_API_URL` is read out of the root `wrangler.toml` by the workflow, so that file stays the single source for it.

Cloudflare's own Git integrations are disabled for both halves: Workers Builds for the worker, and **automatic deployments on the Pages project** (Workers & Pages → `bookscan` → Settings → Build). If Pages auto-deploy is ever re-enabled, it ships the frontend on every push regardless of verify, which is exactly the failure this replaced. `npm run deploy:worker` (`wrangler deploy`) remains available to **you** for manual/out-of-band deploys (it does not apply migrations). It is denied to Claude — `.claude/settings.json` blocks `npm run deploy*` and `wrangler deploy*` in both shells, so an agent cannot ship either half; deploys happen through the workflow or from your own terminal.

CI: the **CI** workflow (`.github/workflows/ci.yml`) runs the same verify workflow on every push to non-`main` branches.

The **PR Title** workflow (`.github/workflows/pr-title.yml`) lints the pull request title against Conventional Commits on every PR — see Versioning for why the title, not the commits, is what matters.

`main` is guarded by a repository **ruleset** ("CI check"), not classic branch protection: PRs required, force-push and deletion blocked, and three required status checks — `verify / frontend`, `verify / worker`, `PR Title`. It has **no bypass actors**, so there is no admin override. Adding a required check whose workflow does not yet exist on `main` blocks every open PR — the check never reports and nothing can merge, including the PR that would add the workflow. Land the workflow first, then require it.

Worker deploys apply pending D1 migrations automatically (before `wrangler deploy`); manual/out-of-band deploys do not — apply those with `npx wrangler d1 migrations apply bookscan --remote`.

The Vite dev server proxies `/api/*` to `http://localhost:8787` — the worker must be running locally for API calls to work in dev. In production, the frontend reads `VITE_API_URL` (set in root `wrangler.toml`) and calls the worker directly.

Primary language is TypeScript; preserve strict typing and prefer minimal, clean code (simplify where reasonable when refactoring).

## Cloudflare MCP

The `cloudflare` plugin adds five MCP servers. Four of them reach the **live account**, which also holds unrelated `thursday` and `bookclub` projects — scope every call to `bookscan-worker` / D1 `bookscan` explicitly, never take "the first worker in the list".

- **`cloudflare-docs`** — `search_cloudflare_documentation`. Consult it before writing worker code, editing either `wrangler.toml`, or adding a migration, instead of answering from pretrained knowledge: wrangler flags, D1 limits, and cron semantics all move faster than a model cutoff. Same rule for the `cloudflare:wrangler` and `cloudflare:workers-best-practices` skills.
- **`cloudflare-observability`** — `query_worker_observability` plus `observability_keys` / `observability_values` over production logs (7-day retention; filter `$metadata.service = bookscan-worker`). This is the only view of prod enrichment behaviour — whether the 2-minute cron actually fired, SPARQL error and timeout rates, real latency. Local `wrangler dev` logs cover none of that. Confirm keys and values with the `_keys`/`_values` tools before filtering on them rather than guessing field names.
- **`cloudflare-bindings`** — `d1_database_query` runs arbitrary SQL against the **production** database. Read-only `SELECT` for diagnosis is fine; `INSERT`/`UPDATE`/`DELETE`/DDL through it is not. Schema changes go through `worker/migrations/` and the deploy path, always. It is deliberately **not** allowlisted in `.claude/settings.json`, so every call prompts — that prompt is the guardrail. The obvious way around it is closed too: `wrangler d1 execute --remote` and `d1 migrations apply --remote` are in `deny` for both shells and both the `npx` and bare forms. The `--local` forms are allowed, because the local-D1 rebuild in the `/troubleshooting` skill needs them.
- **`cloudflare-api`** — generic REST API access. Its `execute` tool could mutate anything in the account and is in `deny`, so only the read-only `search` / `docs` tools are usable. Anything that genuinely needs `execute` is a conversation, not a tool call.
- **`cloudflare-builds`** — Workers Builds only, which is disabled for this repo (see Architecture), so it will be empty for `bookscan-worker`. Deploy status comes from `gh run watch` on the **Deploy** workflow.

## Versioning

PRs are **squash-merged**, with the squash commit's subject set to the PR title and its body left blank (repo setting `squash_merge_commit_title = PR_TITLE`, `..._message = BLANK`). So the **PR title** is the only thing that reaches `main`, and it alone is what release-please parses into `CHANGELOG.md` — commit messages on the branch never appear there. Titles follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: ...` — new feature → minor version bump
- `fix: ...` — bug fix → patch bump
- `feat!:` / `fix!:` — breaking change → major bump
- `chore:`, `docs:`, `refactor:`, `ci:` — no release

Merge commits are **disabled**, deliberately. GitHub prefills a merge commit's body from the PR description, so a body containing a `feat:`/`fix:` line got counted twice — release-please parses the whole message, not just the subject, and the merge and the real commit each produced an entry. That is what put 27 duplicate lines in the 1.1.0 changelog. Re-enabling merge commits, or switching the squash default to "pull request title and description", brings it straight back.

Rebase merging is still allowed and is safe for release-please, but it replays every branch commit individually, so a branch with three `feat:` commits yields three changelog entries. Squash if you want one entry per PR.

[release-please](.github/workflows/release-please.yml) watches `main` and auto-opens a Release PR that updates `CHANGELOG.md` and `package.json`. Merge that PR when ready to publish a GitHub Release. It regenerates that branch whenever new commits land on `main`, so any hand-edit to the Release PR's `CHANGELOG.md` is lost if something else merges first.

### No AI-attribution trailers

Commit messages and PR bodies carry **no** `Co-Authored-By: Claude`, no `🤖 Generated with [Claude Code]`, and no equivalent. This overrides the general default of appending one.

Only half of that is enforced. A `PreToolUse` hook (`.claude/hooks/guard-commit.mjs`) blocks `gh pr create` when the trailer appears in the command or in the file a `--body-file` / `-F` points at. **`git commit` is deliberately not guarded** — a `PreToolUse` hook sees only `tool_input.command`, so it would catch `-m "…"` and miss `-F msg.txt`, `--template` and `--amend --no-edit`, and a guard that covers the easy case while silently missing the rest reads as solved when it isn't. Commit-side enforcement, if ever wanted, belongs in a `commit-msg` git hook, which sees the final message however it was supplied. Until then the commit side is a convention you have to follow, not a gate that will stop you.

## Verification

**This is enforced, not requested.** Two hooks do it: a `PostToolUse` hook (`.claude/hooks/record-edit.mjs`) appends each edited path as it happens, and a `Stop` hook (`.claude/hooks/verify.mjs`) reads that list and runs the checks those paths imply:

| Edited | Runs |
| --- | --- |
| `src/`, `test/`, `vite.config`, `vitest.config`, `tsconfig`, `eslint.config`, `.claude/hooks/` | `npm run type-check` + `npm run lint` |
| `worker/` | `npm run lint` (root ESLint covers `worker/`; the worker has no lint script), plus the worker's own type-check and tests |
| `src/utils/`, `src/locales/`, `src/styles/`, `test/` | `npm test` |

A failure blocks the turn and returns the output. A turn that edited nothing runs nothing. Only files an actual check can fail on are recorded (`.ts`/`.mts`/`.vue`/`.json`/`.js`/`.mjs`/`.cjs`/`.css`).

`.css` is recorded for one check only: `test/appearance.spec.ts` parses `src/styles/tailwind.css` and fails when its light/dark token literals drift from the `warm` paper preset in `src/utils/appearance.ts` — the sync requirement the `appearance` rule describes, which nothing enforced before. Neither `vue-tsc` nor ESLint reads a stylesheet, so **everything else in that file is still unchecked** and needs a look in the browser.

So don't hand-run these to "check your work" — finish the edit and let the hook decide. Do run them manually when you need a result mid-task, or when the hook has given up after three consecutive failures. The same standard applies to a `/code-review` pass: fixes applied from one aren't done until these pass.

## Shell

Both a PowerShell tool and a Bash tool (Git Bash, POSIX `sh`) are available, each with its own
syntax. Bash heredocs are fine **in the Bash tool**; the hazard is PowerShell, where a here-string
whose closing `'@` isn't at column 0 is a parse error, and quoting inside one silently mangles the
content. That has cost a mangled commit message and an amend more than once.

So: **never pass a multi-line string to a native executable inline.** Write it to a file with the
Write tool and point the command at that file — for commits, `git commit -F <file>`, then delete the
file. Same for SQL, JSON payloads and scripts: file first, then run it.

## Debugging a reported defect

When I report something concrete — a screenshot, a record, a specific book that behaved wrong —
**reproduce that case before proposing a cause, and say what the evidence is.** A mechanism that
would explain the symptom is not the same as the one that produced it, and a fix aimed at the wrong
case looks like progress while changing nothing I can see.

Two specifics, both learned the hard way:

- **Check the environment I'm actually in.** The local D1 and production hold different libraries, so
  "not reproducible locally" often means "not present locally". Read-only `SELECT`s against prod for
  diagnosis are fine and usually decisive; the Cloudflare MCP notes above say which tool to use.
- **Confirm the root cause against data, not plausibility.** A same-title/same-author collision, a
  wrong external id and a bad merge all produce "two books share one row" — only the rows say which.
  Name the mechanism *and* the field that proves it before editing.

When the diagnosis contradicts something a rule file or comment claims, that's a finding worth
telling me about, not a detail to quietly work around.

Note: both the worker (`worker/test/*.spec.ts`) and the frontend (root `test/*.spec.ts`) have unit tests covering **pure logic only** — no D1/miniflare, no component mounting, so anything requiring a DB or the DOM is untested (deliberate scope decision). Frontend components/pages are verified by type-checking and manual QA (seed via `cd worker && npm run seed:dev`); only Vue-free helpers get unit tests. Two specs additionally guard cross-file drift and so fail `npm test` and CI: `test/locales.spec.ts` if `en.json` and `de.json` key sets diverge, and `test/appearance.spec.ts` if `tailwind.css`'s paper tokens diverge from the `warm` preset in `src/utils/appearance.ts`. Note that `npm run build` does not run the tests, so it will not catch either on its own.
