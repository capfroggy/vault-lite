export type PasswordRecipe = {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
};

const CHARACTER_SETS = {
  uppercase: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lowercase: "abcdefghijkmnopqrstuvwxyz",
  numbers: "23456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/|",
} as const;

const AMBIGUOUS_CHARACTERS = /[O0Il1]/g;

function getWebCrypto() {
  if (!globalThis.crypto) {
    throw new Error("Secure random generation is unavailable.");
  }

  return globalThis.crypto;
}

function randomIndex(max: number) {
  const values = new Uint32Array(1);
  getWebCrypto().getRandomValues(values);
  return values[0] % max;
}

function shuffle(value: string[]) {
  const copy = [...value];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }

  return copy;
}

export function generatePassword(recipe: PasswordRecipe) {
  const pools = [
    recipe.uppercase ? CHARACTER_SETS.uppercase : "",
    recipe.lowercase ? CHARACTER_SETS.lowercase : "",
    recipe.numbers ? CHARACTER_SETS.numbers : "",
    recipe.symbols ? CHARACTER_SETS.symbols : "",
  ]
    .map((pool) => (recipe.excludeAmbiguous ? pool.replace(AMBIGUOUS_CHARACTERS, "") : pool))
    .filter(Boolean);

  if (pools.length === 0) {
    throw new Error("Choose at least one character set.");
  }

  const normalizedLength = Math.max(recipe.length, pools.length);
  const allCharacters = pools.join("");
  const password = pools.map((pool) => pool[randomIndex(pool.length)]);

  for (let index = password.length; index < normalizedLength; index += 1) {
    password.push(allCharacters[randomIndex(allCharacters.length)]);
  }

  return shuffle(password).join("");
}
