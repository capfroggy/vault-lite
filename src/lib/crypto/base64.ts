function toBinary(bytes: Uint8Array) {
  let output = "";

  for (const byte of bytes) {
    output += String.fromCharCode(byte);
  }

  return output;
}

export function bytesToBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  return btoa(toBinary(bytes));
}

export function base64ToBytes(value: string) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
