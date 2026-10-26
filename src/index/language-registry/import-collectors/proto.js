import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { parseProtoStructure } from '../../../shared/proto-structure.js';

const PROTO_SCAN_BUDGET = Object.freeze({ maxChars: 786432, maxLines: 5000,
  maxMatches: 4096, maxTokens: 2048, maxMs: 30 });

export const createProtoImportCollector = ({ parseStructure = parseProtoStructure, parserIdentity = null } = {}) => (text, options = {}) => {
  const initialization = parseStructure.initialize?.() || null;
  const budgetContext = createCollectorBudgetContext({ text, options, collectorId: 'imports:proto', defaults: PROTO_SCAN_BUDGET });
  const imports = new Set(), result = [];
  let structure = null;
  let lineLimited = false;
  try {
    structure = parseStructure(budgetContext.source, { remainingMs: () => budgetContext.budget.maxMs > 0
      ? Math.max(0, budgetContext.budget.maxMs - budgetContext.scanBudget.elapsedMs) : Infinity });
    if (structure.reason) return result;
    lineLimited = budgetContext.budget.maxLines > 0 && structure.sourceLines > budgetContext.budget.maxLines;
    for (const entry of structure.importEntries) {
      if (budgetContext.budget.maxLines > 0 && entry.line >= budgetContext.budget.maxLines) continue;
      if (budgetContext.scanBudget.exhausted || !budgetContext.scanBudget.consumeMatch()) break;
      addBudgetedCollectorImport(imports, entry.value, budgetContext.scanBudget);
    }
    result.push(...imports);
    return result;
  } finally {
    if (lineLimited) {
      for (let line = 0; line < budgetContext.budget.maxLines; line += 1) {
        if (!budgetContext.scanBudget.consumeLine()) break;
      }
    }
    budgetContext.finalize({ entries: result, structure, parserLimits: parseStructure.limits || null, initialization, parserIdentityKnown: parseStructure === parseProtoStructure, parserIdentity });
  }
};

export const collectProtoImports = createProtoImportCollector();
