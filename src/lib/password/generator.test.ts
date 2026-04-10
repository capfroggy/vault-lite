import { describe, expect, it } from "vitest";
import { generatePassword } from "@/lib/password/generator";

describe("generatePassword", () => {
  it("includes at least one character from each selected pool", () => {
    const password = generatePassword({
      length: 24,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
      excludeAmbiguous: true,
    });

    expect(password).toHaveLength(24);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/\d/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  it("removes ambiguous characters when requested", () => {
    const password = generatePassword({
      length: 32,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: false,
      excludeAmbiguous: true,
    });

    expect(password).not.toMatch(/[O0Il1]/);
  });
});
