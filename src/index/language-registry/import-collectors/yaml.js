import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { parseYamlStructure } from '../../../shared/yaml-structure.js';

const YAML_SCAN_BUDGET = Object.freeze({ maxChars: 786432, maxLines: 20000, maxMatches: 8192, maxTokens: 4096, maxMs: 30 });

export const createYamlImportCollector = ({ parseStructure = parseYamlStructure, parserIdentity = null } = {}) => (text, options = {}) => {
  const initialization = parseStructure.initialize?.() || null;
  const context = createCollectorBudgetContext({ text, options, collectorId: 'yaml', defaults: YAML_SCAN_BUDGET });
  const imports = new Set(), result = [];
  let structure = null;
  let lineLimited = false;
  try {
    structure = parseStructure(context.source, { remainingMs: () => context.budget.maxMs > 0
      ? Math.max(0, context.budget.maxMs - context.scanBudget.elapsedMs) : Infinity });
    lineLimited = context.budget.maxLines > 0 && structure.sourceLines > context.budget.maxLines;
    if (structure.reason) return result;
    for (const entry of structure.importEntries) {
      if (context.budget.maxLines > 0 && entry.endLine >= context.budget.maxLines) continue;
      if (context.scanBudget.exhausted || !context.scanBudget.consumeMatch()) break;
      addBudgetedCollectorImport(imports, entry.value, context.scanBudget, { literal: true });
    }
    result.push(...imports);
    return result;
  } finally {
    if (lineLimited) for (let line = 0; line < context.budget.maxLines; line += 1) {
      if (!context.scanBudget.consumeLine()) break;
    }
    context.finalize({ entries: result, structure, parserLimits: parseStructure.limits || null, initialization, parserIdentityKnown: parseStructure === parseYamlStructure, parserIdentity });
  }
};

export const collectYamlImports = createYamlImportCollector();
