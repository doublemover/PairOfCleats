import { extractNgrams } from '../../shared/tokenize.js';
import {
  bitmapToSet,
  createBitmapFromIds,
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

/**
 * Filter chunk metadata by search constraints.
 * @param {Array} meta
 * @param {object} filters
 * @returns {Array}
 */
export function filterChunks(meta, filters = {}, filterIndex = null, fileRelations = null) {
  const {
    type,
    author,
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
    structPack,
    structRule,
    structTag,
    awaits,
    branches,
    loops,
    breaks,
    continues,
    inferredType,
    visibility,
    extends: extendsFilter,
    async: asyncOnly,
    generator: generatorOnly,
    returns: returnsOnly,
    file,
    caseFile,
    caseTokens,
    ext,
    lang,
    meta: metaFilter,
    chunkAuthor,
    modifiedAfter,
    excludeTokens,
    excludePhrases,
    excludePhraseRange,
    extImpossible,
    langImpossible
  } = filters;
  if (extImpossible || langImpossible) return [];

  const normalize = (value) => String(value || '').toLowerCase();
  const regexConfigRaw = filters.regexConfig || {};
  const regexConfig = regexConfigRaw && typeof regexConfigRaw === 'object' ? { ...regexConfigRaw } : {};
  if (!Object.prototype.hasOwnProperty.call(regexConfig, 'flags')) {
    regexConfig.flags = caseFile ? '' : 'i';
  }

  const {
    fileMatchers,
    extNeedles,
    langNeedles,
    normalizeFile,
    normalizeFilePrefilter
  } = buildFileFilters({
    file,
    ext,
    lang,
    caseFile,
    normalize,
    regexConfig
  });

  const filePrefilterConfig = filters.filePrefilter || {};
  const filePrefilterEnabled = filePrefilterConfig.enabled !== false;
  const fileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
    ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
    : (filterIndex?.fileChargramN || 3);
  const typeNeedles = normalizeList(type).map(normalize);
  const authorNeedles = normalizeList(author).map(normalize);
  const metaFilters = Array.isArray(metaFilter) ? metaFilter : (metaFilter ? [metaFilter] : []);
  const excludeNeedles = normalizeList(excludeTokens)
    .map((value) => (caseTokens ? String(value || '') : normalize(value)));
  const excludeNeedleSet = excludeNeedles.length ? new Set(excludeNeedles) : null;
  const normalizePhraseNeedle = (value) => {
    const normalized = caseTokens ? String(value || '') : normalize(value);
    return normalized.replace(/\s+/g, '_');
  };
  const excludePhraseNeedles = normalizePhraseList(excludePhrases).map(normalizePhraseNeedle);
  const excludePhraseSet = excludePhraseNeedles.length ? new Set(excludePhraseNeedles) : null;
  const derivedPhraseRange = (() => {
    if (excludePhraseRange?.min && excludePhraseRange?.max) return excludePhraseRange;
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
  const structPackNeedles = normalizeList(structPack).map(normalize);
  const structRuleNeedles = normalizeList(structRule).map(normalize);
  const structTagNeedles = normalizeList(structTag).map(normalize);
  const roaringAvailable = isRoaringAvailable();
  const bitmapIndex = filterIndex?.bitmap || null;
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
    isBitmapEmpty
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
    if (chunkAuthor && filterIndex.byChunkAuthor) {
      const candidate = collectSubstringMatches(
        filterIndex.byChunkAuthor,
        normalize(chunkAuthor),
        bitmapIndex?.byChunkAuthor
      );
      if (candidate) indexedCandidates.push(candidate);
    }
    if (visibility && filterIndex.byVisibility) {
      const candidate = collectSubstringMatches(
        filterIndex.byVisibility,
        normalize(visibility),
        bitmapIndex?.byVisibility
      );
      if (candidate) indexedCandidates.push(candidate);
    }
    if (fileMatchers.length && filePrefilterEnabled) {
      const filePrefilterIds = collectFilePrefilterMatches({
        fileMatchers,
        fileChargramN,
        filterIndex,
        normalizeFilePrefilter,
        intersectTwoSets
      });
      if (filePrefilterIds) {
        const candidate = buildCandidate([filePrefilterIds], []);
        if (candidate) indexedCandidates.push(candidate);
      }
    }
  }
  const candidateIds = indexedCandidates.length
    ? intersectCandidates(indexedCandidates)
    : null;
  const sourceMeta = candidateIds
    ? Array.from(candidateIds).map((id) => meta[id]).filter(Boolean)
    : meta;

  return sourceMeta.filter((c) => {
    if (!c) return false;
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
      if (excludeNeedleSet && excludeNeedleSet.size) {
        for (const token of tokens) {
          if (excludeNeedleSet.has(normalizeToken(token))) return false;
        }
      }
      if ((excludeNeedleSet && excludeNeedleSet.size) || (excludePhraseSet && excludePhraseSet.size)) {
        for (const ngram of ngrams || []) {
          const normalized = normalizeToken(ngram);
          if (excludeNeedleSet && excludeNeedleSet.has(normalized)) return false;
          if (excludePhraseSet && excludePhraseSet.has(normalized)) return false;
        }
      }
    }
    if (modifiedAfter != null) {
      const lastModified = c.last_modified ? Date.parse(c.last_modified) : NaN;
      if (!Number.isFinite(lastModified) || lastModified < modifiedAfter) return false;
    }
    if (typeNeedles.length) {
      const kindValue = c.kind;
      if (!kindValue) return false;
      const kinds = Array.isArray(kindValue) ? kindValue : [kindValue];
      const matches = kinds.some((entry) => typeNeedles.includes(normalize(entry)));
      if (!matches) return false;
    }
    if (authorNeedles.length) {
      const authorValue = c.last_author;
      if (!authorValue) return false;
      const authors = Array.isArray(authorValue) ? authorValue : [authorValue];
      const matches = authorNeedles.some((needle) =>
        authors.some((entry) => normalize(entry).includes(needle))
      );
      if (!matches) return false;
    }
    if (chunkAuthor) {
      const authors = Array.isArray(c.chunk_authors)
        ? c.chunk_authors
        : (Array.isArray(c.chunkAuthors) ? c.chunkAuthors : null);
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
    if (awaits && !matchList(c.docmeta?.awaits, awaits, normalize)) return false;
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
      if (!(c.docmeta?.modifiers?.generator || c.docmeta?.yields)) return false;
    }
    if (truthy(returnsOnly)) {
      const returnTypes = resolveReturnTypes(c);
      if (!(c.docmeta?.returnsValue || c.docmeta?.returns || returnTypes.length)) return false;
    }
    return true;
  });
}
