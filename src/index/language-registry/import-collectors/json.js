import { sanitizeCollectorImportToken } from './utils.js';

const REFERENCE_KEY_TOKENS = new Set([
  '$ref',
  'ref',
  'include',
  'includes',
  'import',
  'imports',
  'extends',
  'schema',
  'source'
]);
const MAX_TRAVERSE_NODES = 20000;
const MAX_REFERENCE_VALUE_DEPTH = 3;

const addImport = (imports, value) => {
  const token = sanitizeCollectorImportToken(value);
  if (!token) return;
  imports.add(token);
};

const collectStringValues = (value, out, maxDepth = MAX_REFERENCE_VALUE_DEPTH) => {
  const queue = [{ value, depth: maxDepth }];
  let cursor = 0;
  let visited = 0;
  while (cursor < queue.length && visited < MAX_TRAVERSE_NODES) {
    const current = queue[cursor];
    cursor += 1;
    visited += 1;
    if (!current || current.depth < 0) continue;
    if (typeof current.value === 'string') {
      addImport(out, current.value);
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        queue.push({ value: item, depth: current.depth - 1 });
      }
      continue;
    }
    if (current.value && typeof current.value === 'object') {
      for (const nested of Object.values(current.value)) {
        queue.push({ value: nested, depth: current.depth - 1 });
      }
    }
  }
};

const traverseJson = (value, imports) => {
  const queue = [value];
  let cursor = 0;
  let visited = 0;
  while (cursor < queue.length && visited < MAX_TRAVERSE_NODES) {
    const current = queue[cursor];
    cursor += 1;
    visited += 1;
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    if (!current || typeof current !== 'object') continue;
    for (const [key, nested] of Object.entries(current)) {
      const keyLower = key.toLowerCase();
      if (REFERENCE_KEY_TOKENS.has(keyLower)) {
        collectStringValues(nested, imports);
      }
      queue.push(nested);
    }
  }
};

export const collectJsonImports = (text) => {
  if (!String(text || '').includes('"')) return [];
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch {
    return [];
  }
  const imports = new Set();
  traverseJson(parsed, imports);
  return Array.from(imports);
};
