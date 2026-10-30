const fields = new Map([['file', 'file'], ['path', 'file'], ['lang', 'lang'], ['language', 'lang'],
  ['ext', 'ext'], ['extension', 'ext'], ['type', 'type'], ['kind', 'type']]);
const MAX_EXPRESSION_LENGTH = 65536;
const MAX_VALUES = 4096;
const whitespace = character => /\s/u.test(character);

/** @typedef {{code:string,message:string,start:number,end:number}} FilterDiagnostic */
/** @typedef {{field:string,value:string,start:number,end:number,valueStart:number,valueEnd:number}} FilterTerm */

/** One linear, bounded grammar shared by every --filter consumer. Offsets use
 * the original JavaScript string's UTF-16 coordinates, including quoted input.
 * A comma continues a field's value list unless the next atom names a field;
 * whitespace starts a new atom whose default field is file. */
export const parseFilterExpression = raw => {
  const values = { file: [], lang: [], ext: [], type: [] }, diagnostics = [], terms = [];
  const fail = (code, message, start, end) => {
    if (diagnostics.length < 16) diagnostics.push({ code, message, start, end });
  };
  const finish = () => ({ ...Object.fromEntries(Object.entries(values).map(([key, list]) =>
    [key, list.length ? list : null])), errors: diagnostics.map(row => `${row.message} at ${row.start}`), diagnostics, terms });
  if (raw == null || raw === '') return finish();
  if (typeof raw !== 'string') {
    fail('invalid_type', 'Filter expression must be a string', 0, 0); return finish();
  }
  if (raw.length > MAX_EXPRESSION_LENGTH) {
    fail('expression_limit', `Filter expression exceeds ${MAX_EXPRESSION_LENGTH} UTF-16 units`, 0, raw.length); return finish();
  }
  let cursor = 0, previousField = 'file', continuation = false;
  while (cursor < raw.length) {
    while (cursor < raw.length && whitespace(raw[cursor])) cursor++;
    if (cursor === raw.length) break;
    if (terms.length >= MAX_VALUES) {
      fail('value_limit', `Filter expression exceeds ${MAX_VALUES} values`, cursor, raw.length); return finish();
    }
    if (raw[cursor] === ',') {
      fail('empty_value', 'Missing filter value before comma', cursor, cursor + 1); cursor++; continue;
    }
    const start = cursor;
    let decoded = '', quote = null, quoteStart = -1, separator = -1, valueStart = start, closedQuote = false;
    const wholeQuoted = raw[cursor] === '"' || raw[cursor] === "'";
    while (cursor < raw.length) {
      const character = raw[cursor];
      if (quote) {
        if (character === quote) { quote = null; closedQuote = true; cursor++; continue; }
        if (character === '\\' && (raw[cursor + 1] === quote || raw[cursor + 1] === '\\')) {
          decoded += raw[cursor + 1]; cursor += 2; continue;
        }
      } else {
        if (whitespace(character) || character === ',') break;
        if (closedQuote) {
          fail('trailing_quote_text', 'Unexpected text after closing filter quote', cursor, cursor + 1);
          closedQuote = false;
        }
        if ((character === '"' || character === "'")
          && (cursor === start || raw[cursor - 1] === ':' || raw[cursor - 1] === '=')) {
          quote = character; quoteStart = cursor; cursor++; continue;
        }
        if (character === '\\' && raw[cursor + 1] !== undefined
          && (whitespace(raw[cursor + 1]) || [',', '"', "'"].includes(raw[cursor + 1]))) {
          decoded += raw[cursor + 1]; cursor += 2; continue;
        }
      }
      if (separator < 0 && (character === ':' || character === '=') && (!quote || wholeQuoted)) {
        separator = decoded.length; valueStart = cursor + 1;
      }
      decoded += character; cursor++;
    }
    if (quote) { fail('unclosed_quote', 'Unclosed filter quote', quoteStart, raw.length); return finish(); }
    const windowsPath = /^[A-Za-z]:[\\/]/u.test(decoded);
    const named = separator >= 0 && !windowsPath;
    let field = continuation ? previousField : 'file', value = decoded;
    if (named) {
      const key = decoded.slice(0, separator).toLowerCase();
      field = fields.get(key);
      value = decoded.slice(separator + 1);
      if (!field) fail('unknown_field', `Unknown filter key ${key.slice(0, 128)}`, start, valueStart - 1);
    }
    if (!value.length) fail('empty_value', 'Missing filter value', valueStart, cursor);
    if (field && value.length) {
      values[field].push(value);
      terms.push({ field, value, start, end: cursor, valueStart: named ? valueStart : start, valueEnd: cursor });
      previousField = field;
    }
    continuation = raw[cursor] === ',';
    if (continuation) {
      const comma = cursor++;
      let next = cursor;
      while (next < raw.length && whitespace(raw[next])) next++;
      if (next === raw.length) fail('empty_value', 'Missing filter value after comma', comma, comma + 1);
    }
  }
  return finish();
};

/** Serialize typed values without reinterpreting commas, spaces or escapes. */
export const serializeFilterExpression = filters => {
  const atoms = [];
  for (const field of ['file', 'lang', 'ext', 'type']) {
    const values = filters?.[field];
    if (values == null) continue;
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !value.length)) {
      throw new TypeError(`Filter ${field} must contain nonempty string values.`);
    }
    for (const value of values) atoms.push(`${field}:"${value.replace(/["\\]/g, '\\$&')}"`);
  }
  const result = atoms.join(' ');
  if (parseFilterExpression(result).errors.length) throw new RangeError('Serialized filter expression exceeds its grammar bounds.');
  return result;
};
