// Decode only source-qualified static R argument spellings. This is passive
// dependency extraction; ambient byte encodings and expression evaluation are
// deliberately not used to manufacture a concrete path or package identity.
export const decodeRArgumentToken = (token, source) => {
  if (!token || !Number.isSafeInteger(token.start) || !Number.isSafeInteger(token.end)) return null;
  const raw = source.slice(token.start, token.end), quote = raw[0];
  if (!['"', "'", '`'].includes(quote)) return token.kind === 'identifier'
    ? { kind: 'identifier', value: token.value } : null;
  if (raw.length < 2 || raw.at(-1) !== quote) return null;
  let value = '';
  const escapes = new Map([['a', '\x07'], ['b', '\b'], ['f', '\f'], ['n', '\n'],
    ['r', '\r'], ['t', '\t'], ['v', '\v'], ['\\', '\\'], ['"', '"'], ["'", "'"], ['`', '`']]);
  for (let index = 1; index < raw.length - 1; index += 1) {
    const char = raw[index];
    if (char !== '\\') { value += char; continue; }
    const escaped = raw[++index];
    if (escapes.has(escaped)) { value += escapes.get(escaped); continue; }
    let digits = '', radix = 16, unicode = false;
    if (escaped === 'u' || escaped === 'U') {
      unicode = true;
      const maximum = escaped === 'u' ? 4 : 8;
      if (raw[index + 1] === '{') {
        const close = raw.indexOf('}', index + 2);
        if (close < 0) return null;
        digits = raw.slice(index + 2, close);
        if (!digits.length || digits.length > maximum || !/^[a-fA-F0-9]+$/u.test(digits)) return null;
        index = close;
      } else {
        while (digits.length < maximum && /[a-fA-F0-9]/u.test(raw[index + 1] || '')) digits += raw[++index];
      }
    } else if (escaped === 'x') {
      while (digits.length < 2 && /[a-fA-F0-9]/u.test(raw[index + 1] || '')) digits += raw[++index];
    } else if (/[0-7]/u.test(escaped || '')) {
      radix = 8; digits = escaped;
      while (digits.length < 3 && /[0-7]/u.test(raw[index + 1] || '')) digits += raw[++index];
    } else return null;
    if (!digits.length) return null;
    const code = Number.parseInt(digits, radix);
    // Hex/octal bytes above ASCII need the producing R encoding to establish
    // a Unicode filename. Explicit Unicode escapes do not have that ambiguity.
    if (code === 0 || code > (unicode ? 0x10ffff : 0x7f) || code >= 0xd800 && code <= 0xdfff) return null;
    value += String.fromCodePoint(code);
  }
  return { kind: quote === '`' ? 'identifier' : 'string', value };
};
