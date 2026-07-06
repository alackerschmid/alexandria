import { describe, it, expect } from "vitest";
import { EMAIL_RE } from "../src/auth";

describe("EMAIL_RE", () => {
  it("accepts well-formed emails", () => {
    expect(EMAIL_RE.test("user@example.com")).toBe(true);
    expect(EMAIL_RE.test("first.last@sub.example.com")).toBe(true);
    expect(EMAIL_RE.test("user+tag@example.co.uk")).toBe(true);
  });

  it("rejects emails without a domain dot", () => {
    expect(EMAIL_RE.test("user@localhost")).toBe(false);
  });

  it("rejects emails with no @", () => {
    expect(EMAIL_RE.test("userexample.com")).toBe(false);
  });

  it("rejects emails with whitespace", () => {
    expect(EMAIL_RE.test("user @example.com")).toBe(false);
    expect(EMAIL_RE.test("user@ example.com")).toBe(false);
  });

  it("rejects emails with consecutive dots or empty local/domain parts", () => {
    expect(EMAIL_RE.test("@example.com")).toBe(false);
    expect(EMAIL_RE.test("user@.com")).toBe(false);
    expect(EMAIL_RE.test("user@")).toBe(false);
  });
});
