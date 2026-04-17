import { describe, expect, it, vi } from "vitest";
import {
  clearClipboardIfOwned,
  formatClipboardCountdown,
  getClipboardFieldLabel,
} from "@/lib/clipboard/session-clipboard";

describe("session clipboard helpers", () => {
  it("formats the remaining countdown in seconds", () => {
    expect(formatClipboardCountdown(20_000)).toBe("20s");
    expect(formatClipboardCountdown(19_001)).toBe("20s");
    expect(formatClipboardCountdown(0)).toBe("0s");
  });

  it("returns a human label for the copied field", () => {
    expect(getClipboardFieldLabel("username")).toBe("Username");
    expect(getClipboardFieldLabel("password")).toBe("Password");
  });

  it("clears the clipboard when the current content still matches", async () => {
    const clipboard = {
      readText: vi.fn(async () => "secret-value"),
      writeText: vi.fn(async () => undefined),
    };

    await expect(clearClipboardIfOwned(clipboard, "secret-value")).resolves.toBe("cleared");
    expect(clipboard.readText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).toHaveBeenCalledWith("");
  });

  it("leaves the clipboard alone when another value replaced it", async () => {
    const clipboard = {
      readText: vi.fn(async () => "something-else"),
      writeText: vi.fn(async () => undefined),
    };

    await expect(clearClipboardIfOwned(clipboard, "secret-value")).resolves.toBe("skipped");
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("reports unsupported when safe verification is unavailable", async () => {
    const clipboard = {
      readText: vi.fn(async () => {
        throw new Error("clipboard-read blocked");
      }),
      writeText: vi.fn(async () => undefined),
    };

    await expect(clearClipboardIfOwned(clipboard, "secret-value")).resolves.toBe("unsupported");
  });
});
