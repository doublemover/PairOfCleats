import {
  addBudgetedCollectorImport,
  createCollectorBudgetContext,
  forEachBudgetedRegexMatch,
  lineHasAny,
  shouldScanLine,
  stripTemplateCommentBlocks
} from './utils.js';

const JINJA_SCAN_BUDGET = Object.freeze({
  maxChars: 786432,
  maxLines: 4096,
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
    const addImport = (value) => addBudgetedCollectorImport(imports, value, scanBudget);
    for (const line of lines) {
      if (scanBudget.exhausted || !scanBudget.consumeTime()) break;
      if (shouldScanLine(line, precheck)) {
        const lineMatcher = /{%\s*(?:extends|include|import)\s+['"]([^'"]+)['"]/g;
        forEachBudgetedRegexMatch({
          text: line,
          matcher: lineMatcher,
          scanBudget,
          onMatch: (match) => {
            if (match?.[1]) addImport(match[1]);
          }
        });
      }
      if (!scanBudget.consumeLine()) break;
    }
    const multilineMatcher = /{%\s*(?:extends|include|import)\s+["']([^"']+)["'][\s\S]*?%}/g;
    forEachBudgetedRegexMatch({
      text: source,
      matcher: multilineMatcher,
      scanBudget,
      onMatch: (match) => {
        if (match?.[1]) addImport(match[1]);
      }
    });
    return Array.from(imports);
  } finally {
    budgetContext.finalize();
  }
};
