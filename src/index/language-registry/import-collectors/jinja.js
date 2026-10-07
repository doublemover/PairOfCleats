import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { parseJinjaTemplateStructure } from '../../../shared/jinja-template-structure.js';

const JINJA_SCAN_BUDGET = Object.freeze({
  maxChars: 786432,
  maxLines: 4096,
  maxMatches: 4096,
  maxTokens: 2048,
  maxMs: 30
});

export const createJinjaImportCollector = ({ parseStructure = parseJinjaTemplateStructure } = {}) => (text, options = {}) => {
  const imports = new Set();
  const budgetContext = createCollectorBudgetContext({
    text,
    options,
    collectorId: 'jinja',
    defaults: JINJA_SCAN_BUDGET
  });
  const { scanBudget } = budgetContext;
  let lineLimited = false;
  try {
    const structure = parseStructure(budgetContext.source, { ext: options.ext, relPath: options.relPath,
      remainingMs: () => budgetContext.budget.maxMs > 0
        ? Math.max(0, budgetContext.budget.maxMs - scanBudget.elapsedMs) : Infinity });
    if (structure.reason) return [];
    lineLimited = budgetContext.budget.maxLines > 0 && structure.sourceLines > budgetContext.budget.maxLines;
    for (const entry of structure.importEntries) {
      if (budgetContext.budget.maxLines > 0 && entry.line >= budgetContext.budget.maxLines) continue;
      if (scanBudget.exhausted || !scanBudget.consumeMatch()) break;
      addBudgetedCollectorImport(imports, entry.value, scanBudget,
        { stripSurroundingQuotes: false, stripTrailingPunctuation: false });
    }
    return Array.from(imports);
  } finally {
    if (lineLimited) for (let line = 0; line < budgetContext.budget.maxLines; line += 1) {
      if (!scanBudget.consumeLine()) break;
    }
    budgetContext.finalize();
  }
};

export const collectJinjaImports = createJinjaImportCollector();
