import {
  addCollectorImport,
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
  'schema',
  'source'
]);

const REFERENCE_SECTION_TOKENS = new Set([
  'include',
  'includes',
  'import',
  'imports'
]);

const collectIniValues = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim().replace(/^["']|["']$/g, ''))
  .filter(Boolean);

export const collectIniImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, [
    '[',
    '=',
    'include',
    'import',
    'ref',
    'schema'
  ]);

  let section = '';
  for (const rawLine of lines) {
    if (!shouldScanLine(rawLine, precheck)) continue;
    const line = stripInlineCommentAware(rawLine, { markers: [';', '#'] });
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (sectionMatch?.[1]) {
      section = sectionMatch[1].trim().toLowerCase();
      continue;
    }

    const kvMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1].trim().toLowerCase();
    const value = kvMatch[2];

    if (!REFERENCE_KEY_TOKENS.has(key) && !REFERENCE_SECTION_TOKENS.has(section)) continue;
    for (const token of collectIniValues(value)) {
      addCollectorImport(imports, token);
    }
  }

  return Array.from(imports);
};
