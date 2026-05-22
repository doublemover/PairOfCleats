import {
  addBudgetedCollectorImport,
  createCollectorBudgetContext,
  forEachBudgetedRegexMatch,
  lineHasAnyInsensitive,
  shouldScanLine
} from './utils.js';

const GRAPHQL_SCAN_BUDGET = Object.freeze({
  maxChars: 786432,
  maxLines: 4096,
  maxMatches: 4096,
  maxTokens: 2048,
  maxMs: 30
});

export const collectGraphqlImports = (text, options = {}) => {
  const imports = new Set();
  const budgetContext = createCollectorBudgetContext({
    text,
    options,
    collectorId: 'graphql',
    defaults: GRAPHQL_SCAN_BUDGET
  });
  const { scanBudget } = budgetContext;
  const source = budgetContext.source;
  try {
    const lines = source.split('\n');
    const precheck = (value) => lineHasAnyInsensitive(value, ['#import', '@link', 'import']);
    const addImport = (value) => addBudgetedCollectorImport(imports, value, scanBudget);
    for (const line of lines) {
      if (scanBudget.exhausted || !scanBudget.consumeTime()) break;
      if (shouldScanLine(line, precheck)) {
        const importMatcher = /^\s*#\s*import\s+["']([^"']+)["']/gim;
        forEachBudgetedRegexMatch({
          text: line,
          matcher: importMatcher,
          scanBudget,
          onMatch: (match) => {
            if (match?.[1]) addImport(match[1]);
          }
        });
      }
      if (!scanBudget.consumeLine()) break;
    }
    const linkMatcher = /@link\s*\([\s\S]*?\burl\s*:\s*["']([^"']+)["'][\s\S]*?\)/gi;
    forEachBudgetedRegexMatch({
      text: source,
      matcher: linkMatcher,
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
