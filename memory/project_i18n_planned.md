---
name: project-i18n-planned
description: i18n is intentionally kept even though currently unused — user plans to implement it later
metadata:
  type: project
---

i18n (vue-i18n) is wired up but not yet used in the UI. The user explicitly wants to keep all i18n references intact.

**Why:** Planning to implement internationalization in the future; scaffolding is already in place (`src/plugins/i18n.ts`, registered in `src/plugins/index.ts`).

**How to apply:** Do not flag `vue-i18n`, `src/plugins/i18n.ts`, or `app.use(i18n)` as dead/unused code. Do not remove or suggest removing them.
