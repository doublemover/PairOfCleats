import path from 'node:path';
import { extractNgrams, tri } from '../../shared/tokenize.js';
import { collectDeclaredReturnTypes, collectMetaV2ReturnTypes } from '../../shared/docmeta.js';
import { compileSafeRegex } from '../../shared/safe-regex.js';
import {
  bitmapToSet,
  createBitmapFromIds,
  intersectBitmaps,
  intersectSetWithBitmap,
  isBitmapEmpty,
  isRoaringAvailable,
  unionBitmaps
} from '../bitmap.js';

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
  const resolveReturnTypes = (chunk) => {
    const declared = collectDeclaredReturnTypes(chunk?.docmeta);
    const metaDeclared = collectMetaV2ReturnTypes(chunk?.metaV2);
    if (!declared.length && !metaDeclared.length) return [];
    return Array.from(new Set([...declared, ...metaDeclared]));
  };
  const normalizeFilePath = (value) => String(value || '').replace(/\\/g, '/');
  const normalizeFile = (value) => (
    caseFile ? normalizeFilePath(value) : normalize(normalizeFilePath(value))
  );
  const normalizeFilePrefilter = (value) => normalizeFilePath(value).toLowerCase();
  const regexConfigRaw = filters.regexConfig || {};
  const regexConfig = regexConfigRaw && typeof regexConfigRaw === 'object' ? { ...regexConfigRaw } : {};
  if (!Object.prototype.hasOwnProperty.call(regexConfig, 'flags')) {
    regexConfig.flags = caseFile ? '' : 'i';
  }
  const normalizeList = (value) => {
    if (!value) return [];
    const entries = Array.isArray(value) ? value : [value];
    return entries
      .flatMap((entry) => String(entry || '').split(/[,\s]+/))
      .map((entry) => entry.trim())
      .filter(Boolean);
  };
  const normalizePhraseList = (value) => {
    if (!value) return [];
    const entries = Array.isArray(value) ? value : [value];
    const out = [];
    for (const entry of entries) {
      const raw = String(entry || '').trim();
      if (!raw) continue;
      if (raw.includes(',')) {
        raw
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
          .forEach((part) => out.push(part));
      } else {
        out.push(raw);
      }
    }
    return out;
  };
  const parseFileMatcher = (entry) => {
    const raw = String(entry || '').trim();
    if (!raw) return null;
    const regexMatch = raw.match(/^\/(.+)\/([a-z]*)$/i);
    if (regexMatch) {
      const pattern = regexMatch[1];
      const flags = regexMatch[2] || '';
      const matcher = compileSafeRegex(pattern, flags, regexConfig);
      if (matcher.regex) return { type: 'regex', value: matcher.regex };
      return { type: 'substring', value: normalizeFile(pattern) };
    }
    return { type: 'substring', value: normalizeFile(raw) };
  };
  const fileMatchers = normalizeList(file).map(parseFileMatcher).filter(Boolean);
  const filePrefilterConfig = filters.filePrefilter || {};
  const filePrefilterEnabled = filePrefilterConfig.enabled !== false;
  const fileChargramN = Number.isFinite(Number(filePrefilterConfig.chargramN))
    ? Math.max(2, Math.floor(Number(filePrefilterConfig.chargramN)))
    : (filterIndex?.fileChargramN || 3);
  const extNeedles = normalizeList(ext)
    .map((entry) => {
      let value = entry.toLowerCase();
      value = value.replace(/^\*+/, '');
      if (value && !value.startsWith('.')) value = `.${value}`;
      return value;
    })
    .filter(Boolean);
    const typeNeedles = normalizeList(type).map(normalize);
    const langNeedles = normalizeList(lang).map(normalize);
  const authorNeedles = normalizeList(author).map(normalize);
  const metaFilters = Array.isArray(metaFilter) ? metaFilter : (metaFilter ? [metaFilter] : []);
  const excludeNeedles = normalizeList(excludeTokens).map((value) => (caseTokens ? String(value || '') : normalize(value)));
  const normalizePhraseNeedle = (value) => {
    const normalized = caseTokens ? String(value || '') : normalize(value);
    return normalized.replace(/\s+/g, '_');
  };
  const excludePhraseNeedles = normalizePhraseList(excludePhrases).map(normalizePhraseNeedle);
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
  const buildCandidate = (sets, bitmaps) => {
    const setList = Array.isArray(sets) ? sets.filter(Boolean) : [];
    const bitmapList = Array.isArray(bitmaps) ? bitmaps.filter(Boolean) : [];
    if (!setList.length && !bitmapList.length) return null;
    if (roaringAvailable) {
      let bitmap = bitmapList.length ? unionBitmaps(bitmapList) : null;
      if (setList.length) {
        const ids = [];
        for (const set of setList) {
          for (const id of set) ids.push(id);
        }
        const extraBitmap = createBitmapFromIds(ids, { force: true });
        if (extraBitmap) {
          bitmap = bitmap ? unionBitmaps([bitmap, extraBitmap]) : extraBitmap;
        }
      }
      if (bitmap) return { bitmap };
    }
    const out = new Set();
    for (const set of setList) {
      for (const id of set) out.add(id);
    }
    for (const bitmap of bitmapList) {
      for (const id of bitmapToSet(bitmap)) out.add(id);
    }
    return { set: out };
  };
  const mergeCandidates = (candidates) => {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const sets = [];
    const bitmaps = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate.bitmap) bitmaps.push(candidate.bitmap);
      if (candidate.set) sets.push(candidate.set);
    }
    return buildCandidate(sets, bitmaps);
  };
  const collectExactMatches = (map, values, bitmapMap = null) => {
    if (!map || !values.length) return null;
    const sets = [];
    const bitmaps = [];
    for (const value of values) {
      if (!value) continue;
      const set = map.get(value);
      if (!set) continue;
      const bitmap = bitmapMap ? bitmapMap.get(value) : null;
      if (bitmap) {
        bitmaps.push(bitmap);
      } else {
        sets.push(set);
      }
    }
    if (!sets.length && !bitmaps.length) return { set: new Set() };
    return buildCandidate(sets, bitmaps);
  };
  const collectSubstringMatches = (map, needle, bitmapMap = null) => {
    if (!map || !needle) return null;
    const sets = [];
    const bitmaps = [];
    for (const [key, set] of map.entries()) {
      if (!key.includes(needle)) continue;
      const bitmap = bitmapMap ? bitmapMap.get(key) : null;
      if (bitmap) {
        bitmaps.push(bitmap);
      } else {
        sets.push(set);
      }
    }
    if (!sets.length && !bitmaps.length) return { set: new Set() };
    return buildCandidate(sets, bitmaps);
  };
  const collectAnySubstringMatches = (map, values, bitmapMap = null) => {
    if (!map || !values.length) return null;
    const candidates = values
      .map((value) => collectSubstringMatches(map, value, bitmapMap))
      .filter(Boolean);
    return mergeCandidates(candidates);
  };
  const intersectSets = (sets) => {
    if (!sets.length) return null;
    let acc = sets[0];
    for (let i = 1; i < sets.length; i += 1) {
      const next = sets[i];
      const merged = new Set();
      for (const id of acc) {
        if (next.has(id)) merged.add(id);
      }
      acc = merged;
      if (!acc.size) break;
    }
    return acc;
  };
  const intersectTwoSets = (left, right) => {
    if (!left || !right) return new Set();
    const out = new Set();
    for (const id of left) {
      if (right.has(id)) out.add(id);
    }
    return out;
  };
  const intersectCandidates = (candidates) => {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const sets = [];
    const bitmaps = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate.set) {
        if (!candidate.set.size) return new Set();
        sets.push(candidate.set);
      }
      if (candidate.bitmap) {
        if (isBitmapEmpty(candidate.bitmap)) return new Set();
        bitmaps.push(candidate.bitmap);
      }
    }
    if (bitmaps.length) {
      let bitmap = intersectBitmaps(bitmaps);
      if (!bitmap || isBitmapEmpty(bitmap)) return new Set();
      if (sets.length) {
        const setIntersection = intersectSets(sets);
        if (!setIntersection || !setIntersection.size) return new Set();
        const setBitmap = createBitmapFromIds(setIntersection, { force: true });
        if (setBitmap) {
          bitmap = intersectBitmaps([bitmap, setBitmap]);
          return bitmap ? bitmapToSet(bitmap) : new Set();
        }
        return intersectSetWithBitmap(setIntersection, bitmap);
      }
      return bitmapToSet(bitmap);
    }
    return intersectSets(sets);
  };
  const extractRegexLiteral = (pattern) => {
    let best = '';
    let current = '';
    let escaped = false;
    for (const ch of pattern) {
      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if ('^$.*+?()[]{}|'.includes(ch)) {
        if (current.length > best.length) best = current;
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.length > best.length) best = current;
    return best;
  };
  const collectFilePrefilterMatches = () => {
    if (!fileMatchers.length || !filterIndex || !filterIndex.fileChargrams || !filterIndex.fileChunksById) {
      return null;
    }
    const fileIds = new Set();
    for (const matcher of fileMatchers) {
      let needle = null;
      if (matcher.type === 'substring') {
        needle = normalizeFilePrefilter(matcher.value);
      } else if (matcher.type === 'regex') {
        const literal = extractRegexLiteral(matcher.value.source || '');
        needle = literal ? normalizeFilePrefilter(literal) : null;
      }
      if (!needle || needle.length < fileChargramN) continue;
      const grams = tri(needle, fileChargramN);
      if (!grams.length) continue;
      let candidateFiles = null;
      for (const gram of grams) {
        const bucket = filterIndex.fileChargrams.get(gram);
        if (!bucket) {
          candidateFiles = new Set();
          break;
        }
        candidateFiles = candidateFiles ? intersectTwoSets(candidateFiles, bucket) : new Set(bucket);
        if (!candidateFiles.size) break;
      }
      if (!candidateFiles || !candidateFiles.size) continue;
      for (const fileId of candidateFiles) {
        fileIds.add(fileId);
      }
    }
    if (!fileIds.size) return null;
    const chunkIds = new Set();
    for (const fileId of fileIds) {
      const chunks = filterIndex.fileChunksById[fileId];
      if (!chunks) continue;
      for (const id of chunks) chunkIds.add(id);
    }
    return chunkIds;
  };
  const matchList = (list, value) => {
    if (!value) return true;
    if (!Array.isArray(list)) return false;
    const needle = normalize(value);
    return list.some((entry) => normalize(entry).includes(needle));
  };
  const matchInferredType = (inferred, value) => {
    if (!value) return true;
    if (!inferred) return false;
    const needle = normalize(value);
    const types = [];
    const collect = (entries) => {
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        if (entry?.type) types.push(entry.type);
      }
    };
    const collectMap = (map) => {
      if (!map || typeof map !== 'object') return;
      Object.values(map).forEach((entries) => collect(entries));
    };
    collectMap(inferred.params);
    collectMap(inferred.fields);
    collectMap(inferred.locals);
    collect(inferred.returns);
    if (!types.length) return false;
    return types.some((entry) => normalize(entry).includes(needle));
  };
  const matchStructural = (chunk) => {
    if (!structPackNeedles.length && !structRuleNeedles.length && !structTagNeedles.length) {
      return true;
    }
    const structural = chunk?.docmeta?.structural;
    if (!Array.isArray(structural) || !structural.length) return false;
    return structural.some((entry) => {
      if (structPackNeedles.length) {
        const packValue = normalize(entry?.pack || '');
        if (!structPackNeedles.some((needle) => packValue.includes(needle))) return false;
      }
      if (structRuleNeedles.length) {
        const ruleValue = normalize(entry?.ruleId || '');
        if (!structRuleNeedles.some((needle) => ruleValue.includes(needle))) return false;
      }
      if (structTagNeedles.length) {
        const tags = Array.isArray(entry?.tags) ? entry.tags : [];
        if (!tags.some((tag) =>
          structTagNeedles.some((needle) => normalize(tag).includes(needle))
        )) {
          return false;
        }
      }
      return true;
    });
  };
  const truthy = (value) => value === true;
  const resolveMetaField = (record, key) => {
    if (!record || typeof record !== 'object' || !key) return undefined;
    if (!key.includes('.')) return record[key];
    return key.split('.').reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), record);
  };
  const matchMetaFilters = (chunk) => {
    if (!metaFilters.length) return true;
    const recordMeta = chunk?.docmeta?.record;
    if (!recordMeta || typeof recordMeta !== 'object') return false;
    for (const filter of metaFilters) {
      const key = filter?.key;
      if (!key) continue;
      const value = filter?.value;
      const field = resolveMetaField(recordMeta, key);
      if (value == null || value === '') {
        if (field == null) return false;
        if (Array.isArray(field) && field.length === 0) return false;
        if (typeof field === 'string' && !field.trim()) return false;
        continue;
      }
      const needle = normalize(value);
      if (Array.isArray(field)) {
        if (!field.some((entry) => normalize(entry).includes(needle))) return false;
      } else if (field && typeof field === 'object') {
        if (!normalize(JSON.stringify(field)).includes(needle)) return false;
      } else if (!normalize(field).includes(needle)) {
        return false;
      }
    }
    return true;
  };
  const resolveFileRelations = (file) => {
    if (!file || !fileRelations) return null;
    if (typeof fileRelations.get === 'function') {
      return fileRelations.get(file) || null;
    }
    return fileRelations[file] || null;
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
        const filePrefilterIds = collectFilePrefilterMatches();
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
      if (fileMatchers.length) {
        const fileValue = String(c.file || '');
        const fileValueNorm = normalizeFile(fileValue);
        const matches = fileMatchers.some((matcher) => {
          if (matcher.type === 'regex') {
            matcher.value.lastIndex = 0;
            return matcher.value.test(fileValue);
          }
          return fileValueNorm.includes(matcher.value);
        });
        if (!matches) return false;
      }
      if (langNeedles.length) {
        const langValue = c.metaV2?.lang
          || c.metaV2?.effective?.languageId
          || c.lang
          || null;
        if (!langValue) return false;
        if (!langNeedles.includes(normalize(langValue))) return false;
      }
      if (extNeedles.length) {
        const extValue = normalize(c.ext || path.extname(c.file || ''));
        if (!extNeedles.includes(extValue)) return false;
      }
    if (!matchMetaFilters(c)) return false;
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
      if (!matchList(authors, chunkAuthor)) return false;
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
      if (!Array.isArray(usages)) return false;
      if (!usages.includes(uses)) return false;
    }
    if (signature) {
      const sig = c.docmeta?.signature;
      if (!sig) return false;
      if (!sig.includes(signature)) return false;
    }
    if (param) {
      const params = c.docmeta?.params;
      if (!Array.isArray(params)) return false;
      if (!params.includes(param)) return false;
    }
    if (decorator && !matchList(c.docmeta?.decorators, decorator)) return false;
    if (returnType) {
      const returnTypes = resolveReturnTypes(c);
      if (!returnTypes.length || !returnTypes.some((entry) => normalize(entry).includes(normalize(returnType)))) {
        return false;
      }
    }
    if (inferredType && !matchInferredType(c.docmeta?.inferredTypes, inferredType)) {
      return false;
    }
    if (throws && !matchList(c.docmeta?.throws, throws)) return false;
    if (awaits && !matchList(c.docmeta?.awaits, awaits)) return false;
    if (reads && !matchList(c.docmeta?.dataflow?.reads, reads)) return false;
    if (writes && !matchList(c.docmeta?.dataflow?.writes, writes)) return false;
    if (mutates && !matchList(c.docmeta?.dataflow?.mutations, mutates)) return false;
    if (alias && !matchList(c.docmeta?.dataflow?.aliases, alias)) return false;
    const riskMeta = c.docmeta?.risk || null;
    const riskTagValue = riskTag || risk;
    if (riskTagValue && !matchList(riskMeta?.tags, riskTagValue)) return false;
    if (riskSource) {
      const sourceNames = Array.isArray(riskMeta?.sources)
        ? riskMeta.sources.map((source) => source.name)
        : null;
      if (!matchList(sourceNames, riskSource)) return false;
    }
    if (riskSink) {
      const sinkNames = Array.isArray(riskMeta?.sinks)
        ? riskMeta.sinks.map((sink) => sink.name)
        : null;
      if (!matchList(sinkNames, riskSink)) return false;
    }
    if (riskCategory) {
      const categories = Array.isArray(riskMeta?.categories)
        ? riskMeta.categories
        : (Array.isArray(riskMeta?.sinks) ? riskMeta.sinks.map((sink) => sink.category) : null);
      if (!matchList(categories, riskCategory)) return false;
    }
    if (riskFlow) {
      const flows = Array.isArray(riskMeta?.flows)
        ? riskMeta.flows.map((flow) => `${flow.source}->${flow.sink}`)
        : null;
      if (!matchList(flows, riskFlow)) return false;
    }
    if (!matchStructural(c)) return false;
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
      if (!matchList(parents, extendsFilter)) return false;
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
