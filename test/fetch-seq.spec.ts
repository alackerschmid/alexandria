import { describe, it, expect } from "vitest";
import { createFetchSequencer } from "@/utils/fetch-seq";

describe("createFetchSequencer", () => {
  it("the only load is current", () => {
    const next = createFetchSequencer();
    const isCurrent = next();
    expect(isCurrent()).toBe(true);
  });

  it("a newer load supersedes an older one — the stale response must not commit", () => {
    // The /stats scope-toggle race: load#1 (scope=all, the heavier query) resolves after
    // load#2 (scope=owned). #1 must see itself superseded even though it resolved last.
    const next = createFetchSequencer();
    const first = next();
    const second = next();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("each check reads the live state, not the state at creation", () => {
    const next = createFetchSequencer();
    const first = next();
    expect(first()).toBe(true); // current until superseded…
    next();
    expect(first()).toBe(false); // …and stale from then on
  });

  it("independent sequencers do not interfere", () => {
    const a = createFetchSequencer();
    const b = createFetchSequencer();
    const aFirst = a();
    b();
    expect(aFirst()).toBe(true);
  });
});
