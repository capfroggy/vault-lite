export const CLIPBOARD_AUTO_CLEAR_MS = 20_000;

export type ClipboardField = "username" | "password";
export type ClipboardAutoClearResult = "cleared" | "skipped" | "unsupported";

export type SafeClipboard = {
  readText?: () => Promise<string>;
  writeText?: (value: string) => Promise<void>;
};

export function getClipboardFieldLabel(field: ClipboardField) {
  return field === "username" ? "Username" : "Password";
}

export function formatClipboardCountdown(milliseconds: number) {
  return `${Math.max(0, Math.ceil(milliseconds / 1000))}s`;
}

export async function clearClipboardIfOwned(
  clipboard: SafeClipboard | undefined,
  expectedValue: string,
): Promise<ClipboardAutoClearResult> {
  if (!clipboard?.readText || !clipboard.writeText || !expectedValue) {
    return "unsupported";
  }

  try {
    const currentValue = await clipboard.readText();

    if (currentValue !== expectedValue) {
      return "skipped";
    }

    await clipboard.writeText("");
    return "cleared";
  } catch {
    return "unsupported";
  }
}
