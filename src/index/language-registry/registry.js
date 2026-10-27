import { createLanguageRouteResolver } from './routing.js';
import { throwIfAborted } from '../../shared/abort.js';
import { isManagedReferenceLanguage, projectManagedReferences } from '../../contracts/managed-reference-identities.js';
import { resolveJavaScriptDeclarationReference } from '../../lang/javascript/callable-occurrences.js';
import { admitImportExtraction, attachImportExtraction, createImportExtraction, getImportExtraction, projectImportExtraction } from '../../shared/import-extraction.js';
import { normalizeImportSpecifiers, sanitizeImportSpecifier } from '../shared/import-specifier.js';
import { LANGUAGE_REGISTRY } from './registry-data.js';
import { normalizeCollectorHint } from './import-collectors/utils.js';
const LANGUAGE_BY_ID = new Map(LANGUAGE_REGISTRY.map((lang) => [lang.id, lang]));
const resolveRouteId = createLanguageRouteResolver(LANGUAGE_BY_ID);

const coerceImportEntry = (value) => {
  if (typeof value === 'string') return { specifier: value.trim(), collectorHint: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const specifier = typeof value.specifier === 'string'
    ? value.provenance === 'parsed-literal' ? value.specifier : value.specifier.trim()
    : (
      typeof value.import === 'string'
        ? value.import.trim()
        : ''
    );
  if (!specifier) return null;
  return {
    specifier,
    provenance:value.provenance === 'parsed-literal' ? 'parsed-literal' : null,
    collectorHint: normalizeCollectorHint(value.collectorHint)
  };
};

const normalizeImportEntries = (entries) => {
  const extraction = getImportExtraction(entries);
  let admitted = 0;
  const deduped = new Map();
  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    const normalized = coerceImportEntry(rawEntry);
    if (!normalized) continue;
    const normalizedSpecifierList = normalized.provenance === 'parsed-literal'
      ? [sanitizeImportSpecifier(normalized.specifier,{literal:true})] : normalizeImportSpecifiers([normalized.specifier]);
    const specifier = normalizedSpecifierList[0];
    if (!specifier) continue;
    admitted += 1;
    const existing = deduped.get(specifier);
    if (!existing) {
      deduped.set(specifier, {
        specifier,
        collectorHint: normalized.collectorHint
        , ...(normalized.provenance ? {provenance:normalized.provenance} : {})
      });
      continue;
    }
    const existingConfidence = Number(existing?.collectorHint?.confidence);
    const nextConfidence = Number(normalized?.collectorHint?.confidence);
    const shouldReplaceHint = (
      normalized.collectorHint
      && (
        !existing?.collectorHint
        || (
          Number.isFinite(nextConfidence)
          && (!Number.isFinite(existingConfidence) || nextConfidence > existingConfidence)
        )
      )
    );
    if (shouldReplaceHint) existing.collectorHint = normalized.collectorHint;
  }
  const result = Array.from(deduped.values())
    .sort((a, b) => (a.specifier < b.specifier ? -1 : (a.specifier > b.specifier ? 1 : 0)));
  if (extraction) attachImportExtraction(result, projectImportExtraction(extraction, entries, result, { owner: 'registry',
    duplicates: admitted - result.length, invalid: entries.length - admitted }));
  if (entries?.coverage) Object.defineProperty(result, 'coverage', { value: entries.coverage });
  if (entries?.occurrences) Object.defineProperty(result, 'occurrences', { value: entries.occurrences });
  return result;
};

export function getLanguageForFile(ext, relPath) {
  return LANGUAGE_BY_ID.get(resolveRouteId(ext, relPath)) || null;
}

export function collectLanguageImports(input = {}) {
  const entries = collectLanguageImportEntries(input);
  const values = entries.map((entry) => entry.specifier);
  attachImportExtraction(values, projectImportExtraction(getImportExtraction(entries), entries, values, { owner: 'string-array' }));
  return values;
}

export function collectLanguageImportEntries(input = {}) {
  const {
    ext,
    relPath,
    text,
    mode,
    options,
    root,
    filePath,
    ...rest
  } = input;
  const lang = getLanguageForFile(ext, relPath);
  if (!lang || (typeof lang.collectImports !== 'function' && typeof lang.collectImportEntries !== 'function')) {
    const entries = [];
    return attachImportExtraction(entries, createImportExtraction({ entries, text: typeof text === 'string' ? text : null,
      producerId: lang?.id || 'unsupported-language', scope: 'unsupported-import-capability', state: 'unsupported',
      reasons: ['import_capability_unsupported'] }));
  }
  const forwarded = {
    ...(options && typeof options === 'object' ? options : {}),
    ...rest
  };
  const merged = {
    ...forwarded,
    ext,
    relPath,
    mode
  };
  if (root) merged.root = root;
  if (filePath) merged.filePath = filePath;
  throwIfAborted(merged.abortSignal || merged.signal);
  const collected = typeof lang.collectImportEntries === 'function'
    ? lang.collectImportEntries(text, merged)
    : lang.collectImports(text, merged);
  throwIfAborted(merged.abortSignal || merged.signal);
  const imports = Array.isArray(collected) ? collected : Array.isArray(collected?.entries)
    ? attachImportExtraction(collected.entries, collected.receipt) : null;
  if (!imports) throw Object.assign(new Error('Import collector returned neither entries nor a typed result.'), { code: 'ERR_IMPORT_EXTRACTION_CONTRACT' });
  const receipt = getImportExtraction(imports) || createImportExtraction({ entries: imports,
    text: typeof text === 'string' ? text : null, producerId: lang.id, scope: 'legacy-import-array:' + lang.id,
    reasons: ['legacy_array_producer'] });
  admitImportExtraction(receipt, imports, { text: typeof text === 'string' ? text : null });
  attachImportExtraction(imports, receipt);
  return normalizeImportEntries(imports);
}

/** Canonical typed handoff. Legacy array APIs retain this same receipt privately
 * without parsing again or retaining source text alongside long-lived arrays. */
export function collectLanguageImportResult(input = {}) {
  const entries = collectLanguageImportEntries(input);
  return Object.freeze({ entries, receipt: getImportExtraction(entries) });
}

export async function buildLanguageContext({ ext, relPath, mode, text, options }) {
  const lang = getLanguageForFile(ext, relPath);
  const preparedOptions = options && typeof options === 'object'
    ? { ...options, relPath }
    : { relPath };
  // Prose/extracted-prose paths do not require language prepare passes and can
  // hit expensive parser work (for example large HTML docs) with no downstream use.
  const shouldPrepare = (mode === 'code' || preparedOptions?.forcePrepare === true)
    && preparedOptions?.skipPrepare !== true;
  const context = shouldPrepare && lang && typeof lang.prepare === 'function'
    ? await lang.prepare({ ext, relPath, mode, text, options: preparedOptions })
    : {};
  return { lang, context };
}

const syntaxOccurrenceKey = detail => {
  if (detail?.source !== 'tree-sitter' || detail.coordinateSystem !== 'utf16'
    || !Number.isSafeInteger(detail.start) || !Number.isSafeInteger(detail.end)
    || !Number.isSafeInteger(detail.callerStart) || !Number.isSafeInteger(detail.callerEnd)
    || detail.end <= detail.start || detail.callerEnd <= detail.callerStart) return null;
  return JSON.stringify([detail.start, detail.end, detail.callerStart, detail.callerEnd, detail.calleeRaw]);
};

export function buildChunkRelations({ lang, chunk, fileRelations, callIndex = null, chunkIndex = null }) {
  if (!fileRelations) return {};
  const output = {};
  if (isManagedReferenceLanguage(lang?.id)) {
    const references = projectManagedReferences(fileRelations.managedReferenceFacts, lang.id, chunk);
    output.calls = [];
    output.callCoverage = 'partial-reference-language-no-invocation-owner';
    output.referenceDetails = references.details;
    output.referenceCoverage = { state: references.state, scope: 'static-reference-occurrences-not-call-edges',
      ...(references.coverage ? { producer: references.coverage } : { reason: 'source-reference-owner-unavailable' }) };
    if (lang.attachName && chunk?.name) output.name = chunk.name;
    return output;
  }
  const coverage = chunk?.meta?.syntaxCallCoverage || fileRelations.callCoverage;
  if (coverage) output.callCoverage = coverage;
  if (chunk?.meta?.syntaxCallOmissions) output.callOmissions = { ...chunk.meta.syntaxCallOmissions };
  else if (Array.isArray(fileRelations.callCoverageReasons)) output.callCoverageReasons = [...fileRelations.callCoverageReasons];
  if (chunk?.name) {
    const pythonScopedCalls = lang?.id === 'python' && typeof chunk.meta?.pythonScopeId === 'string'
      && fileRelations.callOwnership === 'python-lexical-scope-v1';
    const nativeScopedCalls = Array.isArray(chunk.meta?.syntaxCalls)
      && fileRelations.callOwnership === 'native-syntax-occurrences-v1';
    if (fileRelations.callOwnership === 'javascript-declaration-occurrences-v1') {
      const join = resolveJavaScriptDeclarationReference(chunk, fileRelations.jsDeclarations);
      if (!join.record) {
        output.callCoverage = 'partial-javascript-declaration-association-unavailable';
        return output;
      }
      const indexMatchesDetails = callIndex?.callDetailsSource === fileRelations.callDetails && callIndex?.callDetailsLength === fileRelations.callDetails?.length;
      const indexMatchesCalls = callIndex?.callsSource === fileRelations.calls && callIndex?.callsLength === fileRelations.calls?.length;
      const record = join.record, owned = indexMatchesDetails && callIndex?.callDetailsByOccurrenceId
        ? callIndex.callDetailsByOccurrenceId.get(record.id) || []
        : (fileRelations.callDetails || []).filter(detail => detail.callerOccurrenceId === record.id);
      const retained = owned.filter(detail => detail.callerOccurrenceId === record.id && detail.start >= chunk.start && detail.end <= chunk.end);
      const callees = new Set(retained.filter(detail => detail.role !== 'constructor').map(detail => detail.callee).filter(Boolean));
      const pairs = indexMatchesCalls && callIndex?.callsByCaller
        ? callIndex.callsByCaller.get(record.id) || [] : (fileRelations.calls || []).filter(([owner]) => owner === record.id);
      const seen = new Set();
      output.calls = pairs.filter(([, callee]) => callees.has(callee) && !seen.has(callee) && seen.add(callee)).map(([, callee]) => [chunk.name, callee]);
      if (retained.length) output.callDetails = retained;
      output.callCoverage = 'partial-javascript-owned-syntax-phases';
      output.callCoverageReasons = [
        ...(!join.exact ? ['source-fragment-projection'] : []),
        ...(owned.some(detail => detail.start < chunk.end && detail.end > chunk.start
          && !(detail.start >= chunk.start && detail.end <= chunk.end)) ? ['split-call-occurrence'] : []),
        ...(fileRelations.jsDeclarations.coverage.state !== 'complete' ? fileRelations.jsDeclarations.coverage.reasons : [])
      ].slice(0, 16);
      output.callOwnership = 'javascript-projected-declaration-syntax-v1';
      output.callOwnerOccurrenceId = record.id;
      return output;
    }
    const callsForChunk = callIndex?.callsByCaller
      ? (callIndex.callsByCaller.get(chunk.name) || [])
      : (Array.isArray(fileRelations.calls)
        ? fileRelations.calls.filter(([caller]) => caller && caller === chunk.name)
        : []);
    let detailsForChunk = [];
    if (pythonScopedCalls || nativeScopedCalls) {
      // Header calls can lie in a nested declaration's source range while
      // belonging to its enclosing scope. A geometric index cannot override it.
      detailsForChunk = callIndex?.callDetailsByCaller
        ? callIndex.callDetailsByCaller.get(chunk.name) || []
        : (fileRelations.callDetails || []).filter(detail => detail?.caller === chunk.name);
    } else if (callIndex?.callDetailsByChunkIndex && Number.isFinite(chunkIndex)) {
      detailsForChunk = callIndex.callDetailsByChunkIndex.get(chunkIndex) || [];
    } else if (callIndex?.callDetailsByCaller) {
      detailsForChunk = callIndex.callDetailsByCaller.get(chunk.name) || [];
    } else if (Array.isArray(fileRelations.callDetails)) {
      detailsForChunk = fileRelations.callDetails.filter((detail) => detail?.caller === chunk.name);
    }
    if (nativeScopedCalls) {
      // Equal display names can denote separate overloads, prototypes or
      // redefinitions. Join only the native owner's original occurrences;
      // inference annotations belong to the already-budgeted mutable view.
      const expected = new Set();
      let crossing = false;
      for (const fact of chunk.meta.syntaxCalls) {
        const key = syntaxOccurrenceKey(fact);
        if (!key) continue;
        if (fact.start >= chunk.start && fact.end <= chunk.end) expected.add(key);
        else if (fact.start < chunk.end && fact.end > chunk.start) crossing = true;
      }
      detailsForChunk = detailsForChunk.filter(detail => expected.has(syntaxOccurrenceKey(detail)));
      const retained = new Set(detailsForChunk.map(syntaxOccurrenceKey));
      const callees = new Set(detailsForChunk.map(detail => detail.callee).filter(Boolean));
      const seen = new Set();
      output.calls = callsForChunk.filter(([, callee]) => {
        if (!callees.has(callee) || seen.has(callee)) return false;
        seen.add(callee); return true;
      });
      const reasons = [
        ...(crossing ? ['split-call-occurrence'] : []),
        ...(retained.size < expected.size ? ['unavailable-call-occurrence-details'] : [])
      ];
      if (reasons.length) output.callCoverage = `partial-native-call-occurrences;${coverage || 'unspecified'};${reasons.join(';')}`;
    } else if (pythonScopedCalls) {
      // A display name can recur in separate lexical declarations. Preserve
      // the collector's source-qualified owner through the public projection.
      // Intersect both already-budgeted channels; never reconstruct discarded
      // calls from an unbudgeted chunk metadata copy.
      detailsForChunk = detailsForChunk.filter(detail => detail.callerScopeId === chunk.meta.pythonScopeId);
      const callees = new Set(detailsForChunk.map(detail => detail.callee).filter(Boolean));
      const seen = new Set();
      output.calls = callsForChunk.filter(([, callee]) => {
        if (!callees.has(callee) || seen.has(callee)) return false;
        seen.add(callee); return true;
      });
      output.callCoverage = 'partial-python-syntax-lexical-ownership';
    } else if (callsForChunk.length) output.calls = callsForChunk;
    if (detailsForChunk.length) output.callDetails = detailsForChunk;
  }
  if (lang?.attachName && chunk?.name) output.name = chunk.name;
  return output;
}
