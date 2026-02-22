import {
  isPseudoImportToken,
  lineHasAnyInsensitive,
  shouldScanLine,
  stripInlineCommentAware
} from './utils.js';

const REFERENCE_KEY_TOKENS = new Set([
  'include',
  'includes',
  'import',
  'imports',
  'extends',
  'ref',
  '$ref',
  'schema'
]);

const addImport = (imports, value) => {
  const token = String(value || '').trim();
  if (!token || isPseudoImportToken(token)) return;
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

export const collectYamlImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, [
    ':',
    'include',
    'import',
    'extends',
    '$ref',
    'schema'
  ]);

  let listKeyIndent = -1;
  for (const rawLine of lines) {
    const line = stripInlineCommentAware(rawLine, {
      markers: ['#'],
      requireWhitespaceBefore: true
    });
    const trimmed = line.trim();
    const isListContinuation = listKeyIndent >= 0 && /^-\s+/.test(trimmed);
    if (!shouldScanLine(rawLine, precheck) && !isListContinuation) continue;
    if (!trimmed) continue;

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
    if (scalarValue && !value.startsWith('[') && !/^[*&][A-Za-z0-9_.-]+$/.test(scalarValue)) {
      addImport(imports, scalarValue);
    }
  }
  return Array.from(imports);
};
