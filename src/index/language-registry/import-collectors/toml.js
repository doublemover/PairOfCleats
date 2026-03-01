import {
  addCollectorImport,
  createCollectorBudgetContext,
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
  'source',
  'registry',
  'git'
]);
const TOML_SCAN_BUDGET = Object.freeze({
  maxChars: 786432,
  maxMatches: 4096,
  maxTokens: 2048,
  maxMs: 30
});

const normalizeTomlValue = (value) => String(value || '')
  .trim()
  .replace(/^["']|["']$/g, '')
  .replace(/,$/, '')
  .trim();

const collectInlineTableRefs = (value, scanBudget = null) => {
  const matcher = /\b(?:path|file|git|registry|url)\s*=\s*["']([^"']+)["']/g;
  const out = [];
  let match;
  while (!scanBudget?.exhausted && (match = matcher.exec(value)) !== null) {
    if (scanBudget && !scanBudget.consumeMatch()) break;
    out.push(normalizeTomlValue(match[1]));
    if (!match[0]) matcher.lastIndex += 1;
  }
  return out.filter(Boolean);
};

const collectTomlValues = (value, scanBudget = null) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((entry) => normalizeTomlValue(entry))
      .filter(Boolean);
  }

  const inlineTableValues = collectInlineTableRefs(trimmed, scanBudget);
  if (inlineTableValues.length) {
    return inlineTableValues;
  }

  const scalar = normalizeTomlValue(trimmed);
  return scalar ? [scalar] : [];
};

const collectDependencyReferences = (value, scanBudget = null) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return [];

  const inlineTableValues = collectInlineTableRefs(trimmed, scanBudget);
  if (inlineTableValues.length) {
    return inlineTableValues;
  }

  const scalar = normalizeTomlValue(trimmed);
  if (!scalar) return [];
  if (scalar.includes('/') || scalar.startsWith('.') || scalar.includes(':')) {
    return [scalar];
  }
  return [];
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

export const collectTomlImports = (text, options = {}) => {
  const imports = new Set();
  const budgetContext = createCollectorBudgetContext({
    text,
    options,
    collectorId: 'toml',
    defaults: TOML_SCAN_BUDGET
  });
  const { scanBudget } = budgetContext;
  try {
    const lines = String(budgetContext.source || '').split('\n');
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
      if (scanBudget.exhausted || !scanBudget.consumeTime()) break;
      if (!shouldScanLine(rawLine, precheck)) continue;
      const line = stripInlineCommentAware(rawLine, { markers: ['#'] });
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
        for (const token of collectDependencyReferences(value, scanBudget)) {
          if (!scanBudget.consumeToken()) break;
          addCollectorImport(imports, token);
        }
      }

      if (!REFERENCE_KEY_TOKENS.has(keyLower)) continue;
      for (const token of collectTomlValues(value, scanBudget)) {
        if (!scanBudget.consumeToken()) break;
        addCollectorImport(imports, token);
      }
    }
    return Array.from(imports);
  } finally {
    budgetContext.finalize();
  }
};
