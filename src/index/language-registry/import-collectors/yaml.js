import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

const REFERENCE_KEY_TOKENS = new Set([
  'include',
  'includes',
  'import',
  'imports',
  'extends',
  'ref',
  '$ref',
  'schema',
  'path',
  'file',
  'from'
]);

const addImport = (imports, value) => {
  const token = String(value || '').trim();
  if (!token) return;
  imports.add(token);
};

const normalizeScalar = (value) => String(value || '')
  .trim()
  .replace(/^["']|["']$/g, '')
  .replace(/,$/, '')
  .trim();

const collectInlineList = (value) => {
  const trimmed = String(value || '').trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) return [];
  return trimmed
    .slice(1, -1)
    .split(',')
    .map((entry) => normalizeScalar(entry))
    .filter(Boolean);
};

const addAnchorsAndAliases = (imports, line) => {
  let match;
  const anchorRe = /(^|[^A-Za-z0-9_.-])&([A-Za-z0-9_.-]+)/g;
  while ((match = anchorRe.exec(line)) !== null) {
    addImport(imports, `anchor:${match[2]}`);
    if (!match[0]) anchorRe.lastIndex += 1;
  }
  const aliasRe = /(^|[^A-Za-z0-9_.-])\*([A-Za-z0-9_.-]+)/g;
  while ((match = aliasRe.exec(line)) !== null) {
    addImport(imports, `alias:${match[2]}`);
    if (!match[0]) aliasRe.lastIndex += 1;
  }
};

export const collectYamlImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, [
    '&',
    '*',
    ':',
    'include',
    'import',
    'extends',
    '$ref',
    'schema'
  ]);

  let listKeyIndent = -1;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, '');
    const trimmed = line.trim();
    const isListContinuation = listKeyIndent >= 0 && /^-\s+/.test(trimmed);
    if (!shouldScanLine(rawLine, precheck) && !isListContinuation) continue;
    if (!trimmed) continue;

    addAnchorsAndAliases(imports, line);

    const indent = line.length - line.trimStart().length;
    const listMatch = trimmed.match(/^-+\s*(.+)$/);
    if (listMatch && listKeyIndent >= 0 && indent >= listKeyIndent) {
      const value = normalizeScalar(listMatch[1]);
      if (value) addImport(imports, value);
      continue;
    }
    if (listKeyIndent >= 0 && indent <= listKeyIndent) {
      listKeyIndent = -1;
    }

    const keyValueMatch = line.match(/^\s*(['"]?[^'"#:]+['"]?)\s*:\s*(.*)$/);
    if (!keyValueMatch) continue;
    const key = normalizeScalar(keyValueMatch[1]).toLowerCase();
    const value = String(keyValueMatch[2] || '').trim();
    if (!REFERENCE_KEY_TOKENS.has(key)) continue;

    if (!value) {
      listKeyIndent = indent;
      continue;
    }
    for (const item of collectInlineList(value)) {
      addImport(imports, item);
    }
    const scalarValue = normalizeScalar(value);
    if (scalarValue && !value.startsWith('[')) {
      addImport(imports, scalarValue);
    }
  }
  return Array.from(imports);
};
