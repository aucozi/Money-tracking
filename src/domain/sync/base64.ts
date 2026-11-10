const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 for short ASCII strings (tokens, credentials). Written out here so the
 * result is the same in every JavaScript engine the app runs on.
 */
export function encodeBase64(text: string): string {
  const bytes: number[] = [];
  for (const char of unescape(encodeURIComponent(text))) bytes.push(char.charCodeAt(0));
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const chunk = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(chunk >> 18) & 63] + ALPHABET[(chunk >> 12) & 63];
    out += b === undefined ? '=' : ALPHABET[(chunk >> 6) & 63];
    out += c === undefined ? '=' : ALPHABET[chunk & 63];
  }
  return out;
}

/** Returns null when the input is not valid Base64. Accepts the URL-safe alphabet and missing padding. */
export function decodeBase64(input: string): string | null {
  const text = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!text || /[^A-Za-z0-9+/]/.test(text) || text.length % 4 === 1) return null;
  let bytes = '';
  for (let i = 0; i < text.length; i += 4) {
    const values = [0, 1, 2, 3].map((offset) => (i + offset < text.length ? ALPHABET.indexOf(text[i + offset]) : 0));
    const chunk = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    const available = Math.min(4, text.length - i);
    bytes += String.fromCharCode((chunk >> 16) & 255);
    if (available > 2) bytes += String.fromCharCode((chunk >> 8) & 255);
    if (available > 3) bytes += String.fromCharCode(chunk & 255);
  }
  try {
    return decodeURIComponent(escape(bytes));
  } catch {
    return null;
  }
}
