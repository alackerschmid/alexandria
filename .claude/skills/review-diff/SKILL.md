---
name: review-diff
description: Defect-hunt the working diff with parallel agents — no pull request required. Reviews uncommitted changes plus everything on the branch that isn't on main, splits the work by concern, verifies each finding before reporting, and never edits or commits. Use before committing a feature branch, or when asked for a code review of local work.
---

# Review the working diff

The plugin `/code-review` command is **pull-request only**: every step of it shells out to
`gh pr view` / `gh pr diff` and it finishes by commenting on the PR, so it cannot review local work.
This skill is that gap. **Never abort for lack of a PR, a GitHub remote, or a clean index** — if
there is anything to review, review it.

## 1. Establish the diff

Run all three; the review scope is their union:

```
git status --short
git diff                      # unstaged
git diff --staged             # staged
git diff main...HEAD          # committed on this branch but not on main
```

Untracked files (`??` in `git status`) are part of the change — read them in full. A brand-new file
is where a defect is most likely and least likely to be noticed.

If the union is empty, say so and stop. That is the only legitimate early exit.

## 2. Fan out, split by concern

Launch parallel `Explore` agents in **one message** so they run concurrently — one per concern below
that the diff actually touches. Skip the ones it doesn't; don't spawn an agent to report "n/a".

Give every agent: the file list, the instruction to read the surrounding code rather than the diff
alone, and the requirement to return findings as `{file, line, severity, claim, why_it_breaks}` with
severity one of `blocker | major | minor | nit`.

1. **Correctness and edge cases** — the change's own logic. Null/empty/zero, off-by-one, ordering,
   early returns, `??` vs `||` on a falsy-but-valid value (`0` is a real rating here).
2. **Persistence and compatibility** — the failure mode this repo actually ships: a new field on a
   `localStorage` shape is `undefined` for every session stored before the change, and the load is a
   bare `as` cast. Check `stores/import.ts`, `stores/guest.ts`, `stores/preferences.ts`. Also: any
   API response field the client reads through, and any column a migration adds.
3. **Data integrity across the work/edition model** — `scans` is unique on `(user_id, book_id)`, not
   on the work, while rating and review live per *work*. Every fan-out across siblings is a chance to
   write a book the user didn't mean. Check `worker/migrations/CLAUDE.md` for the constraint before
   calling something a bug.
4. **Contracts** — does the change keep `worker/CLAUDE.md` (routes), `worker/migrations/CLAUDE.md`
   (schema) and the matching `.claude/rules/` file true? A stale contract doc is a real finding.
5. **Tests** — does each behavioural change have a test that would fail without it? Pure logic
   belongs in `src/utils/` or a worker module so it *can* be tested; logic buried in a `.vue` file or
   a route handler is untestable by this repo's deliberate scope, which is itself worth flagging.

## 3. Verify before reporting

For every `blocker` and `major`, spawn one agent per finding to **refute** it: construct the concrete
input that triggers it and trace the code path. Default to refuted when uncertain. Drop anything that
doesn't survive. A plausible-sounding finding that wastes a review cycle is worse than a missed nit.

Not findings — do not report these:

- Anything the Stop hook's `npm run lint` / type-check / tests would catch (see the Verification
  section of the root `CLAUDE.md`). Those gates run on their own.
- Pre-existing issues the diff merely touches. Note them separately as "adjacent, not from this
  change" if they're serious.
- Style the repo has deliberately chosen against — read the comment before flagging. This codebase
  documents its exceptions in comments and rule files, and the reason is usually there.
- Missing abstraction or coverage in the abstract, with no failure behind it.

## 4. Report

Use the `ReportFindings` tool if it is available, most severe first, with `verdict` set from step 3;
otherwise a plain list grouped by severity with `file:line` links. Then, in prose: what you reviewed,
what you found, and — explicitly — anything you could not check and why.

**Do not edit, fix, stage or commit anything.** Report and stop. Fixes are a separate, explicit
request; if asked for them afterwards, the change isn't done until the hook's gates pass.
