import { buildTreeSitterChunks } from '../../../lang/tree-sitter.js';
import { getTreeSitterOptions } from '../tree-sitter.js';

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

export function chunkJson(text, context) {
  if (context?.treeSitter?.configChunking === true) {
    const treeChunks = buildTreeSitterChunks({
      text,
      languageId: 'json',
      ext: '.json',
      options: getTreeSitterOptions(context)
    });
    if (treeChunks && treeChunks.length) return treeChunks;
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
      const nextIdx = text.slice(parsedString.end + 1).search(/\S/);
      const nextPos = nextIdx >= 0 ? parsedString.end + 1 + nextIdx : -1;
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
