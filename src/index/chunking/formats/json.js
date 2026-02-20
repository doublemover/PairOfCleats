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

const parseJsonString = (text, start) => {
  let i = start + 1;
  let value = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\\\') {
      if (i + 1 < text.length) {
        value += text[i + 1];
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      return { value, end: i };
    }
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
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'json' } }];
  }
  const keys = [];
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const parsedString = parseJsonString(text, i);
      if (!parsedString) break;
      const nextPos = findNextNonWhitespace(text, parsedString.end + 1);
      if (nextPos > 0 && text[nextPos] === ':' && depth === 1) {
        keys.push({ name: parsedString.value, index: i });
      }
      i = parsedString.end + 1;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    if (ch === '}' || ch === ']') depth -= 1;
    i += 1;
  }
  if (!keys.length) return [{ start: 0, end: text.length, name: 'root', kind: 'ConfigSection', meta: { format: 'json' } }];
  const chunks = [];
  for (let k = 0; k < keys.length; ++k) {
    const start = keys[k].index;
    const end = k + 1 < keys.length ? keys[k + 1].index : text.length;
    const title = keys[k].name || 'section';
    chunks.push({
      start,
      end,
      name: title,
      kind: 'ConfigSection',
      meta: { title, format: 'json' }
    });
  }
  return chunks;
}
