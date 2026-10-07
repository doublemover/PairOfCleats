/**
 * Parse trailing JSON payloads emitted by benchmark scripts that may also print
 * human-readable logs earlier in stdout.
 *
 * @param {string} text
 * @returns {any|null}
 */
export const parseTrailingJson = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {}
  }
  const match = raw.match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
};
