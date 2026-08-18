---
name: review-diff
description: Defect-hunt local work — runs /code-review over the working diff and adds the bookscan-specific concerns a general reviewer cannot know (localStorage shape drift, the work/edition write model, contract docs, testability scope), plus the things this repo does not want reported. Use before committing a feature branch, or when asked for a code review of local work.
---

# Review the working diff

`/code-review` owns the mechanism — establishing the diff, fanning out, verifying findings before
reporting, and emitting them. It takes the current local diff; a PR is one possible target, not a
requirement. None of that is re-specified here.

This skill is the repo-specific half: the failure modes a general reviewer has no way to know
about, and the findings this repo does not want raised.

## 1. Run the sweep

Invoke `/code-review` on the local work. Do **not** pass `--fix` or `--comment` unless they were
explicitly asked for — reviewing and changing are separate requests here.

Two things to confirm rather than assume:

- **Untracked files** (`??` in `git status --short`) are part of the change, and a brand-new file
  is where a defect is most likely and least likely to be noticed. If the sweep didn't cover them,
  read them in full yourself.
- **Nothing to review** is the one legitimate early exit. Say so and stop.

## 2. Then cover these yourself

`/code-review` spawns its own agents, and they do not see this file — so its sweep is not aimed at
anything below. Make a pass over the same diff for these and merge what you find into one report.

1. **Persistence and compatibility** — the failure mode this repo actually ships: a new field on a
   `localStorage` shape is `undefined` for every session stored before the change, and the load is
   a bare `as` cast. Check `stores/import.ts`, `stores/guest.ts`, `stores/preferences.ts`. Also any
   API response field the client reads through, and any column a migration adds.
2. **Data integrity across the work/edition model** — `scans` is unique on `(user_id, book_id)`,
   not on the work, while rating and review live per *work*. Every fan-out across siblings is a
   chance to write a book the user didn't mean. Check `worker/migrations/CLAUDE.md` for the
   constraint before calling something a bug.
3. **Contracts** — does the change keep `worker/CLAUDE.md` (routes), `worker/migrations/CLAUDE.md`
   (schema) and the matching `.claude/rules/` file true? A stale contract doc is a real finding.
4. **Tests** — does each behavioural change have a test that would fail without it? Pure logic
   belongs in `src/utils/` or a worker module so it *can* be tested; logic buried in a `.vue` file
   or a route handler is untestable by this repo's deliberate scope, which is itself worth
   flagging.

One local trap worth naming, since a general correctness pass reads it as idiomatic: `??` vs `||`
on a falsy-but-valid value. `0` is a real rating here.

## 3. Not findings

Drop these from the merged report regardless of which pass produced them:

- Anything the Stop hook's `npm run lint` / type-check / tests would catch (see the Verification
  section of the root `CLAUDE.md`). Those gates run on their own and block the turn.
- Pre-existing issues the diff merely touches. Note them separately as "adjacent, not from this
  change" if they're serious.
- Style the repo has deliberately chosen against — read the comment before flagging. This codebase
  documents its exceptions in comments and rule files, and the reason is usually there.
- Missing abstraction or coverage in the abstract, with no failure behind it.

## 4. Report

One merged report, most severe first, with `file:line` links — not two lists. Then, in prose: what
was reviewed, what was found, and explicitly anything that could not be checked and why.

**Do not edit, fix, stage or commit anything.** Report and stop. Fixes are a separate, explicit
request; if asked for them afterwards, the change isn't done until the hook's gates pass.
