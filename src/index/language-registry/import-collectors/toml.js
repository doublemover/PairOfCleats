import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { parseTomlStructure } from '../../../shared/toml-structure.js';

const TOML_SCAN_BUDGET = Object.freeze({ maxChars: 786432, maxMatches: 4096, maxTokens: 2048, maxMs: 30 });

export const createTomlImportCollector = ({ parseStructure = parseTomlStructure } = {}) => (text, options = {}) => {
  parseStructure.initialize?.();
  const context = createCollectorBudgetContext({ text, options, collectorId: 'toml', defaults: TOML_SCAN_BUDGET });
  const imports = new Set();
  let lineLimited = false;
  try {
    const structure = parseStructure(context.source, { remainingMs: () => context.budget.maxMs > 0
      ? Math.max(0, context.budget.maxMs - context.scanBudget.elapsedMs) : Infinity });
    lineLimited = context.budget.maxLines > 0 && structure.sourceLines > context.budget.maxLines;
    if (structure.reason) return [];
    for (const entry of structure.importEntries) {
      // The range belongs to the whole application-lexed assignment, never to
      // an invented vendor string node. Do not admit half a multiline value.
      if (context.budget.maxLines > 0 && entry.endLine >= context.budget.maxLines) continue;
      if (context.scanBudget.exhausted || !context.scanBudget.consumeMatch()) break;
      addBudgetedCollectorImport(imports, entry.value, context.scanBudget);
    }
    return [...imports];
  } finally {
    if (lineLimited) for (let line = 0; line < context.budget.maxLines; line += 1) {
      if (!context.scanBudget.consumeLine()) break;
    }
    context.finalize();
  }
};

export const collectTomlImports = createTomlImportCollector();
