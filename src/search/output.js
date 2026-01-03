import fs from 'node:fs';
import path from 'node:path';
import { extractNgrams, tri } from '../shared/tokenize.js';
import {
  createCacheReporter,
  createLruCache,
  DEFAULT_CACHE_MB,
  DEFAULT_CACHE_TTL_MS,
  estimateStringBytes
} from '../shared/cache.js';

const resolveEntryLimit = (raw) => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
};

let outputCacheReporter = createCacheReporter({ enabled: false, log: null });
let fileTextCache = createLruCache({
  name: 'fileText',
  maxMb: DEFAULT_CACHE_MB.fileText,
  ttlMs: DEFAULT_CACHE_TTL_MS.fileText,
  sizeCalculation: estimateStringBytes,
  reporter: outputCacheReporter
});
let summaryCache = createLruCache({
  name: 'summary',
  maxMb: DEFAULT_CACHE_MB.summary,
  ttlMs: DEFAULT_CACHE_TTL_MS.summary,
  sizeCalculation: estimateStringBytes,
  reporter: outputCacheReporter
});

export function configureOutputCaches({ cacheConfig = null, verbose = false, log = null } = {}) {
  const entryLimits = {
    fileText: resolveEntryLimit(process.env.PAIROFCLEATS_FILE_CACHE_MAX),
    summary: resolveEntryLimit(process.env.PAIROFCLEATS_SUMMARY_CACHE_MAX)
  };
  outputCacheReporter = createCacheReporter({ enabled: verbose, log });
  const fileTextConfig = cacheConfig?.fileText || {};
  const summaryConfig = cacheConfig?.summary || {};
  fileTextCache = createLruCache({
    name: 'fileText',
    maxMb: Number.isFinite(Number(fileTextConfig.maxMb))
      ? Number(fileTextConfig.maxMb)
      : DEFAULT_CACHE_MB.fileText,
    ttlMs: Number.isFinite(Number(fileTextConfig.ttlMs))
      ? Number(fileTextConfig.ttlMs)
      : DEFAULT_CACHE_TTL_MS.fileText,
    maxEntries: entryLimits.fileText,
    sizeCalculation: estimateStringBytes,
    reporter: outputCacheReporter
  });
  summaryCache = createLruCache({
    name: 'summary',
    maxMb: Number.isFinite(Number(summaryConfig.maxMb))
      ? Number(summaryConfig.maxMb)
      : DEFAULT_CACHE_MB.summary,
    ttlMs: Number.isFinite(Number(summaryConfig.ttlMs))
      ? Number(summaryConfig.ttlMs)
      : DEFAULT_CACHE_TTL_MS.summary,
    maxEntries: entryLimits.summary,
    sizeCalculation: estimateStringBytes,
    reporter: outputCacheReporter
  });
  return outputCacheReporter;
}

export function getOutputCacheReporter() {
  return outputCacheReporter;
}

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
    meta: metaFilter,
    chunkAuthor,
    modifiedAfter,
    excludeTokens,
    excludePhrases,
    excludePhraseRange
  } = filters;
  const normalize = (value) => String(value || '').toLowerCase();
  const normalizeFile = (value) => (caseFile ? String(value || '') : normalize(value));
  const normalizeList = (value) => {
    if (!value) return [];
    const entries = Array.isArray(value) ? value : [value];
    return entries
      .flatMap((entry) => String(entry || '').split(/[,\s]+/))
      .map((entry) => entry.trim())
      .filter(Boolean);
  };
  const parseFileMatcher = (entry) => {
    const raw = String(entry || '').trim();
    if (!raw) return null;
    const regexMatch = raw.match(/^\/(.+)\/([a-z]*)$/i);
    if (regexMatch) {
      const pattern = regexMatch[1];
      let flags = regexMatch[2] || '';
      if (!caseFile && !flags.includes('i')) flags += 'i';
      try {
        return { type: 'regex', value: new RegExp(pattern, flags) };
      } catch {
        return { type: 'substring', value: normalizeFile(raw) };
      }
    }
    return { type: 'substring', value: normalizeFile(raw) };
  };
  const fileMatchers = normalizeList(file).map(parseFileMatcher).filter(Boolean);
  const filePrefilterConfig = filters.filePrefilter || {};
  const filePrefilterEnabled = filePrefilterConfig.enabled !== false && !caseFile;
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
  const authorNeedles = normalizeList(author).map(normalize);
  const metaFilters = Array.isArray(metaFilter) ? metaFilter : (metaFilter ? [metaFilter] : []);
  const excludeNeedles = normalizeList(excludeTokens).map((value) => (caseTokens ? String(value || '') : normalize(value)));
  const excludePhraseNeedles = normalizeList(excludePhrases).map((value) => (caseTokens ? String(value || '') : normalize(value)));
  const collectExactMatches = (map, values) => {
    const matches = new Set();
    for (const value of values) {
      if (!value) continue;
      const set = map.get(value);
      if (!set) continue;
      for (const id of set) matches.add(id);
    }
    return matches;
  };
  const collectSubstringMatches = (map, needle) => {
    const matches = new Set();
    if (!needle) return matches;
    for (const [key, set] of map.entries()) {
      if (!key.includes(needle)) continue;
      for (const id of set) matches.add(id);
    }
    return matches;
  };
  const collectAnySubstringMatches = (map, values) => {
    const matches = new Set();
    for (const value of values) {
      const set = collectSubstringMatches(map, value);
      for (const id of set) matches.add(id);
    }
    return matches;
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
        needle = normalizeFile(matcher.value);
      } else if (matcher.type === 'regex') {
        const literal = extractRegexLiteral(matcher.value.source || '');
        needle = literal ? normalizeFile(literal) : null;
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

  const indexedSets = [];
  if (filterIndex) {
    if (extNeedles.length && filterIndex.byExt) {
      indexedSets.push(collectExactMatches(filterIndex.byExt, extNeedles));
    }
    if (typeNeedles.length && filterIndex.byKind) {
      indexedSets.push(collectExactMatches(filterIndex.byKind, typeNeedles));
    }
    if (authorNeedles.length && filterIndex.byAuthor) {
      indexedSets.push(collectAnySubstringMatches(filterIndex.byAuthor, authorNeedles));
    }
    if (chunkAuthor && filterIndex.byChunkAuthor) {
      indexedSets.push(collectSubstringMatches(filterIndex.byChunkAuthor, normalize(chunkAuthor)));
    }
    if (visibility && filterIndex.byVisibility) {
      indexedSets.push(collectSubstringMatches(filterIndex.byVisibility, normalize(visibility)));
    }
    if (fileMatchers.length && filePrefilterEnabled) {
      const filePrefilterIds = collectFilePrefilterMatches();
      if (filePrefilterIds) indexedSets.push(filePrefilterIds);
    }
  }
  const candidateIds = indexedSets.length ? intersectSets(indexedSets) : null;
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
    if (extNeedles.length) {
      const extValue = normalize(c.ext || path.extname(c.file || ''));
      if (!extNeedles.includes(extValue)) return false;
    }
    if (!matchMetaFilters(c)) return false;
    if (excludeNeedles.length || excludePhraseNeedles.length) {
      const tokens = Array.isArray(c.tokens) ? c.tokens : [];
      let ngrams = Array.isArray(c.ngrams) ? c.ngrams : null;
      if (!ngrams && excludePhraseNeedles.length && tokens.length && excludePhraseRange?.min && excludePhraseRange?.max) {
        ngrams = extractNgrams(tokens, excludePhraseRange.min, excludePhraseRange.max);
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
    if (chunkAuthor && !matchList(c.chunk_authors, chunkAuthor)) return false;
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
      const foundReturnType = c.docmeta?.returnType || null;
      if (!foundReturnType || !normalize(foundReturnType).includes(normalize(returnType))) {
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
      if (!(c.docmeta?.returnsValue || c.docmeta?.returns)) return false;
    }
    return true;
  });
}

/**
 * Normalize context lines for display.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function cleanContext(lines) {
  return lines
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === '```') return false;
      if (!/[a-zA-Z0-9]/.test(trimmed)) return false;
      return true;
    })
    .map((line) => line.replace(/\s+/g, ' ').trim());
}

function getBodySummary(rootDir, chunk, maxWords = 80) {
  try {
    const absPath = path.join(rootDir, chunk.file);
    const cacheKey = `${absPath}:${chunk.start}:${chunk.end}:${maxWords}`;
    const cached = summaryCache.get(cacheKey);
    if (cached !== null) return cached;
    let text = fileTextCache.get(absPath);
    if (text == null) {
      text = fs.readFileSync(absPath, 'utf8');
      fileTextCache.set(absPath, text);
    }
    const chunkText = text.slice(chunk.start, chunk.end)
      .replace(/\s+/g, ' ')
      .trim();
    const words = chunkText.split(/\s+/).slice(0, maxWords).join(' ');
    summaryCache.set(cacheKey, words);
    return words;
  } catch {
    return '(Could not load summary)';
  }
}

const formatInferredEntry = (entry) => {
  if (!entry?.type) return '';
  const parts = [];
  if (entry.source) parts.push(entry.source);
  if (Number.isFinite(entry.confidence)) parts.push(entry.confidence.toFixed(2));
  const suffix = parts.length ? ` (${parts.join(', ')})` : '';
  return `${entry.type}${suffix}`;
};

const formatInferredEntries = (entries, limit = 3) => {
  if (!Array.isArray(entries) || !entries.length) return '';
  return entries.slice(0, limit).map(formatInferredEntry).filter(Boolean).join(', ');
};

const formatInferredMap = (map, limit = 3) => {
  if (!map || typeof map !== 'object') return '';
  const entries = Object.entries(map).slice(0, limit).map(([name, items]) => {
    const formatted = formatInferredEntries(items, 2);
    return formatted ? `${name}=${formatted}` : '';
  }).filter(Boolean);
  return entries.join(', ');
};

const formatScore = (score, scoreType, color) => {
  if (!Number.isFinite(score)) return '';
  const label = scoreType ? `${score.toFixed(2)} ${scoreType}` : score.toFixed(2);
  return color.green(label);
};

const formatExplainLine = (label, parts, color) => {
  const filtered = parts.filter(Boolean);
  if (!filtered.length) return null;
  return color.gray(`   ${label}: `) + filtered.join(', ');
};

const formatScoreBreakdown = (scoreBreakdown, color) => {
  if (!scoreBreakdown || typeof scoreBreakdown !== 'object') return [];
  const lines = [];
  const selected = scoreBreakdown.selected || null;
  if (selected) {
    const parts = [];
    if (selected.type) parts.push(`type=${selected.type}`);
    if (Number.isFinite(selected.score)) parts.push(`score=${selected.score.toFixed(4)}`);
    const line = formatExplainLine('Score', parts, color);
    if (line) lines.push(line);
  }
  const sparse = scoreBreakdown.sparse || null;
  if (sparse) {
    const parts = [];
    if (sparse.type) parts.push(`type=${sparse.type}`);
    if (Number.isFinite(sparse.score)) parts.push(`score=${sparse.score.toFixed(4)}`);
    if (Number.isFinite(sparse.k1)) parts.push(`k1=${sparse.k1.toFixed(2)}`);
    if (Number.isFinite(sparse.b)) parts.push(`b=${sparse.b.toFixed(2)}`);
    if (sparse.normalized != null) parts.push(`normalized=${sparse.normalized}`);
    if (sparse.profile) parts.push(`profile=${sparse.profile}`);
    if (Array.isArray(sparse.weights) && sparse.weights.length) {
      const weights = sparse.weights
        .map((value) => (Number.isFinite(value) ? value.toFixed(2) : String(value)))
        .join('/');
      parts.push(`weights=${weights}`);
    }
    const line = formatExplainLine('Sparse', parts, color);
    if (line) lines.push(line);
  }
  const ann = scoreBreakdown.ann || null;
  if (ann) {
    const parts = [];
    if (Number.isFinite(ann.score)) parts.push(`score=${ann.score.toFixed(4)}`);
    if (ann.source) parts.push(`source=${ann.source}`);
    const line = formatExplainLine('ANN', parts, color);
    if (line) lines.push(line);
  }
  const blend = scoreBreakdown.blend || null;
  if (blend) {
    const parts = [];
    if (Number.isFinite(blend.score)) parts.push(`score=${blend.score.toFixed(4)}`);
    if (Number.isFinite(blend.sparseNormalized)) parts.push(`sparseNorm=${blend.sparseNormalized.toFixed(4)}`);
    if (Number.isFinite(blend.annNormalized)) parts.push(`annNorm=${blend.annNormalized.toFixed(4)}`);
    if (Number.isFinite(blend.sparseWeight) || Number.isFinite(blend.annWeight)) {
      const sparseWeight = Number.isFinite(blend.sparseWeight) ? blend.sparseWeight.toFixed(2) : '0.00';
      const annWeight = Number.isFinite(blend.annWeight) ? blend.annWeight.toFixed(2) : '0.00';
      parts.push(`weights=${sparseWeight}/${annWeight}`);
    }
    const line = formatExplainLine('Blend', parts, color);
    if (line) lines.push(line);
  }
  const phrase = scoreBreakdown.phrase || null;
  if (phrase) {
    const parts = [];
    if (Number.isFinite(phrase.matches)) parts.push(`matches=${phrase.matches}`);
    if (Number.isFinite(phrase.boost)) parts.push(`boost=${phrase.boost.toFixed(4)}`);
    if (Number.isFinite(phrase.factor)) parts.push(`factor=${phrase.factor.toFixed(2)}`);
    const line = formatExplainLine('Phrase', parts, color);
    if (line) lines.push(line);
  }
  return lines;
};

/**
 * Render a full, human-readable result entry.
 * @param {object} options
 * @returns {string}
 */
export function formatFullChunk({
  chunk,
  index,
  mode,
  score,
  scoreType,
  explain = false,
  color,
  queryTokens = [],
  rx,
  matched = false,
  rootDir,
  summaryState
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  const c = color;
  let out = '';

  const line1 = [
    c.bold(c[mode === 'code' ? 'blue' : 'magenta'](`${index + 1}. ${chunk.file}`)),
    c.cyan(chunk.name || ''),
    c.yellow(chunk.kind || ''),
    formatScore(score, scoreType, c),
    c.gray(`Start/End: ${chunk.start}/${chunk.end}`),
    (chunk.startLine && chunk.endLine)
      ? c.gray(`Lines: ${chunk.startLine}-${chunk.endLine}`)
      : '',
    typeof chunk.churn === 'number' ? c.yellow(`Churn: ${chunk.churn}`) : ''
  ].filter(Boolean).join('  ');

  out += line1 + '\n';

  if (explain && chunk.scoreBreakdown) {
    const explainLines = formatScoreBreakdown(chunk.scoreBreakdown, c);
    if (explainLines.length) {
      out += explainLines.join('\n') + '\n';
    }
  }

  const headlinePart = chunk.headline ? c.bold('Headline: ') + c.underline(chunk.headline) : '';
  const lastModPart = chunk.last_modified ? c.gray('Last Modified: ') + c.bold(chunk.last_modified) : '';
  const secondLine = [headlinePart, lastModPart].filter(Boolean).join('   ');
  if (secondLine) out += '   ' + secondLine + '\n';

  if (chunk.last_author) {
    out += c.gray('   Last Author: ') + c.green(chunk.last_author) + '\n';
  }
  if (Array.isArray(chunk.chunk_authors) && chunk.chunk_authors.length) {
    const authors = chunk.chunk_authors.slice(0, 6);
    const suffix = chunk.chunk_authors.length > authors.length ? ' …' : '';
    out += c.gray('   Chunk Authors: ') + c.green(authors.join(', ') + suffix) + '\n';
  }

  if (chunk.imports?.length) {
    out += c.magenta('   Imports: ') + chunk.imports.join(', ') + '\n';
  } else if (chunk.codeRelations?.imports?.length) {
    out += c.magenta('   Imports: ') + chunk.codeRelations.imports.join(', ') + '\n';
  }

  if (chunk.exports?.length) {
    out += c.blue('   Exports: ') + chunk.exports.join(', ') + '\n';
  } else if (chunk.codeRelations?.exports?.length) {
    out += c.blue('   Exports: ') + chunk.codeRelations.exports.join(', ') + '\n';
  }

  if (chunk.codeRelations?.calls?.length) {
    out += c.yellow('   Calls: ') + chunk.codeRelations.calls.map(([a, b]) => `${a}->${b}`).join(', ') + '\n';
  }
  if (chunk.codeRelations?.callSummaries?.length) {
    const summaries = chunk.codeRelations.callSummaries.slice(0, 3).map((summary) => {
      const args = Array.isArray(summary.args) && summary.args.length ? summary.args.join(', ') : '';
      const returns = Array.isArray(summary.returnTypes) && summary.returnTypes.length
        ? ` -> ${summary.returnTypes.join(' | ')}`
        : '';
      return `${summary.name}(${args})${returns}`;
    });
    out += c.yellow('   CallSummary: ') + summaries.join(', ') + '\n';
  }

  if (chunk.importLinks?.length) {
    out += c.green('   ImportLinks: ') + chunk.importLinks.join(', ') + '\n';
  } else if (chunk.codeRelations?.importLinks?.length) {
    out += c.green('   ImportLinks: ') + chunk.codeRelations.importLinks.join(', ') + '\n';
  }

  if (chunk.usages?.length) {
    const usageFreq = Object.create(null);
    chunk.usages.forEach((raw) => {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (!trimmed) return;
      usageFreq[trimmed] = (usageFreq[trimmed] || 0) + 1;
    });

    const usageEntries = Object.entries(usageFreq).sort((a, b) => b[1] - a[1]);
    const maxCount = usageEntries[0]?.[1] || 0;

    const usageStr = usageEntries.slice(0, 10).map(([usage, count]) => {
      if (count === 1) return usage;
      if (count === maxCount) return c.bold(c.yellow(`${usage} (${count})`));
      return c.cyan(`${usage} (${count})`);
    }).join(', ');

    if (usageStr.length) out += c.cyan('   Usages: ') + usageStr + '\n';
  } else if (chunk.codeRelations?.usages?.length) {
    const usageFreq = Object.create(null);
    chunk.codeRelations.usages.forEach((raw) => {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (!trimmed) return;
      usageFreq[trimmed] = (usageFreq[trimmed] || 0) + 1;
    });

    const usageEntries = Object.entries(usageFreq).sort((a, b) => b[1] - a[1]);
    const maxCount = usageEntries[0]?.[1] || 0;

    const usageStr = usageEntries.slice(0, 10).map(([usage, count]) => {
      if (count === 1) return usage;
      if (count === maxCount) return c.bold(c.yellow(`${usage} (${count})`));
      return c.cyan(`${usage} (${count})`);
    }).join(', ');

    if (usageStr.length) out += c.cyan('   Usages: ') + usageStr + '\n';
  }

  const uniqueTokens = [...new Set((chunk.tokens || []).map((t) => t.trim()).filter((t) => t))];
  if (uniqueTokens.length) {
    out += c.magenta('   Tokens: ') + uniqueTokens.slice(0, 10).join(', ') + '\n';
  }

  if (matched && queryTokens.length) {
    const matchedTokens = queryTokens.filter((tok) =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length) {
      out += c.gray('   Matched: ') + matchedTokens.join(', ') + '\n';
    }
  }

  const recordMeta = chunk.docmeta?.record || null;
  if (recordMeta) {
    const recordParts = [];
    if (recordMeta.recordType) recordParts.push(`type=${recordMeta.recordType}`);
    if (recordMeta.severity) recordParts.push(`severity=${recordMeta.severity}`);
    if (recordMeta.status) recordParts.push(`status=${recordMeta.status}`);
    const vulnId = recordMeta.vulnId || recordMeta.cve;
    if (vulnId) recordParts.push(`vuln=${vulnId}`);
    if (recordMeta.packageName) recordParts.push(`package=${recordMeta.packageName}`);
    if (recordMeta.packageEcosystem) recordParts.push(`ecosystem=${recordMeta.packageEcosystem}`);
    if (recordParts.length) {
      out += c.yellow('   Record: ') + recordParts.join(', ') + '\n';
    }
    const routeParts = [];
    if (recordMeta.service) routeParts.push(`service=${recordMeta.service}`);
    if (recordMeta.env) routeParts.push(`env=${recordMeta.env}`);
    if (recordMeta.team) routeParts.push(`team=${recordMeta.team}`);
    if (recordMeta.owner) routeParts.push(`owner=${recordMeta.owner}`);
    if (recordMeta.assetId) routeParts.push(`asset=${recordMeta.assetId}`);
    if (routeParts.length) {
      out += c.gray('   Route: ') + routeParts.join(', ') + '\n';
    }
    if (chunk.docmeta?.doc) {
      out += c.gray('   Summary: ') + chunk.docmeta.doc + '\n';
    }
  }

  if (chunk.docmeta?.signature) {
    out += c.cyan('   Signature: ') + chunk.docmeta.signature + '\n';
  }
  const modifiers = chunk.docmeta?.modifiers || null;
  const modifierParts = [];
  if (chunk.docmeta?.async || modifiers?.async) modifierParts.push('async');
  if (modifiers?.generator || chunk.docmeta?.yields) modifierParts.push('generator');
  if (modifiers?.static) modifierParts.push('static');
  const visibility = chunk.docmeta?.visibility || modifiers?.visibility || null;
  if (visibility) modifierParts.push(`visibility=${visibility}`);
  if (chunk.docmeta?.methodKind) modifierParts.push(`kind=${chunk.docmeta.methodKind}`);
  if (modifierParts.length) {
    out += c.gray('   Modifiers: ') + modifierParts.join(', ') + '\n';
  }
  if (chunk.docmeta?.decorators?.length) {
    out += c.magenta('   Decorators: ') + chunk.docmeta.decorators.join(', ') + '\n';
  }
  const bases = chunk.docmeta?.extends || chunk.docmeta?.bases || [];
  if (Array.isArray(bases) && bases.length) {
    out += c.magenta('   Extends: ') + bases.join(', ') + '\n';
  }
  if (chunk.docmeta?.returnType) {
    out += c.cyan('   Return Type: ') + chunk.docmeta.returnType + '\n';
  } else if (chunk.docmeta?.returnsValue) {
    out += c.cyan('   Returns: ') + 'value' + '\n';
  }
  const inferredTypes = chunk.docmeta?.inferredTypes || null;
  if (inferredTypes) {
    const inferredParams = formatInferredMap(inferredTypes.params);
    if (inferredParams) {
      out += c.gray('   Inferred Params: ') + inferredParams + '\n';
    }
    const inferredReturns = formatInferredEntries(inferredTypes.returns, 2);
    if (inferredReturns) {
      out += c.gray('   Inferred Returns: ') + inferredReturns + '\n';
    }
    const inferredFields = formatInferredMap(inferredTypes.fields);
    if (inferredFields) {
      out += c.gray('   Inferred Fields: ') + inferredFields + '\n';
    }
    const inferredLocals = formatInferredMap(inferredTypes.locals);
    if (inferredLocals) {
      out += c.gray('   Inferred Locals: ') + inferredLocals + '\n';
    }
  }
  if (chunk.docmeta?.throws?.length) {
    out += c.red('   Throws: ') + chunk.docmeta.throws.slice(0, 6).join(', ') + '\n';
  }
  if (chunk.docmeta?.awaits?.length) {
    out += c.blue('   Awaits: ') + chunk.docmeta.awaits.slice(0, 6).join(', ') + '\n';
  }
  if (chunk.docmeta?.yields) {
    out += c.blue('   Yields: ') + 'yes' + '\n';
  }
  const dataflow = chunk.docmeta?.dataflow || null;
  if (dataflow) {
    if (dataflow.reads?.length) {
      out += c.gray('   Reads: ') + dataflow.reads.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.writes?.length) {
      out += c.gray('   Writes: ') + dataflow.writes.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.mutations?.length) {
      out += c.gray('   Mutates: ') + dataflow.mutations.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.aliases?.length) {
      out += c.gray('   Aliases: ') + dataflow.aliases.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.globals?.length) {
      out += c.gray('   Globals: ') + dataflow.globals.slice(0, 6).join(', ') + '\n';
    }
    if (dataflow.nonlocals?.length) {
      out += c.gray('   Nonlocals: ') + dataflow.nonlocals.slice(0, 6).join(', ') + '\n';
    }
  }
  const risk = chunk.docmeta?.risk || null;
  if (risk) {
    if (risk.severity) {
      out += c.red(`   RiskLevel: ${risk.severity}`) + '\n';
    }
    if (risk.tags?.length) {
      out += c.red('   RiskTags: ') + risk.tags.slice(0, 6).join(', ') + '\n';
    }
    if (risk.flows?.length) {
      const flowList = risk.flows.slice(0, 3).map((flow) =>
        `${flow.source}->${flow.sink} (${flow.category})`
      );
      out += c.red('   RiskFlows: ') + flowList.join(', ') + '\n';
    }
  }
  const controlFlow = chunk.docmeta?.controlFlow || null;
  if (controlFlow) {
    const entries = [
      ['branches', controlFlow.branches],
      ['loops', controlFlow.loops],
      ['returns', controlFlow.returns],
      ['breaks', controlFlow.breaks],
      ['continues', controlFlow.continues],
      ['throws', controlFlow.throws],
      ['awaits', controlFlow.awaits],
      ['yields', controlFlow.yields]
    ].filter(([, value]) => Number.isFinite(value) && value > 0);
    if (entries.length) {
      out += c.gray('   Control: ') + entries.map(([key, value]) => `${key}=${value}`).join(', ') + '\n';
    }
  }

  if (chunk.lint?.length) {
    out += c.red(`   Lint: ${chunk.lint.length} issues`) +
      (chunk.lint.length ? c.gray(' | ') + chunk.lint.slice(0, 2).map((lintMsg) => JSON.stringify(lintMsg.message)).join(', ') : '') + '\n';
  }

  if (chunk.externalDocs?.length) {
    out += c.blue('   Docs: ') + chunk.externalDocs.join(', ') + '\n';
  }

  const cleanedPreContext = chunk.preContext ? cleanContext(chunk.preContext) : [];
  if (cleanedPreContext.length) {
    out += c.gray('   preContext: ') + cleanedPreContext.map((line) => c.green(line.trim())).join(' | ') + '\n';
  }

  const cleanedPostContext = chunk.postContext ? cleanContext(chunk.postContext) : [];
  if (cleanedPostContext.length) {
    out += c.gray('   postContext: ') + cleanedPostContext.map((line) => c.green(line.trim())).join(' | ') + '\n';
  }

  if (summaryState && rootDir && !chunk.docmeta?.record) {
    if (index === 0) summaryState.lastCount = 0;
    if (index < 5) {
      let maxWords = 10;
      const lessPer = 3;
      maxWords -= (lessPer * index);
      const bodySummary = getBodySummary(rootDir, chunk, maxWords);
      if (summaryState.lastCount < maxWords) {
        maxWords = bodySummary.length;
      }
      summaryState.lastCount = bodySummary.length;
      out += c.gray('   Summary: ') + `${getBodySummary(rootDir, chunk, maxWords)}` + '\n';
    }
  }

  out += c.gray(''.padEnd(60, '-')) + '\n';
  return out;
}

/**
 * Render a compact, single-line result entry.
 * @param {object} options
 * @returns {string}
 */
export function formatShortChunk({
  chunk,
  index,
  mode,
  score,
  scoreType,
  explain = false,
  color,
  queryTokens = [],
  rx,
  matched = false
}) {
  if (!chunk || !chunk.file) {
    return color.red(`   ${index + 1}. [Invalid result - missing chunk or file]`) + '\n';
  }
  let out = '';
  out += `${color.bold(color[mode === 'code' ? 'blue' : 'magenta'](`${index + 1}. ${chunk.file}`))}`;
  const scoreLabel = Number.isFinite(score)
    ? `[${scoreType ? `${score.toFixed(2)} ${scoreType}` : score.toFixed(2)}]`
    : '';
  if (scoreLabel) {
    out += color.yellow(` ${scoreLabel}`);
  }
  if (chunk.name) out += ' ' + color.cyan(chunk.name);
  out += color.gray(` (${chunk.kind || 'unknown'})`);
  const recordMeta = chunk.docmeta?.record || null;
  if (recordMeta) {
    const recordBits = [];
    if (recordMeta.severity) recordBits.push(recordMeta.severity);
    if (recordMeta.status) recordBits.push(recordMeta.status);
    const vulnId = recordMeta.vulnId || recordMeta.cve;
    if (vulnId) recordBits.push(vulnId);
    if (recordMeta.packageName) recordBits.push(recordMeta.packageName);
    if (recordBits.length) {
      out += color.yellow(` [${recordBits.join(' | ')}]`);
    }
  }
  if (chunk.last_author) out += color.green(` by ${chunk.last_author}`);
  if (chunk.headline) out += ` - ${color.underline(chunk.headline)}`;
  else if (chunk.tokens && chunk.tokens.length && rx) {
    out += ' - ' + chunk.tokens.slice(0, 10).join(' ').replace(rx, (m) => color.bold(color.yellow(m)));
  }

  if (matched && queryTokens.length) {
    const matchedTokens = queryTokens.filter((tok) =>
      (chunk.tokens && chunk.tokens.includes(tok)) ||
      (chunk.ngrams && chunk.ngrams.includes(tok)) ||
      (chunk.headline && chunk.headline.includes(tok))
    );
    if (matchedTokens.length) {
      out += color.gray(` Matched: ${matchedTokens.join(', ')}`);
    }
  }

  if (explain && chunk.scoreBreakdown) {
    const explainLines = formatScoreBreakdown(chunk.scoreBreakdown, color);
    if (explainLines.length) {
      out += '\n' + explainLines.join('\n');
    }
  }

  out += '\n';
  return out;
}
