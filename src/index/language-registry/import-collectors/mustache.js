import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { parseMustacheStructure } from '../../../shared/mustache-structure.js';

const MUSTACHE_SCAN_BUDGET = Object.freeze({ maxChars: 196608, maxLines: 3000,
  maxMatches: 4096, maxTokens: 2048, maxMs: 30 });

export const createMustacheImportCollector = ({ parseStructure = parseMustacheStructure } = {}) => (text, options = {}) => {
  parseStructure.initialize?.();
  const context = createCollectorBudgetContext({ text, options, collectorId: 'imports:mustache', defaults: MUSTACHE_SCAN_BUDGET });
  const imports = new Set();
  let lineLimited = false;
  try {
    const structure = parseStructure(context.source, { remainingMs: () => context.budget.maxMs > 0
      ? Math.max(0, context.budget.maxMs - context.scanBudget.elapsedMs) : Infinity });
    if (structure.reason) return [];
    lineLimited = context.budget.maxLines > 0 && structure.sourceLines > context.budget.maxLines;
    for (const entry of structure.partials) {
      if (context.budget.maxLines > 0 && entry.line >= context.budget.maxLines) continue;
      if (context.scanBudget.exhausted || !context.scanBudget.consumeMatch()) break;
      // Mustache partial names are literal lookup keys, unlike Handlebars strings.
      addBudgetedCollectorImport(imports, entry.name, context.scanBudget,
        { stripSurroundingQuotes: false, stripTrailingPunctuation: false });
    }
    return [...imports];
  } finally {
    if (lineLimited) for (let line = 0; line < context.budget.maxLines; line += 1) {
      if (!context.scanBudget.consumeLine()) break;
    }
    context.finalize();
  }
};

export const collectMustacheImports = createMustacheImportCollector();
