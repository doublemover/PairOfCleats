import {
  addCollectorImport,
  createCollectorBudgetContext,
  createCommentAwareLineStripper,
  lineHasAnyInsensitive,
  shouldScanLine
} from './utils.js';

const RAZOR_USING_DIRECTIVE_RX = /^\s*@using\s+(.+)$/i;
const RAZOR_USING_TARGET_RX = /^(?:(?:static)\s+)?(?:(?:[A-Za-z_][A-Za-z0-9_]*)\s*=\s*)?((?:global::)?[A-Za-z_][A-Za-z0-9_]*(?:(?:\.|::)[A-Za-z_][A-Za-z0-9_]*)*)$/i;
const RAZOR_SCAN_BUDGET = Object.freeze({
  maxChars: 524288,
  maxLines: 4096,
  maxMatches: 2048,
  maxTokens: 1024,
  maxMs: 20
});

const parseRazorUsingTarget = (line) => {
  const directiveMatch = String(line || '').match(RAZOR_USING_DIRECTIVE_RX);
  if (!directiveMatch?.[1]) return '';
  let clause = directiveMatch[1].trim();
  const firstSemicolon = clause.indexOf(';');
  if (firstSemicolon >= 0) {
    clause = clause.slice(0, firstSemicolon);
  }
  clause = clause.trim().replace(/[;]+$/g, '');
  if (!clause || clause.startsWith('(')) return '';
  const targetMatch = clause.match(RAZOR_USING_TARGET_RX);
  return targetMatch?.[1] ? targetMatch[1].trim() : '';
};

export const collectRazorImports = (text, options = {}) => {
  const imports = new Set();
  const budgetContext = createCollectorBudgetContext({
    text,
    options,
    collectorId: 'razor',
    defaults: RAZOR_SCAN_BUDGET
  });
  const { scanBudget } = budgetContext;
  const lines = budgetContext.source.split('\n');
  const stripComments = createCommentAwareLineStripper({
    markers: ['//'],
    blockCommentPairs: [['@*', '*@']],
    requireWhitespaceBefore: false
  });
  const precheck = (value) => lineHasAnyInsensitive(value, ['@using']);
  try {
    for (const rawLine of lines) {
      if (scanBudget.exhausted || !scanBudget.consumeTime()) break;
      if (shouldScanLine(rawLine, precheck)) {
        if (!scanBudget.consumeMatch()) break;
        const line = stripComments(rawLine);
        if (line.trim()) {
          const token = parseRazorUsingTarget(line);
          if (token && scanBudget.consumeToken()) addCollectorImport(imports, token);
        }
      }
      if (!scanBudget.consumeLine()) break;
    }
    return Array.from(imports);
  } finally {
    budgetContext.finalize();
  }
};
