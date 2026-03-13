import {
  createCollectorBudgetContext,
  lineHasAnyInsensitive,
  sanitizeCollectorImportToken,
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
    const addImport = (value) => {
      if (!scanBudget.consumeToken()) return;
      const token = sanitizeCollectorImportToken(value);
      if (!token) return;
      imports.add(token);
    };
    for (const line of lines) {
      if (scanBudget.exhausted || !scanBudget.consumeTime()) break;
      if (shouldScanLine(line, precheck)) {
        const importMatcher = /^\s*#\s*import\s+["']([^"']+)["']/gim;
        let match;
        while (!scanBudget.exhausted) {
          if (!scanBudget.consumeTime()) break;
          match = importMatcher.exec(line);
          if (match === null) break;
          if (!scanBudget.consumeMatch()) break;
          if (match?.[1]) addImport(match[1]);
          if (!match[0]) importMatcher.lastIndex += 1;
        }
      }
      if (!scanBudget.consumeLine()) break;
    }
    const linkMatcher = /@link\s*\([\s\S]*?\burl\s*:\s*["']([^"']+)["'][\s\S]*?\)/gi;
    let linkMatch;
    while (!scanBudget.exhausted) {
      if (!scanBudget.consumeTime()) break;
      linkMatch = linkMatcher.exec(source);
      if (linkMatch === null) break;
      if (!scanBudget.consumeMatch()) break;
      if (linkMatch?.[1]) addImport(linkMatch[1]);
      if (!linkMatch[0]) linkMatcher.lastIndex += 1;
    }
    return Array.from(imports);
  } finally {
    budgetContext.finalize();
  }
};
