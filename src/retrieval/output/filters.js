import { extractNgrams } from '../../shared/tokenize.js';
import {
  bitmapToArray,
  bitmapToSet,
  createBitmapFromIds,
  createEmptyBitmap,
  getBitmapSize,
  intersectBitmaps,
  intersectSetWithBitmap,
  isBitmapEmpty,
  isRoaringAvailable,
  unionBitmaps
} from '../bitmap.js';
import { createCandidateHelpers } from './filters/candidates.js';
import { buildFileFilters, matchFileFilters } from './filters/file.js';
import { collectFilePrefilterMatches } from './filters/file-prefilter.js';
import { matchMetaFilters, resolveReturnTypes } from './filters/meta.js';
import { normalizeList, normalizePhraseList, matchList, truthy } from './filters/predicates.js';
import { matchStructural } from './filters/structural.js';
import { normalizeFilePath } from '../../shared/path-normalize.js';

export function compileFilterPredicates(filters = {}, { fileChargramN = null } = {}) {
  const normalize = (value) => String(value || '').toLowerCase();
  const caseFile = filters.caseFile === true;
  const caseTokens = filters.caseTokens === true;
  const regexConfigRaw = filters.regexConfig || {};
  const regexConfig = regexConfigRaw && typeof regexConfigRaw === 'object' ? { ...regexConfigRaw } : {};
  if (!Object.prototype.hasOwnProperty.call(regexConfig, 'flags')) {
    regexConfig.flags = caseFile ? '' : 'i';
  }
  const { fileMatchers, extNeedles, langNeedles } = buildFileFilters({
    file: filters.file,
    ext: filters.ext,
    lang: filters.lang,
    caseFile,
    normalize,
    regexConfig
  });
  const filePrefilterConfig = filters.filePrefilter || {};
  const filePrefilterEnabled = filePrefilterConfig.enabled !== false;
  const resolvedFileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
    ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
    : (Number.isFinite(Number(fileChargramN)) ? Math.max(2, Math.floor(Number(fileChargramN))) : null);
  const typeNeedles = normalizeList(filters.type).map(normalize);
  const authorNeedles = normalizeList(filters.author).map(normalize);
  const metaFilters = Array.isArray(filters.meta) ? filters.meta : (filters.meta ? [filters.meta] : []);
  const excludeNeedles = normalizeList(filters.excludeTokens)
    .map((value) => (caseTokens ? String(value || '') : normalize(value)));
  const normalizePhraseNeedle = (value) => {
    const normalized = caseTokens ? String(value || '') : normalize(value);
    return normalized.replace(/\s+/g, '_');
  };
  const excludePhraseNeedles = normalizePhraseList(filters.excludePhrases).map(normalizePhraseNeedle);
  const excludePhraseSet = excludePhraseNeedles.length ? new Set(excludePhraseNeedles) : null;
  const derivedPhraseRange = (() => {
    if (filters.excludePhraseRange?.min && filters.excludePhraseRange?.max) return filters.excludePhraseRange;
    if (!excludePhraseNeedles.length) return null;
    let min = null;
    let max = null;
    for (const needle of excludePhraseNeedles) {
      const len = String(needle || '').split('_').filter(Boolean).length;
      if (len < 2) continue;
      min = min == null ? len : Math.min(min, len);
      max = max == null ? len : Math.max(max, len);
    }
    return min && max ? { min, max } : null;
  })();
  const structPackNeedles = normalizeList(filters.structPack).map(normalize);
  const structRuleNeedles = normalizeList(filters.structRule).map(normalize);
  const structTagNeedles = normalizeList(filters.structTag).map(normalize);
  return {
    fileMatchers,
    extNeedles,
    langNeedles,
    typeNeedles,
    authorNeedles,
    metaFilters,
    excludeNeedles,
    excludePhraseNeedles,
    excludePhraseRange: derivedPhraseRange,
    structPackNeedles,
    structRuleNeedles,
    structTagNeedles,
    filePrefilterEnabled,
    fileChargramN: resolvedFileChargramN,
    caseFile,
    caseTokens
  };
}

const resolveFilterState = ({
  meta,
  filters,
  filterIndex,
  fileRelations,
  options = {}
}) => {
  const compiled = options.compiled || compileFilterPredicates(filters, {
    fileChargramN: options.fileChargramN ?? filterIndex?.fileChargramN ?? null
  });
  const normalize = (value) => String(value || '').toLowerCase();
  const caseFile = compiled.caseFile ?? filters.caseFile;
  const caseTokens = compiled.caseTokens ?? filters.caseTokens;
  const fileMatchers = compiled.fileMatchers || [];
  const extNeedles = compiled.extNeedles || [];
  const langNeedles = compiled.langNeedles || [];
  const typeNeedles = compiled.typeNeedles || [];
  const authorNeedles = compiled.authorNeedles || [];
  const metaFilters = compiled.metaFilters || [];
  const excludeNeedles = compiled.excludeNeedles || [];
  const excludePhraseNeedles = compiled.excludePhraseNeedles || [];
  const derivedPhraseRange = compiled.excludePhraseRange || null;
  const structPackNeedles = compiled.structPackNeedles || [];
  const structRuleNeedles = compiled.structRuleNeedles || [];
  const structTagNeedles = compiled.structTagNeedles || [];
  const filePrefilterEnabled = compiled.filePrefilterEnabled !== false;
  const fileChargramN = Number.isFinite(Number(compiled.fileChargramN))
    ? Math.max(2, Math.floor(Number(compiled.fileChargramN)))
    : (filterIndex?.fileChargramN || 3);
  const normalizeFile = (value) => (
    caseFile ? normalizeFilePath(value) : normalize(normalizeFilePath(value))
  );
  const normalizeFilePrefilter = (value) => normalizeFilePath(value).toLowerCase();
  const roaringAvailable = isRoaringAvailable();
  const bitmapIndex = filterIndex?.bitmap || null;
  const resolvedBitmapMinSize = Number.isFinite(Number(options.bitmapMinSize))
    ? Math.max(1, Math.floor(Number(options.bitmapMinSize)))
    : (bitmapIndex?.minSize ?? null);
  const {
    buildCandidate,
    collectExactMatches,
    collectSubstringMatches,
    collectAnySubstringMatches,
    intersectCandidates,
    intersectTwoSets
  } = createCandidateHelpers({
    roaringAvailable,
    bitmapToSet,
    createBitmapFromIds,
    unionBitmaps,
    intersectBitmaps,
    intersectSetWithBitmap,
    isBitmapEmpty,
    getBitmapSize,
    preferBitmap: options.preferBitmap === true,
    bitmapMinSize: resolvedBitmapMinSize
  });
  const resolveFileRelations = (filePath) => {
    if (!filePath || !fileRelations) return null;
    if (typeof fileRelations.get === 'function') {
      return fileRelations.get(filePath) || null;
    }
    return fileRelations[filePath] || null;
  };
  const normalizeToken = caseTokens ? (value) => String(value || '') : normalize;

  const indexedCandidates = [];
  if (filterIndex) {
    if (langNeedles.length) {
      if (!filterIndex.byLang) {
        throw new Error('[filters] filter index missing byLang; rebuild indexes to use --lang filters.');
      }
      const candidate = collectExactMatches(
        filterIndex.byLang,
        langNeedles,
        bitmapIndex?.byLang
      );
      if (candidate) indexedCandidates.push(candidate);
    }
    if (extNeedles.length && filterIndex.byExt) {
      const candidate = collectExactMatches(
        filterIndex.byExt,
        extNeedles,
        bitmapIndex?.byExt
      );
      if (candidate) indexedCandidates.push(candidate);
    }
    if (typeNeedles.length && filterIndex.byKind) {
      const candidate = collectExactMatches(
        filterIndex.byKind,
        typeNeedles,
        bitmapIndex?.byKind
      );
      if (candidate) indexedCandidates.push(candidate);
    }
    if (authorNeedles.length && filterIndex.byAuthor) {
      const candidate = collectAnySubstringMatches(
        filterIndex.byAuthor,
        authorNeedles,
        bitmapIndex?.byAuthor
      );
      if (candidate) indexedCandidates.push(candidate);
    }
    if (filters.chunkAuthor && filterIndex.byChunkAuthor) {
      const candidate = collectSubstringMatches(
        filterIndex.byChunkAuthor,
        normalize(filters.chunkAuthor),
        bitmapIndex?.byChunkAuthor
      );
      if (candidate) indexedCandidates.push(candidate);
    }
    if (filters.visibility && filterIndex.byVisibility) {
      const candidate = collectSubstringMatches(
        filterIndex.byVisibility,
        normalize(filters.visibility),
        bitmapIndex?.byVisibility
      );
      if (candidate) indexedCandidates.push(candidate);
    }
    if (fileMatchers.length && filePrefilterEnabled) {
      const filePrefilterCandidate = collectFilePrefilterMatches({
        fileMatchers,
        fileChargramN,
        filterIndex,
        normalizeFilePrefilter,
        intersectTwoSets,
        buildCandidate
      });
      if (filePrefilterCandidate) indexedCandidates.push(filePrefilterCandidate);
    }
  }
  const candidateIds = indexedCandidates.length
    ? intersectCandidates(indexedCandidates)
    : null;

  return {
    meta,
    filters,
    normalize,
    caseFile,
    caseTokens,
    fileMatchers,
    extNeedles,
    langNeedles,
    typeNeedles,
    authorNeedles,
    metaFilters,
    excludeNeedles,
    excludePhraseNeedles,
    derivedPhraseRange,
    structPackNeedles,
    structRuleNeedles,
    structTagNeedles,
    filePrefilterEnabled,
    fileChargramN,
    normalizeFile,
    normalizeFilePrefilter,
    roaringAvailable,
    bitmapIndex,
    candidateIds,
    resolveFileRelations,
    normalizeToken,
    resolvedBitmapMinSize
  };
};

const shouldUseBitmapOutput = (state, sourceCount) => {
  if (!state.roaringAvailable) return false;
  const minSize = Number.isFinite(Number(state.resolvedBitmapMinSize))
    ? Math.max(1, Math.floor(Number(state.resolvedBitmapMinSize)))
    : null;
  if (!minSize) return true;
  return Number.isFinite(sourceCount) && sourceCount >= minSize;
};

const matchChunkFilters = (c, state) => {
  if (!c) return false;
  const {
    filters,
    normalize,
    fileMatchers,
    extNeedles,
    langNeedles,
    normalizeFile,
    metaFilters,
    normalizeToken,
    excludeNeedles,
    excludePhraseNeedles,
    derivedPhraseRange,
    structPackNeedles,
    structRuleNeedles,
    structTagNeedles,
    resolveFileRelations
  } = state;
  const {
    importName,
    lint,
    churn,
    calls,
    uses,
    signature,
    param,
    decorator,
    returnType,
    throws,
    reads,
    writes,
    mutates,
    alias,
    risk,
    riskTag,
    riskSource,
    riskSink,
    riskCategory,
    riskFlow,
    chunkAuthor,
    modifiedAfter,
    branches,
    loops,
    breaks,
    continues,
    inferredType,
    visibility,
    extends: extendsFilter,
    async: asyncOnly,
    generator: generatorOnly,
    returns: returnsOnly
  } = filters;

  if (!matchFileFilters({ chunk: c, fileMatchers, extNeedles, langNeedles, normalizeFile, normalize })) {
    return false;
  }
  if (!matchMetaFilters({
    chunk: c,
    metaFilters,
    param,
    returnType,
    inferredType,
    risk,
    riskTag,
    riskSource,
    riskSink,
    riskCategory,
    riskFlow,
    normalize
  })) {
    return false;
  }
  if (excludeNeedles.length || excludePhraseNeedles.length) {
    const tokens = Array.isArray(c.tokens) ? c.tokens : [];
    let ngrams = Array.isArray(c.ngrams) ? c.ngrams : null;
    if (!ngrams && excludePhraseNeedles.length && tokens.length && derivedPhraseRange?.min && derivedPhraseRange?.max) {
      ngrams = extractNgrams(tokens, derivedPhraseRange.min, derivedPhraseRange.max);
    }
    const tokenSet = new Set(tokens.map(normalizeToken));
    const ngramSet = new Set((ngrams || []).map(normalizeToken));
    const tokenMatch = excludeNeedles.some((needle) => tokenSet.has(needle) || ngramSet.has(needle));
    if (tokenMatch) return false;
    if (excludePhraseNeedles.some((needle) => ngramSet.has(needle))) return false;
  }
  if (modifiedAfter != null) {
    const lastModified = c.last_modified ? Date.parse(c.last_modified) : NaN;
    if (!Number.isFinite(lastModified) || lastModified < modifiedAfter) return false;
  }
  if (state.typeNeedles.length) {
    const kindValue = c.kind;
    if (!kindValue) return false;
    const kinds = Array.isArray(kindValue) ? kindValue : [kindValue];
    const matches = kinds.some((entry) => state.typeNeedles.includes(normalize(entry)));
    if (!matches) return false;
  }
  if (state.authorNeedles.length) {
    const authorValue = c.last_author;
    if (!authorValue) return false;
    const authors = Array.isArray(authorValue) ? authorValue : [authorValue];
    const matches = state.authorNeedles.some((needle) =>
      authors.some((entry) => normalize(entry).includes(needle))
    );
    if (!matches) return false;
  }
  if (chunkAuthor) {
    const chunkAuthors = Array.isArray(c.chunk_authors)
      ? c.chunk_authors
      : (Array.isArray(c.chunkAuthors) ? c.chunkAuthors : null);
    const authors = (Array.isArray(chunkAuthors) && chunkAuthors.length)
      ? chunkAuthors
      : (Array.isArray(c.last_author)
        ? c.last_author
        : (c.last_author ? [c.last_author] : null));
    if (!matchList(authors, chunkAuthor, normalize)) return false;
  }
  if (importName) {
    const imports = c.codeRelations?.imports || resolveFileRelations(c.file)?.imports;
    if (!Array.isArray(imports) || !imports.includes(importName)) return false;
  }
  if (lint && (!c.lint || !c.lint.length)) return false;
  if (churn !== null && churn !== undefined) {
    const churnValue = Number(c.churn);
    if (!Number.isFinite(churnValue) || churnValue < churn) return false;
  }
  if (calls) {
    const callsList = c.codeRelations?.calls;
    if (!Array.isArray(callsList)) return false;
    const found = callsList.find(([fn, callName]) => fn === calls || callName === calls);
    if (!found) return false;
  }
  if (uses) {
    const usages = c.codeRelations?.usages || resolveFileRelations(c.file)?.usages;
    if (!Array.isArray(usages) || !usages.includes(uses)) return false;
  }
  if (signature) {
    const sig = c.docmeta?.signature;
    if (!sig || !sig.includes(signature)) return false;
  }
  if (decorator && !matchList(c.docmeta?.decorators, decorator, normalize)) return false;
  if (throws && !matchList(c.docmeta?.throws, throws, normalize)) return false;
  if (filters.awaits && !matchList(c.docmeta?.awaits, filters.awaits, normalize)) return false;
  if (reads && !matchList(c.docmeta?.dataflow?.reads, reads, normalize)) return false;
  if (writes && !matchList(c.docmeta?.dataflow?.writes, writes, normalize)) return false;
  if (mutates && !matchList(c.docmeta?.dataflow?.mutations, mutates, normalize)) return false;
  if (alias && !matchList(c.docmeta?.dataflow?.aliases, alias, normalize)) return false;
  if (!matchStructural({
    chunk: c,
    structPackNeedles,
    structRuleNeedles,
    structTagNeedles,
    normalize
  })) {
    return false;
  }
  if (branches != null) {
    const count = c.docmeta?.controlFlow?.branches;
    if (!Number.isFinite(count) || count < branches) return false;
  }
  if (loops != null) {
    const count = c.docmeta?.controlFlow?.loops;
    if (!Number.isFinite(count) || count < loops) return false;
  }
  if (breaks != null) {
    const count = c.docmeta?.controlFlow?.breaks;
    if (!Number.isFinite(count) || count < breaks) return false;
  }
  if (continues != null) {
    const count = c.docmeta?.controlFlow?.continues;
    if (!Number.isFinite(count) || count < continues) return false;
  }
  if (visibility) {
    const docVisibility = c.docmeta?.visibility || c.docmeta?.modifiers?.visibility || null;
    if (!docVisibility || !normalize(docVisibility).includes(normalize(visibility))) {
      return false;
    }
  }
  if (extendsFilter) {
    const parents = c.docmeta?.extends || c.docmeta?.bases || [];
    if (!matchList(parents, extendsFilter, normalize)) return false;
  }
  if (truthy(asyncOnly)) {
    if (!(c.docmeta?.async || c.docmeta?.modifiers?.async)) return false;
  }
  if (truthy(generatorOnly)) {
    if (!(c.docmeta?.generator || c.docmeta?.modifiers?.generator)) return false;
  }
  if (truthy(returnsOnly)) {
    if (!(c.docmeta?.returns || c.docmeta?.modifiers?.returns)) return false;
  }
  if (filters.awaits && (!Array.isArray(c.docmeta?.awaits) || !c.docmeta.awaits.length)) return false;
  if (decorator && (!Array.isArray(c.docmeta?.decorators) || !c.docmeta.decorators.length)) return false;
  return true;
};

/**
 * Filter chunk metadata by search constraints.
 * @param {Array} meta
 * @param {object} filters
 * @returns {Array}
 */
export function filterChunks(meta, filters = {}, filterIndex = null, fileRelations = null, options = {}) {
  const { extImpossible, langImpossible } = filters;
  if (extImpossible || langImpossible) return [];

  const state = resolveFilterState({ meta, filters, filterIndex, fileRelations, options });
  const { candidateIds } = state;
  const sourceIds = candidateIds
    ? (candidateIds instanceof Set ? Array.from(candidateIds) : bitmapToArray(candidateIds))
    : null;
  const sourceMeta = sourceIds
    ? sourceIds.map((id) => meta[id]).filter(Boolean)
    : meta;

  return sourceMeta.filter((c) => matchChunkFilters(c, state));
}

export function filterChunkIds(meta, filters = {}, filterIndex = null, fileRelations = null, options = {}) {
  const { extImpossible, langImpossible } = filters;
  if (extImpossible || langImpossible) return new Set();

  const state = resolveFilterState({ meta, filters, filterIndex, fileRelations, options });
  const candidateIds = state.candidateIds;
  const sourceCount = candidateIds ? getBitmapSize(candidateIds) : (Array.isArray(meta) ? meta.length : 0);
  let useBitmapOutput = options.preferBitmap !== false && shouldUseBitmapOutput(state, sourceCount);
  let outputBitmap = useBitmapOutput ? createEmptyBitmap() : null;
  if (useBitmapOutput && !outputBitmap) {
    useBitmapOutput = false;
  }
  const outputSet = useBitmapOutput ? null : new Set();
  let matchedCount = 0;
  const addId = (id) => {
    matchedCount += 1;
    if (useBitmapOutput) {
      if (typeof outputBitmap.addMany === 'function') {
        outputBitmap.addMany([id]);
      } else if (typeof outputBitmap.add === 'function') {
        outputBitmap.add(id);
      }
      return;
    }
    outputSet.add(id);
  };
  if (candidateIds) {
    if (candidateIds instanceof Set) {
      for (const id of candidateIds) {
        const chunk = meta[id];
        if (matchChunkFilters(chunk, state)) addId(id);
      }
    } else {
      for (const id of bitmapToArray(candidateIds)) {
        const chunk = meta[id];
        if (matchChunkFilters(chunk, state)) addId(id);
      }
    }
  } else if (Array.isArray(meta)) {
    for (const chunk of meta) {
      if (!chunk) continue;
      if (matchChunkFilters(chunk, state)) addId(chunk.id);
    }
  }

  if (!matchedCount) return useBitmapOutput ? outputBitmap : outputSet;
  if (!candidateIds && matchedCount === sourceCount) return null;
  return useBitmapOutput ? outputBitmap : outputSet;
}
