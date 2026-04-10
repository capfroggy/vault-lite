export type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: "Fragile" | "Weak" | "Fair" | "Strong" | "Excellent";
  feedback: string[];
};

const COMMON_PATTERNS = [
  "password",
  "123456",
  "qwerty",
  "admin",
  "letmein",
  "welcome",
];

function containsCharacterGroup(password: string, pattern: RegExp) {
  return pattern.test(password);
}

export function assessPasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return {
      score: 0,
      label: "Fragile",
      feedback: ["Use a unique passphrase with at least 14 characters."],
    };
  }

  const lowerCasePassword = password.toLowerCase();
  const feedback: string[] = [];
  let score = 0;

  if (password.length >= 12) {
    score += 1;
  } else {
    feedback.push("Increase the length to at least 12 characters.");
  }

  if (password.length >= 16) {
    score += 1;
  }

  const diversityScore = [
    containsCharacterGroup(password, /[a-z]/),
    containsCharacterGroup(password, /[A-Z]/),
    containsCharacterGroup(password, /\d/),
    containsCharacterGroup(password, /[^A-Za-z0-9]/),
  ].filter(Boolean).length;

  if (diversityScore >= 3) {
    score += 1;
  } else {
    feedback.push("Mix uppercase, lowercase, numbers, or symbols.");
  }

  if (!COMMON_PATTERNS.some((pattern) => lowerCasePassword.includes(pattern))) {
    score += 1;
  } else {
    feedback.push("Avoid common words or keyboard patterns.");
  }

  if (/(.)\1\1/.test(password)) {
    score = Math.max(score - 1, 0);
    feedback.push("Avoid repeated characters like aaa or 111.");
  }

  const normalizedScore = Math.min(score, 4) as PasswordStrength["score"];

  return {
    score: normalizedScore,
    label: ["Fragile", "Weak", "Fair", "Strong", "Excellent"][normalizedScore] as PasswordStrength["label"],
    feedback:
      feedback.length > 0
        ? feedback
        : ["Good shape. Keep it unique and never reuse it between sites."],
  };
}
