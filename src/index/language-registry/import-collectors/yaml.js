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
  'schema'
]);
const YAML_SCAN_BUDGET = Object.freeze({
  maxChars: 786432,
  maxLines: 20000,
  maxMatches: 8192,
  maxTokens: 4096,
  maxMs: 30
});

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

export const collectYamlImports = (text, options = {}) => {
  const imports = new Set();
  const budgetContext = createCollectorBudgetContext({
    text,
    options,
    collectorId: 'yaml',
    defaults: YAML_SCAN_BUDGET
  });
  const { scanBudget } = budgetContext;
  const lines = String(budgetContext.source || '').split('\n');
  const precheck = (value) => lineHasAnyInsensitive(value, [
    ':',
    'include',
    'import',
    'extends',
    '$ref',
    'schema'
  ]);

  let listKeyIndent = -1;
  try {
    for (const rawLine of lines) {
      if (scanBudget.exhausted || !scanBudget.consumeTime()) break;
      const line = stripInlineCommentAware(rawLine, {
        markers: ['#'],
        requireWhitespaceBefore: true
      });
      const trimmed = line.trim();
      const isListContinuation = listKeyIndent >= 0 && /^-\s+/.test(trimmed);
      if (!shouldScanLine(rawLine, precheck) && !isListContinuation) continue;
      if (!scanBudget.consumeLine()) break;
      if (!trimmed) continue;

      const indent = line.length - line.trimStart().length;
      const listMatch = trimmed.match(/^-+\s*(.+)$/);
      if (listMatch && listKeyIndent >= 0 && indent >= listKeyIndent) {
        if (!scanBudget.consumeMatch()) break;
        const value = normalizeScalar(listMatch[1]);
        if (value && !scanBudget.consumeToken()) break;
        if (value) addCollectorImport(imports, value);
        continue;
      }
      if (listKeyIndent >= 0 && indent <= listKeyIndent) {
        listKeyIndent = -1;
      }

      const keyValueMatch = line.match(/^\s*(['"]?[^'"#:]+['"]?)\s*:\s*(.*)$/);
      if (!keyValueMatch) continue;
      if (!scanBudget.consumeMatch()) break;
      const key = normalizeScalar(keyValueMatch[1]).toLowerCase();
      const value = String(keyValueMatch[2] || '').trim();
      if (!REFERENCE_KEY_TOKENS.has(key)) continue;

      if (!value) {
        listKeyIndent = indent;
        continue;
      }
      for (const item of collectInlineList(value)) {
        if (!scanBudget.consumeToken()) break;
        addCollectorImport(imports, item);
      }
      const scalarValue = normalizeScalar(value);
      if (scalarValue && !value.startsWith('[') && !/^[*&][A-Za-z0-9_.-]+$/.test(scalarValue)) {
        if (!scanBudget.consumeToken()) break;
        addCollectorImport(imports, scalarValue);
      }
    }
  } finally {
    budgetContext.finalize();
  }
  return Array.from(imports);
};
