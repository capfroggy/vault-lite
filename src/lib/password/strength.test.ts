import { describe, expect, it } from "vitest";
import { assessPasswordStrength } from "@/lib/password/strength";

describe("assessPasswordStrength", () => {
  it("flags weak and common passwords", () => {
    const result = assessPasswordStrength("password123");

    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.feedback.join(" ")).toContain("Avoid common words");
  });

  it("rewards long and mixed passwords", () => {
    const result = assessPasswordStrength("Moss-Cascade-Frame-2719!");

    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.label).toMatch(/Strong|Excellent/);
  });
});
