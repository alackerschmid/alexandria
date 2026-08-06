import { describe, it, expect } from "vitest";
import type { Context } from "hono";
import { readJsonBody, INVALID_JSON_BODY } from "../src/json-body";

// readJsonBody only touches `c.req.json()`, so a two-property stand-in is the whole contract.
const ctx = (json: () => Promise<unknown>) =>
  ({ req: { json } }) as unknown as Context;

const body = (value: unknown) => ctx(async () => value);
const malformed = () =>
  ctx(async () => {
    // What Hono's c.req.json() does on a truncated/invalid body.
    throw new SyntaxError("Unexpected end of JSON input");
  });

describe("readJsonBody", () => {
  it("returns a plain object body unchanged", async () => {
    const value = { isbn: "9780306406157", status: "read" };
    expect(await readJsonBody(body(value))).toEqual(value);
  });

  it("returns an empty object as-is (a route's own field checks answer for it)", async () => {
    expect(await readJsonBody(body({}))).toEqual({});
  });

  // The reason every one of these is null rather than passed through: each call site reads named
  // properties off the result, and a value that merely *survives* the parse reaches D1 as a bind
  // parameter that is neither string nor number and throws deep inside the query — a 500 for what
  // is squarely a client mistake.
  it("returns null for a malformed body instead of rejecting", async () => {
    expect(await readJsonBody(malformed())).toBeNull();
  });

  it("returns null for an array top level", async () => {
    // Would otherwise sail through as an object whose every named property is undefined.
    expect(await readJsonBody(body([{ isbn: "9780306406157" }]))).toBeNull();
    expect(await readJsonBody(body([]))).toBeNull();
  });

  it("returns null for a null top level", async () => {
    expect(await readJsonBody(body(null))).toBeNull();
  });

  it("returns null for a primitive top level", async () => {
    expect(await readJsonBody(body("foo"))).toBeNull();
    expect(await readJsonBody(body(42))).toBeNull();
    expect(await readJsonBody(body(true))).toBeNull();
    // JSON can't carry these, but the guard is a typeof check and shouldn't depend on that.
    expect(await readJsonBody(body(undefined))).toBeNull();
  });
});

describe("INVALID_JSON_BODY", () => {
  it("is the one 400 shape every readJsonBody miss answers with", () => {
    expect(INVALID_JSON_BODY).toEqual({ error: "Invalid JSON body" });
  });
});
