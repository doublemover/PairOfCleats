import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { parseProtoStructure } from '../../../shared/proto-structure.js';

const PROTO_SCAN_BUDGET = Object.freeze({ maxChars: 786432, maxLines: 5000,
  maxMatches: 4096, maxTokens: 2048, maxMs: 30 });

export const createProtoImportCollector = ({ parseStructure = parseProtoStructure } = {}) => (text, options = {}) => {
  parseStructure.initialize?.();
  const budgetContext = createCollectorBudgetContext({ text, options, collectorId: 'imports:proto', defaults: PROTO_SCAN_BUDGET });
  const imports = new Set();
  let lineLimited = false;
  try {
    const structure = parseStructure(budgetContext.source, { remainingMs: () => budgetContext.budget.maxMs > 0
      ? Math.max(0, budgetContext.budget.maxMs - budgetContext.scanBudget.elapsedMs) : Infinity });
    if (structure.reason) return [];
    lineLimited = budgetContext.budget.maxLines > 0 && structure.sourceLines > budgetContext.budget.maxLines;
    for (const entry of structure.importEntries) {
      if (budgetContext.budget.maxLines > 0 && entry.line >= budgetContext.budget.maxLines) continue;
      if (budgetContext.scanBudget.exhausted || !budgetContext.scanBudget.consumeMatch()) break;
      addBudgetedCollectorImport(imports, entry.value, budgetContext.scanBudget);
    }
    return [...imports];
  } finally {
    if (lineLimited) {
      for (let line = 0; line < budgetContext.budget.maxLines; line += 1) {
        if (!budgetContext.scanBudget.consumeLine()) break;
      }
    }
    budgetContext.finalize();
  }
};

export const collectProtoImports = createProtoImportCollector();
