import { describe, it, expect } from "vitest";
import { greetingKey, greetingName } from "@/utils/greeting";

describe("greetingKey", () => {
  it("picks the band each hour falls in", () => {
    expect(greetingKey(8)).toBe("greeting_morning");
    expect(greetingKey(14)).toBe("greeting_afternoon");
    expect(greetingKey(19)).toBe("greeting_evening");
  });

  it("wraps night around both ends of the day", () => {
    expect(greetingKey(0)).toBe("greeting_night");
    expect(greetingKey(23)).toBe("greeting_night");
  });

  it("puts each boundary hour in the later band", () => {
    // The off-by-one that reads as "Good evening" at five past midday.
    expect(greetingKey(5)).toBe("greeting_night");
    expect(greetingKey(6)).toBe("greeting_morning");
    expect(greetingKey(11)).toBe("greeting_morning");
    expect(greetingKey(12)).toBe("greeting_afternoon");
    expect(greetingKey(16)).toBe("greeting_afternoon");
    expect(greetingKey(17)).toBe("greeting_evening");
    expect(greetingKey(21)).toBe("greeting_evening");
    expect(greetingKey(22)).toBe("greeting_night");
  });
});

describe("greetingName", () => {
  it("prefers the name the user set", () => {
    expect(greetingName("Alex", "someone@example.com")).toBe("Alex");
  });

  it("falls back to a capitalised email local part", () => {
    expect(greetingName(null, "alex@example.com")).toBe("Alex");
    expect(greetingName(undefined, "alex.smith+tag@example.com")).toBe(
      "Alex.smith+tag",
    );
  });

  it("treats a blank first name as unset", () => {
    expect(greetingName(" ".repeat(3), "alex@example.com")).toBe("Alex");
  });

  it("returns null when there is nothing to call them", () => {
    // The caller then greets without a name — interpolating "" leaves "Good morning, ".
    expect(greetingName(null, null)).toBeNull();
    expect(greetingName(null, "")).toBeNull();
    expect(greetingName(null, "@example.com")).toBeNull();
  });

  it("leaves a leading non-letter alone rather than mangling it", () => {
    expect(greetingName(null, "_alex@example.com")).toBe("_alex");
  });
});
