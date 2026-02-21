import { lineHasAnyInsensitive, shouldScanLine } from './utils.js';

const REFERENCE_KEY_TOKENS = new Set([
  'include',
  'includes',
  'import',
  'imports',
  'extends',
  'path',
  'file',
  'schema',
  'source',
  'registry',
  'git',
  'url'
]);

const addImport = (imports, value) => {
  const token = String(value || '').trim();
  if (!token) return;
  imports.add(token);
};

const normalizeTomlValue = (value) => String(value || '')
  .trim()
  .replace(/^["']|["']$/g, '')
  .replace(/,$/, '')
  .trim();

const collectTomlValues = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((entry) => normalizeTomlValue(entry))
      .filter(Boolean);
  }

  const inlineTablePathMatches = Array.from(trimmed.matchAll(/\b(?:path|file|git|registry|url)\s*=\s*["']([^"']+)["']/g));
  if (inlineTablePathMatches.length) {
    return inlineTablePathMatches.map((match) => normalizeTomlValue(match[1])).filter(Boolean);
  }

  const scalar = normalizeTomlValue(trimmed);
  return scalar ? [scalar] : [];
};

const isDependencySection = (sectionName) => {
  const normalized = String(sectionName || '').toLowerCase();
  return normalized === 'dependencies'
    || normalized.endsWith('.dependencies')
    || normalized === 'dev-dependencies'
    || normalized.endsWith('.dev-dependencies')
    || normalized === 'build-dependencies'
    || normalized.endsWith('.build-dependencies');
};

export const collectTomlImports = (text) => {
  const imports = new Set();
  const lines = String(text || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, [
    '[',
    '=',
    'dependency',
    'include',
    'import',
    'path',
    'git',
    'registry'
  ]);

  let currentSection = '';
  for (const rawLine of lines) {
    if (!shouldScanLine(rawLine, precheck)) continue;
    const line = rawLine.replace(/#.*$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^\[\[?([^\]]+)\]\]?$/);
    if (sectionMatch?.[1]) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    const keyMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!keyMatch) continue;
    const key = keyMatch[1].trim();
    const keyLower = key.toLowerCase();
    const value = keyMatch[2];

    if (isDependencySection(currentSection)) {
      addImport(imports, `dependency:${key}`);
    }

    if (!REFERENCE_KEY_TOKENS.has(keyLower) && !keyLower.endsWith('path') && !keyLower.endsWith('file')) continue;
    for (const token of collectTomlValues(value)) {
      addImport(imports, token);
    }
  }

  return Array.from(imports);
};
