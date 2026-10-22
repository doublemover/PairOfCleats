const fail = message => Object.assign(new Error(message), { code: 'ERR_SQL_SOURCE_QUALIFIER' });
const keyword = (token, value) => token?.kind === 'name' && !token.quoted && token.value === value;

/** Bounded PostgreSQL token ranges used only to qualify nodes selected by the
 * application parser. No token/name search is used to resolve catalog identity.
 * Only direct SELECT projections and FROM/JOIN table heads are modeled. */
export const qualifySqlSelectRanges = (text, { check = () => {}, maxTokens = 16384 } = {}) => {
  if (typeof text !== 'string' || text.length > 32768 || !Number.isSafeInteger(maxTokens)
    || maxTokens < 1 || maxTokens > 16384) throw fail('SQL source qualifier bounds exceeded.');
  const tokens = [];
  let offset = 0;
  const append = (kind, start, value, quoted = false) => {
    if (tokens.length >= maxTokens) throw fail('SQL source token budget exhausted.');
    tokens.push({ kind, value, quoted, span: [start, offset] });
  };
  while (offset < text.length) {
    check();
    const start = offset, character = text[offset];
    if (/\s/u.test(character)) { offset++; continue; }
    if (text.startsWith('--', offset)) { const end = text.indexOf('\n', offset + 2); offset = end < 0 ? text.length : end + 1; continue; }
    if (text.startsWith('/*', offset)) {
      offset += 2; let depth = 1;
      while (offset < text.length && depth) {
        check();
        if (text.startsWith('/*', offset)) { if (++depth > 64) throw fail('SQL comment nesting budget exhausted.'); offset += 2; }
        else if (text.startsWith('*/', offset)) { depth--; offset += 2; }
        else offset++;
      }
      if (depth) throw fail('Unterminated source comment.');
      continue;
    }
    const escapedString = /[Ee]/u.test(character) && text[offset + 1] === "'";
    if (character === "'" || escapedString) {
      if (escapedString) offset++;
      offset++; let closed = false;
      while (offset < text.length) {
        check();
        if (escapedString && text[offset] === '\\') { offset += 2; continue; }
        if (text[offset++] !== "'") continue;
        if (text[offset] === "'") { offset++; continue; }
        closed = true; break;
      }
      if (!closed || offset > text.length) throw fail('Unterminated source string.');
      append('value', start, null); continue;
    }
    if (character === '$') {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/u.exec(text.slice(offset))?.[0];
      if (delimiter) {
        const end = text.indexOf(delimiter, offset + delimiter.length);
        if (end < 0) throw fail('Unterminated dollar-quoted source string.');
        offset = end + delimiter.length; append('value', start, null); continue;
      }
    }
    if (character === '"') {
      offset++; let value = '', closed = false;
      while (offset < text.length) {
        check();
        const next = text[offset++];
        if (next !== '"') { value += next; continue; }
        if (text[offset] === '"') { value += '"'; offset++; continue; }
        closed = true; break;
      }
      if (!closed || !value || value.length > 256) throw fail('Unsupported quoted source identifier.');
      append('name', start, value, true); continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      offset++;
      while (offset < text.length && /[A-Za-z_0-9$]/u.test(text[offset])) offset++;
      if (offset - start > 256) throw fail('Source identifier length budget exhausted.');
      append('name', start, text.slice(start, offset).toLowerCase()); continue;
    }
    if (/[0-9]/u.test(character)) {
      offset++;
      while (offset < text.length && /[0-9.eE+-]/u.test(text[offset])) offset++;
      append('value', start, null); continue;
    }
    offset += String.fromCodePoint(text.codePointAt(offset)).length;
    append('symbol', start, character);
  }
  const statements = [], current = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'symbol' && token.value === '(') { if (++depth > 128) throw fail('SQL source nesting budget exhausted.'); }
    if (token.kind === 'symbol' && token.value === ')') { if (--depth < 0) throw fail('Unbalanced source parentheses.'); }
    if (token.kind === 'symbol' && token.value === ';' && depth === 0) {
      if (current.length) statements.push(current.splice(0));
    } else current.push(token);
  }
  if (depth) throw fail('Unbalanced source parentheses.');
  if (current.length) statements.push(current);
  if (statements.length > 64) throw fail('SQL statement budget exhausted.');
  const identifier = (tokens, start, allowAlias) => {
    if (tokens[start]?.kind !== 'name') return null;
    const parts = [tokens[start]], first = start;
    let cursor = start + 1;
    while (tokens[cursor]?.value === '.' && tokens[cursor]?.kind === 'symbol') {
      if (parts.length >= 3 || tokens[cursor + 1]?.kind !== 'name') return null;
      parts.push(tokens[cursor + 1]); cursor += 2;
    }
    const span = [tokens[first].span[0], tokens[cursor - 1].span[1]];
    let alias = null;
    if (allowAlias) {
      if (keyword(tokens[cursor], 'as')) {
        if (tokens[cursor + 1]?.kind !== 'name') return null;
        alias = tokens[cursor + 1].value; cursor += 2;
      } else if (tokens[cursor]?.kind === 'name' && (tokens[cursor].quoted
        || !['join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'natural', 'on', 'using', 'where', 'group', 'order', 'having', 'limit', 'offset', 'fetch', 'for', 'union', 'intersect', 'except'].includes(tokens[cursor].value))) {
        alias = tokens[cursor].value; cursor++;
      }
    }
    return { parts: parts.map(token => token.value), quoted: parts.map(token => token.quoted), span, alias, end: cursor };
  };
  return statements.map(statement => {
    if (!keyword(statement[0], 'select')) return { supported: false, tables: [], columns: [] };
    let from = -1, nesting = 0;
    for (let index = 1; index < statement.length; index++) {
      const token = statement[index];
      if (token.kind === 'symbol' && token.value === '(') nesting++;
      else if (token.kind === 'symbol' && token.value === ')') nesting--;
      else if (nesting === 0 && keyword(token, 'from')) { from = index; break; }
    }
    if (from < 0) return { supported: false, tables: [], columns: [] };
    const columns = [], tables = [], segment = [];
    nesting = 0;
    const flush = () => {
      const parsed = identifier(segment, 0, true);
      columns.push(parsed?.end === segment.length ? parsed : null); segment.length = 0;
    };
    const projectionStart = keyword(statement[1], 'distinct') ? 2 : 1;
    for (let index = projectionStart; index < from; index++) {
      const token = statement[index];
      if (token.kind === 'symbol' && token.value === '(') nesting++;
      else if (token.kind === 'symbol' && token.value === ')') nesting--;
      if (nesting === 0 && token.kind === 'symbol' && token.value === ',') flush(); else segment.push(token);
    }
    flush();
    let cursor = from + 1, needTable = true; nesting = 0;
    while (cursor < statement.length) {
      check();
      const token = statement[cursor];
      if (needTable) {
        const parsed = identifier(statement, cursor, true);
        if (!parsed) return { supported: false, tables: [], columns: [] };
        tables.push(parsed); cursor = parsed.end; needTable = false; continue;
      }
      if (token.kind === 'symbol' && token.value === '(') nesting++;
      else if (token.kind === 'symbol' && token.value === ')') nesting--;
      if (nesting === 0 && token.kind === 'name' && !token.quoted
        && ['where', 'group', 'order', 'having', 'limit', 'offset', 'fetch', 'for', 'union', 'intersect', 'except'].includes(token.value)) break;
      if (nesting === 0 && (keyword(token, 'join') || (token.kind === 'symbol' && token.value === ','))) needTable = true;
      cursor++;
    }
    return { supported: !needTable, tables, columns };
  });
};
