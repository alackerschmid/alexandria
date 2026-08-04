import { describe, it, expect } from "vitest";
import { sortRows } from "@/utils/admin-sort";

type Row = {
  name: string;
  count: number;
  seen: number | null;
  admin?: boolean;
};

const rows: Row[] = [
  { name: "beta", count: 5, seen: 300 },
  { name: "Alpha", count: 50, seen: null },
  { name: "gamma", count: 5, seen: 100 },
];

const names = (out: Row[]) => out.map((r) => r.name);

describe("sortRows", () => {
  it("orders numbers numerically in both directions", () => {
    expect(names(sortRows(rows, (r) => r.count, "asc"))).toEqual([
      "beta",
      "gamma",
      "Alpha",
    ]);
    expect(names(sortRows(rows, (r) => r.count, "desc"))).toEqual([
      "Alpha",
      "beta",
      "gamma",
    ]);
  });

  it("compares strings case-insensitively", () => {
    expect(names(sortRows(rows, (r) => r.name, "asc"))).toEqual([
      "Alpha",
      "beta",
      "gamma",
    ]);
  });

  it("sorts numbers embedded in strings by value, not by digit", () => {
    const ops = [{ name: "op 10" }, { name: "op 2" }];
    expect(sortRows(ops, (o) => o.name, "asc").map((o) => o.name)).toEqual([
      "op 2",
      "op 10",
    ]);
  });

  it("keeps nulls last in either direction", () => {
    expect(names(sortRows(rows, (r) => r.seen, "asc"))).toEqual([
      "gamma",
      "beta",
      "Alpha",
    ]);
    expect(names(sortRows(rows, (r) => r.seen, "desc"))).toEqual([
      "beta",
      "gamma",
      "Alpha",
    ]);
  });

  it("orders booleans false-then-true ascending", () => {
    const flagged: Row[] = [
      { name: "user", count: 0, seen: null, admin: false },
      { name: "admin", count: 0, seen: null, admin: true },
    ];
    expect(names(sortRows(flagged, (r) => r.admin ?? false, "asc"))).toEqual([
      "user",
      "admin",
    ]);
  });

  it("is stable for equal values and leaves the input untouched", () => {
    const equal = sortRows(rows, () => 1, "desc");
    expect(names(equal)).toEqual(["beta", "Alpha", "gamma"]);
    expect(names(rows)).toEqual(["beta", "Alpha", "gamma"]);
  });
});
