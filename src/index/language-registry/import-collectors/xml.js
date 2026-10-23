import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { parseXmlStructure } from '../../../shared/xml-structure.js';
import { sanitizeImportSpecifier } from '../../shared/import-specifier.js';

const XML_SCAN_BUDGET = Object.freeze({ maxChars: 786432, maxMatches: 4096, maxTokens: 2048, maxMs: 30 });

export const createXmlImportCollector = ({ parseStructure = parseXmlStructure } = {}) => (text, options = {}) => {
  const context = createCollectorBudgetContext({ text, options, collectorId: 'xml', defaults: XML_SCAN_BUDGET });
  const imports = new Set();
  const occurrences = [];
  let lineLimited = false;
  try {
    const structure = parseStructure(context.source, { remainingMs: () => context.budget.maxMs > 0
      ? Math.max(0, context.budget.maxMs - context.scanBudget.elapsedMs) : Infinity, abortSignal: options.abortSignal || options.signal });
    const reasons = new Set(structure.importCoverage?.reasons || []);
    if (structure.reason) reasons.add(structure.reason);
    if (context.sourceBudget.truncated) reasons.add('source_bytes');
    lineLimited = context.budget.maxLines > 0 && structure.sourceLines > context.budget.maxLines;
    if (lineLimited) reasons.add('scan_lines');
    for (const entry of structure.reason ? [] : structure.importEntries) {
      if (context.budget.maxLines > 0 && entry.endLine >= context.budget.maxLines) { reasons.add('scan_lines'); continue; }
      if (!sanitizeImportSpecifier(entry.value, { literal: true })) { reasons.add('literal-rejected'); continue; }
      if (context.scanBudget.exhausted || !context.scanBudget.consumeMatch()) { reasons.add('collector-budget'); break; }
      if (addBudgetedCollectorImport(imports, entry.value, context.scanBudget, { literal: true })) occurrences.push(entry);
      else reasons.add('literal-or-budget-rejected');
    }
    const coverage = Object.freeze({ state: reasons.has('cancelled') ? 'cancelled' : structure.reason ? 'unsupported'
      : reasons.size ? 'partial' : 'complete', reasons: Object.freeze([...reasons].sort()), source: 'xml-lexical-reference-subset' });
    if (coverage.state !== 'complete') {
      const diagnostic = { type: 'xml-reference-coverage', collectorId: 'xml', ...coverage };
      if (Array.isArray(options.collectorDiagnostics)) options.collectorDiagnostics.push(diagnostic);
      if (typeof options.onCollectorDiagnostic === 'function') { try { options.onCollectorDiagnostic(diagnostic); } catch {} }
    }
    return Object.defineProperties([...imports], { coverage: { value: coverage },
      occurrences: { value: Object.freeze(occurrences) }, observations: { value: structure.referenceObservations || Object.freeze([]) } });
  } finally {
    if (lineLimited) for (let line = 0; line < context.budget.maxLines; line += 1) {
      if (!context.scanBudget.consumeLine()) break;
    }
    context.finalize();
  }
};

export const collectXmlImports = createXmlImportCollector();
