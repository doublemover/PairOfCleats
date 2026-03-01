import {
  createCollectorBudgetContext,
  lineHasAny,
  sanitizeCollectorImportToken,
  shouldScanLine,
  stripTemplateCommentBlocks
} from './utils.js';

const JINJA_SCAN_BUDGET = Object.freeze({
  maxChars: 786432,
  maxMatches: 4096,
  maxTokens: 2048,
  maxMs: 30
});

export const collectJinjaImports = (text, options = {}) => {
  const imports = new Set();
  const budgetContext = createCollectorBudgetContext({
    text,
    options,
    collectorId: 'jinja',
    defaults: JINJA_SCAN_BUDGET
  });
  const { scanBudget } = budgetContext;
  const source = stripTemplateCommentBlocks(budgetContext.source);
  try {
    const lines = source.split('\n');
    const precheck = (value) =>
      value.includes('{%') && lineHasAny(value, ['extends', 'include', 'import']);
    const addImport = (value) => {
      if (!scanBudget.consumeToken()) return;
      const token = sanitizeCollectorImportToken(value);
      if (!token) return;
      imports.add(token);
    };
    for (const line of lines) {
      if (scanBudget.exhausted || !scanBudget.consumeTime()) break;
      if (!shouldScanLine(line, precheck)) continue;
      const lineMatcher = /{%\s*(?:extends|include|import)\s+['"]([^'"]+)['"]/g;
      let match;
      while (!scanBudget.exhausted && (match = lineMatcher.exec(line)) !== null) {
        if (!scanBudget.consumeMatch()) break;
        if (match?.[1]) addImport(match[1]);
        if (!match[0]) lineMatcher.lastIndex += 1;
      }
    }
    const multilineMatcher = /{%\s*(?:extends|include|import)\s+["']([^"']+)["'][\s\S]*?%}/g;
    let multilineMatch;
    while (!scanBudget.exhausted && (multilineMatch = multilineMatcher.exec(source)) !== null) {
      if (!scanBudget.consumeMatch()) break;
      if (multilineMatch?.[1]) addImport(multilineMatch[1]);
      if (!multilineMatch[0]) multilineMatcher.lastIndex += 1;
    }
    return Array.from(imports);
  } finally {
    budgetContext.finalize();
  }
};
