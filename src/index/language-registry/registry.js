import path from 'node:path';
import { LINGUIST_LANGUAGES } from './linguist-data.js';
import { buildLinguistRoutingMaps, normalizeLinguistName } from './linguist-routing.js';
import { toArray } from '../../shared/iterables.js';
import { normalizeImportSpecifiers, sanitizeImportSpecifier } from '../shared/import-specifier.js';
import { LANGUAGE_REGISTRY } from './registry-data.js';
import { LANGUAGE_ROUTE_DESCRIPTORS } from './descriptors.js';
import { normalizeCollectorHint } from './import-collectors/utils.js';
const LANGUAGE_BY_ID = new Map(LANGUAGE_REGISTRY.map((lang) => [lang.id, lang]));
const { extensions: LINGUIST_EXTENSION_MAP, filenames: LINGUIST_FILENAME_MAP }
  = buildLinguistRoutingMaps(LINGUIST_LANGUAGES, LANGUAGE_BY_ID);
const DESCRIPTOR_EXTENSION_MAP = new Map();
const DESCRIPTOR_FILENAME_MAP = new Map();
const DESCRIPTOR_PREFIX_MAP = [];

for (const descriptor of LANGUAGE_ROUTE_DESCRIPTORS) {
  const languageId = descriptor?.id;
  if (!languageId || !LANGUAGE_BY_ID.has(languageId)) continue;
  for (const ext of toArray(descriptor?.extensions)) {
    const key = String(ext || '').toLowerCase();
    if (key && !DESCRIPTOR_EXTENSION_MAP.has(key)) {
      DESCRIPTOR_EXTENSION_MAP.set(key, languageId);
    }
  }
  for (const filename of toArray(descriptor?.specialFilenames)) {
    const key = String(filename || '').toLowerCase();
    if (key && !DESCRIPTOR_FILENAME_MAP.has(key)) {
      DESCRIPTOR_FILENAME_MAP.set(key, languageId);
    }
  }
  for (const prefix of toArray(descriptor?.specialPrefixes)) {
    const key = String(prefix || '').toLowerCase();
    if (key) {
      DESCRIPTOR_PREFIX_MAP.push({ prefix: key, languageId });
    }
  }
}

const resolveLinguistLanguage = (ext, relPath) => {
  const baseName = normalizeLinguistName(path.basename(relPath || ''));
  if (baseName && LINGUIST_FILENAME_MAP.has(baseName)) {
    return LANGUAGE_BY_ID.get(LINGUIST_FILENAME_MAP.get(baseName)) || null;
  }
  const extKey = normalizeLinguistName(ext);
  if (extKey && LINGUIST_EXTENSION_MAP.has(extKey)) {
    return LANGUAGE_BY_ID.get(LINGUIST_EXTENSION_MAP.get(extKey)) || null;
  }
  return null;
};

const resolveDescriptorLanguage = (ext, relPath) => {
  const baseName = normalizeLinguistName(path.basename(relPath || ''));
  if (baseName && DESCRIPTOR_FILENAME_MAP.has(baseName)) {
    return LANGUAGE_BY_ID.get(DESCRIPTOR_FILENAME_MAP.get(baseName)) || null;
  }
  const extKey = normalizeLinguistName(ext);
  if (extKey && DESCRIPTOR_EXTENSION_MAP.has(extKey)) {
    return LANGUAGE_BY_ID.get(DESCRIPTOR_EXTENSION_MAP.get(extKey)) || null;
  }
  if (baseName) {
    for (const entry of DESCRIPTOR_PREFIX_MAP) {
      if (!(baseName === entry.prefix || baseName.startsWith(`${entry.prefix}.`))) continue;
      return LANGUAGE_BY_ID.get(entry.languageId) || null;
    }
  }
  return null;
};

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
  const deduped = new Map();
  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    const normalized = coerceImportEntry(rawEntry);
    if (!normalized) continue;
    const normalizedSpecifierList = normalized.provenance === 'parsed-literal'
      ? [sanitizeImportSpecifier(normalized.specifier,{literal:true})] : normalizeImportSpecifiers([normalized.specifier]);
    const specifier = normalizedSpecifierList[0];
    if (!specifier) continue;
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
  return Array.from(deduped.values())
    .sort((a, b) => (a.specifier < b.specifier ? -1 : (a.specifier > b.specifier ? 1 : 0)));
};

export function getLanguageForFile(ext, relPath) {
  const normalized = relPath || '';
  const descriptorMatch = resolveDescriptorLanguage(ext, normalized);
  if (descriptorMatch) return descriptorMatch;
  return resolveLinguistLanguage(ext, normalized);
}

export function collectLanguageImports(input = {}) {
  const entries = collectLanguageImportEntries(input);
  return entries.map((entry) => entry.specifier);
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
    return [];
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
  const imports = typeof lang.collectImportEntries === 'function'
    ? lang.collectImportEntries(text, merged)
    : lang.collectImports(text, merged);
  return normalizeImportEntries(imports);
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
  const coverage = chunk?.meta?.syntaxCallCoverage || fileRelations.callCoverage;
  if (coverage) output.callCoverage = coverage;
  if (chunk?.meta?.syntaxCallOmissions) output.callOmissions = { ...chunk.meta.syntaxCallOmissions };
  else if (Array.isArray(fileRelations.callCoverageReasons)) output.callCoverageReasons = [...fileRelations.callCoverageReasons];
  if (chunk?.name) {
    const pythonScopedCalls = lang?.id === 'python' && typeof chunk.meta?.pythonScopeId === 'string'
      && fileRelations.callOwnership === 'python-lexical-scope-v1';
    const nativeScopedCalls = Array.isArray(chunk.meta?.syntaxCalls)
      && fileRelations.callOwnership === 'native-syntax-occurrences-v1';
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
