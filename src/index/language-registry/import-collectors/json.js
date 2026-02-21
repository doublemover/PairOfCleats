const REFERENCE_KEY_TOKENS = new Set([
  '$ref',
  'ref',
  'include',
  'includes',
  'import',
  'imports',
  'extends',
  'schema',
  'path',
  'paths',
  'file',
  'files',
  'from',
  'href',
  'url'
]);

const addImport = (imports, value) => {
  const token = String(value || '').trim();
  if (!token) return;
  imports.add(token);
};

const collectStringValues = (value, out, maxDepth = 3) => {
  if (maxDepth < 0) return;
  if (typeof value === 'string') {
    addImport(out, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, out, maxDepth - 1);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      collectStringValues(nested, out, maxDepth - 1);
    }
  }
};

const traverseJson = (value, imports) => {
  if (Array.isArray(value)) {
    for (const item of value) {
      traverseJson(item, imports);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const keyLower = key.toLowerCase();
    if (REFERENCE_KEY_TOKENS.has(keyLower)) {
      collectStringValues(nested, imports);
    } else if ((keyLower.endsWith('path') || keyLower.endsWith('file')) && typeof nested === 'string') {
      addImport(imports, nested);
    }
    traverseJson(nested, imports);
  }
};

export const collectJsonImports = (text) => {
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
