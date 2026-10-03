import { addBudgetedCollectorImport, collectTemplatePartialImports, createCollectorBudgetContext } from './utils.js';
import { parseHandlebarsStructure } from '../../../shared/handlebars-ast.js';

const HANDLEBARS_SCAN_BUDGET = Object.freeze({ maxChars: 524288, maxLines: 3000,
  maxMatches: 768, maxTokens: 768, maxMs: 30 });

export const createHandlebarsImportCollector = ({ parseStructure = parseHandlebarsStructure } = {}) => (text, options = {}) => {
  parseStructure.initialize?.();
  const budgetContext = createCollectorBudgetContext({ text, options, collectorId: 'imports:handlebars',
    defaults: HANDLEBARS_SCAN_BUDGET });
  const imports = new Set();
  let lineLimited = false;
  try {
    const structure = parseStructure(budgetContext.source);
    if (structure.parser !== 'handlebars-parser') {
      const lines = budgetContext.source.split(/\r\n|\n|\r/u);
      lineLimited = budgetContext.budget.maxLines > 0 && lines.length > budgetContext.budget.maxLines;
      const boundedSource = lineLimited ? lines.slice(0, budgetContext.budget.maxLines).join('\n') : budgetContext.source;
      for (const value of collectTemplatePartialImports(boundedSource)) {
        if (budgetContext.scanBudget.exhausted || !budgetContext.scanBudget.consumeMatch()) break;
        addBudgetedCollectorImport(imports, value, budgetContext.scanBudget);
      }
      return [...imports];
    }
    lineLimited = budgetContext.budget.maxLines > 0 && structure.sourceLines > budgetContext.budget.maxLines;
    for (const partial of structure.partials) {
      if (partial.kind !== 'static') continue;
      if (budgetContext.budget.maxLines > 0 && partial.line >= budgetContext.budget.maxLines) continue;
      if (budgetContext.scanBudget.exhausted || !budgetContext.scanBudget.consumeMatch()) break;
      addBudgetedCollectorImport(imports, partial.name, budgetContext.scanBudget);
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

export const collectHandlebarsImports = createHandlebarsImportCollector();
