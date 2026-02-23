import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

const normalizeConfigTreeSitterChunks = (chunks, format) => chunks.map((chunk) => {
  const rawName = typeof chunk?.name === 'string' ? chunk.name.trim() : '';
  const name = rawName || 'section';
  const existingMeta = chunk?.meta && typeof chunk.meta === 'object' ? chunk.meta : {};
  const rawTitle = typeof existingMeta.title === 'string' ? existingMeta.title.trim() : '';
  return {
    ...chunk,
    name,
    kind: chunk?.kind || 'ConfigSection',
    meta: {
      ...existingMeta,
      format,
      title: rawTitle || name
    }
  };
});

const JSON_ESCAPE_MAP = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t'
};

const parseJsonString = (text, start) => {
  let i = start + 1;
  let value = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (!next) return null;
      if (next === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
        value += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(JSON_ESCAPE_MAP, next)) return null;
      value += JSON_ESCAPE_MAP[next];
      i += 2;
      continue;
    }
    if (ch === '"') {
      return { value, end: i };
    }
    if (text.charCodeAt(i) <= 0x1f) return null;
    value += ch;
    i += 1;
  }
  return null;
};

const findNextNonWhitespace = (text, start) => {
  let i = start;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code !== 0x20 && code !== 0x0a && code !== 0x0d && code !== 0x09) {
      return i;
    }
    i += 1;
  }
  return -1;
};

const skipWhitespace = (text, start) => {
  const idx = findNextNonWhitespace(text, start);
  return idx < 0 ? text.length : idx;
};

const isDigit = (ch) => ch >= '0' && ch <= '9';

const parseJsonNumber = (text, start) => {
  let i = start;
  if (text[i] === '-') i += 1;
  if (i >= text.length) return null;
  if (text[i] === '0') {
    i += 1;
  } else if (isDigit(text[i])) {
    while (i < text.length && isDigit(text[i])) i += 1;
  } else {
    return null;
  }
  if (text[i] === '.') {
    i += 1;
    if (!isDigit(text[i])) return null;
    while (i < text.length && isDigit(text[i])) i += 1;
  }
  if (text[i] === 'e' || text[i] === 'E') {
    i += 1;
    if (text[i] === '+' || text[i] === '-') i += 1;
    if (!isDigit(text[i])) return null;
    while (i < text.length && isDigit(text[i])) i += 1;
  }
  return { end: i, type: 'primitive' };
};

const parseJsonLiteral = (text, start, literal) => (
  text.startsWith(literal, start)
    ? { end: start + literal.length, type: 'primitive' }
    : null
);

const parseJsonValue = (text, start, topLevelKeys, collectTopLevelKeys) => {
  const i = skipWhitespace(text, start);
  const ch = text[i];
  if (ch === '{') return parseJsonObject(text, i, topLevelKeys, collectTopLevelKeys);
  if (ch === '[') return parseJsonArray(text, i, topLevelKeys);
  if (ch === '"') {
    const parsed = parseJsonString(text, i);
    return parsed ? { end: parsed.end + 1, type: 'primitive' } : null;
  }
  if (ch === '-' || isDigit(ch)) return parseJsonNumber(text, i);
  if (ch === 't') return parseJsonLiteral(text, i, 'true');
  if (ch === 'f') return parseJsonLiteral(text, i, 'false');
  if (ch === 'n') return parseJsonLiteral(text, i, 'null');
  return null;
};

const parseJsonArray = (text, start, topLevelKeys) => {
  let i = skipWhitespace(text, start + 1);
  if (text[i] === ']') return { end: i + 1, type: 'array' };
  while (i < text.length) {
    const parsedValue = parseJsonValue(text, i, topLevelKeys, false);
    if (!parsedValue) return null;
    i = skipWhitespace(text, parsedValue.end);
    if (text[i] === ',') {
      i = skipWhitespace(text, i + 1);
      continue;
    }
    if (text[i] === ']') return { end: i + 1, type: 'array' };
    return null;
  }
  return null;
};

/**
 * Parse a JSON object and optionally collect top-level key offsets in one pass.
 *
 * This validates token structure without materializing the parsed object graph,
 * which keeps large config chunking linear in input size and memory.
 *
 * @param {string} text
 * @param {number} start
 * @param {Array<{name:string,index:number}>} topLevelKeys
 * @param {boolean} collectTopLevelKeys
 * @returns {{end:number,type:'object'}|null}
 */
const parseJsonObject = (text, start, topLevelKeys, collectTopLevelKeys) => {
  let i = skipWhitespace(text, start + 1);
  if (text[i] === '}') return { end: i + 1, type: 'object' };
  while (i < text.length) {
    if (text[i] !== '"') return null;
    const keyIndex = i;
    const parsedKey = parseJsonString(text, i);
    if (!parsedKey) return null;
    i = skipWhitespace(text, parsedKey.end + 1);
    if (text[i] !== ':') return null;
    i = skipWhitespace(text, i + 1);
    if (collectTopLevelKeys) {
      topLevelKeys.push({
        name: parsedKey.value || 'section',
        index: keyIndex
      });
    }
    const parsedValue = parseJsonValue(text, i, topLevelKeys, false);
    if (!parsedValue) return null;
    i = skipWhitespace(text, parsedValue.end);
    if (text[i] === ',') {
      i = skipWhitespace(text, i + 1);
      continue;
    }
    if (text[i] === '}') return { end: i + 1, type: 'object' };
    return null;
  }
  return null;
};

export function chunkJson(text, context) {
  if (context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'json',
      ext: '.json',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return normalizeConfigTreeSitterChunks(treeChunks, 'json');
  }
  const topLevelKeys = [];
  const start = findNextNonWhitespace(text, 0);
  if (start < 0) return null;
  const parsed = parseJsonValue(text, start, topLevelKeys, true);
  if (!parsed) return null;
  if (findNextNonWhitespace(text, parsed.end) >= 0) return null;
  if (parsed.type !== 'object') {
    return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'json' } }];
  }
  if (!topLevelKeys.length) {
    return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'json' } }];
  }
  const chunks = [];
  for (let k = 0; k < topLevelKeys.length; ++k) {
    const chunkStart = topLevelKeys[k].index;
    const end = k + 1 < topLevelKeys.length ? topLevelKeys[k + 1].index : text.length;
    const title = topLevelKeys[k].name || 'section';
    chunks.push({
      start: chunkStart,
      end,
      name: title,
      kind: 'ConfigSection',
      meta: { title, format: 'json' }
    });
  }
  return chunks;
}
