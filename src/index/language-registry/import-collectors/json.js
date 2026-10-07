import { addBudgetedCollectorImport, createCollectorBudgetContext, sanitizeCollectorImportToken } from './utils.js';
import { isJsoncFile, parseJsoncStructure } from '../../../shared/jsonc-structure.js';
import { JSON_REFERENCE_KEYS, JSON_REFERENCE_NODE_LIMIT, JSON_REFERENCE_VALUE_DEPTH } from '../../../shared/json-reference-policy.js';

const REFERENCE_KEY_TOKENS = new Set(JSON_REFERENCE_KEYS);
const MAX_TRAVERSE_NODES = JSON_REFERENCE_NODE_LIMIT;
const MAX_REFERENCE_VALUE_DEPTH = JSON_REFERENCE_VALUE_DEPTH;

const addImport = (imports, value, scanBudget = null) => {
  if (scanBudget) return addBudgetedCollectorImport(imports, value, scanBudget);
  const token = sanitizeCollectorImportToken(value);
  if (!token) return;
  imports.add(token);
};

const collectStringValues = (value, out, maxDepth = MAX_REFERENCE_VALUE_DEPTH, scanBudget = null) => {
  const queue = [{ value, depth: maxDepth }];
  let cursor = 0;
  let visited = 0;
  while (cursor < queue.length && visited < MAX_TRAVERSE_NODES) {
    if (scanBudget?.exhausted || (scanBudget && !scanBudget.consumeTime())) break;
    const current = queue[cursor];
    cursor += 1;
    visited += 1;
    if (!current || current.depth < 0) continue;
    if (typeof current.value === 'string') {
      if (scanBudget && !scanBudget.consumeMatch()) break;
      addImport(out, current.value, scanBudget);
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        queue.push({ value: item, depth: current.depth - 1 });
      }
      continue;
    }
    if (current.value && typeof current.value === 'object') {
      for (const nested of Object.values(current.value)) {
        queue.push({ value: nested, depth: current.depth - 1 });
      }
    }
  }
};

const traverseJson = (value, imports, scanBudget = null) => {
  const queue = [value];
  let cursor = 0;
  let visited = 0;
  while (cursor < queue.length && visited < MAX_TRAVERSE_NODES) {
    if (scanBudget?.exhausted || (scanBudget && !scanBudget.consumeTime())) break;
    const current = queue[cursor];
    cursor += 1;
    visited += 1;
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    if (!current || typeof current !== 'object') continue;
    for (const [key, nested] of Object.entries(current)) {
      const keyLower = key.toLowerCase();
      if (REFERENCE_KEY_TOKENS.has(keyLower)) {
        collectStringValues(nested, imports, MAX_REFERENCE_VALUE_DEPTH, scanBudget);
      }
      queue.push(nested);
    }
  }
};

export const createJsoncImportCollector = ({ parseStructure = parseJsoncStructure } = {}) => (text, options = {}) => {
  parseStructure.initialize?.();
  const context = createCollectorBudgetContext({ text, options, collectorId: 'imports:jsonc',
    defaults: { maxChars: 262144, maxLines: 4000, maxMatches: 4096, maxTokens: 2048, maxMs: 30 } });
  const imports = new Set();
  let lineLimited = false;
  try {
    const structure = parseStructure(context.source, { remainingMs: () => context.budget.maxMs > 0
      ? Math.max(0, context.budget.maxMs - context.scanBudget.elapsedMs) : Infinity });
    lineLimited = context.budget.maxLines > 0 && structure.sourceLines > context.budget.maxLines;
    if (structure.reason === 'depth-limit' && !lineLimited) {
      // The pre-existing JSONC route accepted strict JSON through JSON.parse.
      // Preserve that deep-data case without entering the recursive AST parser.
      // No vendor ranges are produced by this compatibility path.
      if (!context.scanBudget.consumeTime()) return [];
      let parsed;
      try { parsed = JSON.parse(context.source); } catch { return []; }
      if (!context.scanBudget.consumeTime()) return [];
      traverseJson(parsed, imports, context.scanBudget);
      return [...imports];
    }
    if (structure.reason) return [];
    for (const entry of structure.importEntries) {
      if (context.budget.maxLines > 0 && entry.line >= context.budget.maxLines) continue;
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

const collectJsoncImports = createJsoncImportCollector();

export const collectJsonImports = (text, options = {}) => {
  if (isJsoncFile(options || {})) return collectJsoncImports(text, options);
  if (!String(text || '').includes('"')) return [];
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch {
    return [];
  }
  const imports = new Set();
  traverseJson(parsed, imports);
  return Array.from(imports);
};
