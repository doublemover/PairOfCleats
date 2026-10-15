/** Only parser-established scalar values are admitted; unsupported syntax stays null. */
export const semanticLiteralScalar = ({ kind, value, text = '', language = 'javascript' }) => {
  if (typeof text !== 'string' || text.length > 65536) return null;
  if (/BigInt/i.test(kind)) {
    const raw = String(value ?? text).replace(/n$/, '');
    if (raw.length > 4096) return null;
    try { return { type: 'bigint', representation: BigInt(raw).toString() }; } catch { return null; }
  }
  if (/Null/i.test(kind) || value === null || text === 'null' || language === 'python' && text === 'None') {
    return { type: 'null', representation: 'null' };
  }
  if (typeof value === 'boolean' || /^(true|false)$/i.test(text) && /keyword|boolean|true|false/i.test(kind)) {
    const boolean = typeof value === 'boolean' ? value : text.toLowerCase() === 'true';
    return { type: 'boolean', representation: String(boolean) };
  }
  if (typeof value === 'number' || /NumericLiteral/.test(kind)) {
    const number = typeof value === 'number' ? value : Number(value ?? text);
    return Number.isFinite(number) ? { type: 'number', representation: Object.is(number, -0) ? '-0' : String(number) } : null;
  }
  const string = typeof value === 'string' && /String|Literal/.test(kind) ? value : value?.cooked;
  if (typeof string === 'string' && Buffer.byteLength(string) <= 65536) {
    return { type: 'string', representation: JSON.stringify(string) };
  }
  return null;
};
