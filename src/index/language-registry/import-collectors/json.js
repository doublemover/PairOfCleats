import { addBudgetedCollectorImport, createCollectorBudgetContext } from './utils.js';
import { isJsoncFile, parseJsoncStructure } from '../../../shared/jsonc-structure.js';
import { JSON_REFERENCE_POLICY_VERSION, JSON_REFERENCE_VALUE_DEPTH } from '../../../shared/json-reference-policy.js';
import { traverseJsonReferences, JSON_TRAVERSAL_LIMITS } from './json-traversal.js';
import { installedPackageVersion } from '../../../shared/installed-package-version.js';

const JSON_SCAN_BUDGET = Object.freeze({ maxChars: 262144, maxLines: 4000, maxMatches: 4096, maxTokens: 2048, maxMs: 30 });
const parseStrictJson = JSON.parse;
const strictParserIdentity = Object.freeze({ id: 'ecmascript-json-parse', version: `${process.version}:v8-${process.versions.v8}` });
const isCancelled = options => (options.abortSignal || options.signal)?.aborted === true;

export const createStrictJsonImportCollector = ({ parseValue = parseStrictJson, traversalLimits = JSON_TRAVERSAL_LIMITS,
  onWork = null } = {}) => {
  const limits = Object.fromEntries(Object.entries(JSON_TRAVERSAL_LIMITS).map(([key, maximum]) => {
    const requested = traversalLimits[key] ?? maximum;
    if (!Number.isSafeInteger(requested) || requested < 1) throw new TypeError(`Invalid JSON traversal ${key} limit.`);
    return [key, Math.min(maximum, requested)];
  }));
  return (text, options = {}) => {
    const context = createCollectorBudgetContext({ text, options, collectorId: 'imports:json', defaults: JSON_SCAN_BUDGET });
    const result = [], imports = new Set();
    let structure = { coverage: 'unavailable', reason: null }, stats = { visitedNodes: 0, peakFrames: 0 }, parserCalls = 0, parseElapsedMs = 0;
    const cancelled = () => isCancelled(options);
    try {
      if (cancelled()) { structure.reason = 'cancelled'; return result; }
      if (context.source.length !== String(text || '').length) { structure.reason = 'source-limit'; return result; }
      if (context.budget.maxLines > 0) {
        let lines = 1;
        for (let index = 0; index < context.source.length; index++) {
          if (context.source[index] === '\n' && ++lines > context.budget.maxLines) {
            for (let line = 0; line < context.budget.maxLines; line++) context.scanBudget.consumeLine();
            structure.reason = 'line-limit'; return result;
          }
          if ((index & 1023) === 0 && !context.scanBudget.consumeTime()) { structure.reason = 'time-limit'; return result; }
        }
      }
      if (!context.scanBudget.consumeTime()) { structure.reason = 'time-limit'; return result; }
      const started = context.scanBudget.elapsedMs;
      let parsed;
      try { parserCalls++; parsed = parseValue(context.source); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; structure.reason = 'parse-failed'; return result; }
      finally { parseElapsedMs = Math.max(0, context.scanBudget.elapsedMs - started); }
      if (!context.scanBudget.consumeTime()) { structure.reason = 'time-limit'; return result; }
      stats = traverseJsonReferences(parsed, imports, context.scanBudget, limits, cancelled);
      structure = { coverage: stats.complete && !stats.invalidReferences ? 'complete' : 'partial', reason: stats.reason,
        warningCodes: [...(stats.complete || stats.reason ? [] : ['collector-traversal-incomplete']),
          ...(stats.invalidReferences ? ['reference_value_invalid'] : [])] };
      result.push(...imports); return result;
    } finally {
      context.finalize({ entries: result, structure, parserIdentityKnown: parseValue === parseStrictJson,
        parserIdentity: parseValue === parseStrictJson ? strictParserIdentity : null,
        scope: `json-reference-policy-v${JSON_REFERENCE_POLICY_VERSION}:strict-json-preorder`,
        observedEntries: stats.observedReferences ?? null,
        parserLimits: { maxNodes: limits.nodes, maxFrames: limits.frames, referenceDepth: JSON_REFERENCE_VALUE_DEPTH } });
      onWork?.(Object.freeze({ ...stats, reason: structure.reason || stats.reason || null, parserCalls, parseElapsedMs, parseInterruptible: false }));
    }
  };
};

export const createJsoncImportCollector = ({ parseStructure = parseJsoncStructure } = {}) => (text, options = {}) => {
  const initialization = !isCancelled(options) ? parseStructure.initialize?.() || null : null;
  const context = createCollectorBudgetContext({ text, options, collectorId: 'imports:jsonc',
    defaults: JSON_SCAN_BUDGET });
  const imports = new Set(), result = [];
  let structure = null, compatibility = false, observedEntries = null;
  let lineLimited = false;
  try {
    if (isCancelled(options)) { structure = { coverage: 'unavailable', reason: 'cancelled' }; return result; }
    if (context.source.length !== String(text || '').length) { structure = { coverage: 'unavailable', reason: 'source-limit' }; return result; }
    structure = parseStructure(context.source, { remainingMs: () => context.budget.maxMs > 0
      ? Math.max(0, context.budget.maxMs - context.scanBudget.elapsedMs) : Infinity });
    lineLimited = context.budget.maxLines > 0 && structure.sourceLines > context.budget.maxLines;
    if (structure.reason === 'depth-limit' && !lineLimited) {
      // The pre-existing JSONC route accepted strict JSON through JSON.parse.
      // Preserve that deep-data case without entering the recursive AST parser.
      // No vendor ranges are produced by this compatibility path.
      if (!context.scanBudget.consumeTime()) return result;
      let parsed;
      try { parsed = parseStrictJson(context.source); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        // A valid deep JSONC document may not be strict JSON. Its original
        // depth omission is not evidence that JSONC syntax is malformed.
        structure = { ...structure, warningCodes: [...(structure.warningCodes || []), 'strict-depth-compat-unavailable'] };
        return result;
      }
      if (!context.scanBudget.consumeTime()) return result;
      const traversal = traverseJsonReferences(parsed, imports, context.scanBudget, JSON_TRAVERSAL_LIMITS, () => isCancelled(options));
      observedEntries = traversal.observedReferences;
      compatibility = true;
      structure = { coverage: traversal.complete && !traversal.invalidReferences ? 'complete' : 'partial', reason: traversal.reason,
        warningCodes: [...(traversal.complete || traversal.reason ? [] : ['collector-traversal-incomplete']),
          ...(traversal.invalidReferences ? ['reference_value_invalid'] : [])] };
      result.push(...imports); return result;
    }
    if (structure.reason) return result;
    let invalidReferences = false;
    for (const entry of structure.importEntries) {
      if (isCancelled(options)) break;
      if (context.budget.maxLines > 0 && entry.line >= context.budget.maxLines) continue;
      if (context.scanBudget.exhausted || !context.scanBudget.consumeMatch()) break;
      if (!addBudgetedCollectorImport(imports, entry.value, context.scanBudget, { literal: true }) && !context.scanBudget.exhausted) invalidReferences = true;
    }
    if (invalidReferences) structure = { ...structure, warningCodes: [...(structure.warningCodes || []), 'reference_value_invalid'] };
    result.push(...imports); return result;
  } finally {
    if (lineLimited) for (let line = 0; line < context.budget.maxLines; line += 1) {
      if (!context.scanBudget.consumeLine()) break;
    }
    context.finalize({ entries: result, structure, initialization, observedEntries,
      parserIdentityKnown: compatibility || parseStructure === parseJsoncStructure,
      parserIdentity: compatibility ? strictParserIdentity : parseStructure === parseJsoncStructure
        ? { id: 'jsonc-parser', version: installedPackageVersion('jsonc-parser') } : null,
      scope: `json-reference-policy-v${JSON_REFERENCE_POLICY_VERSION}:${compatibility ? 'strict-depth-compat' : 'jsonc'}`,
      parserLimits: compatibility ? { maxNodes: JSON_TRAVERSAL_LIMITS.nodes, maxFrames: JSON_TRAVERSAL_LIMITS.frames,
        referenceDepth: JSON_REFERENCE_VALUE_DEPTH } : parseStructure.limits || null });
  }
};

const collectJsoncImports = createJsoncImportCollector();
const collectStrictJsonImports = createStrictJsonImportCollector();

export const collectJsonImports = (text, options = {}) => {
  if (isJsoncFile(options || {})) return collectJsoncImports(text, options);
  return collectStrictJsonImports(text, options);
};
