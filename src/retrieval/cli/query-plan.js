import { hasActiveFilters } from '../filters.js';
import { buildHighlightRegex } from './highlight.js';
import {
  buildPhraseNgrams,
  annotateQueryAst,
  parseQueryInput,
  tokenizePhrase,
  tokenizeQueryTerms
} from '../query-parse.js';
import {
  classifyQuery,
  resolveIntentFieldWeights,
  resolveIntentVectorMode
} from '../query-intent.js';

export function buildQueryPlan({
  query,
  argv,
  dict,
  dictConfig,
  postingsConfig,
  caseTokens,
  fileFilter,
  caseFile,
  searchRegexConfig,
  filePrefilterEnabled,
  fileChargramN,
  searchType,
  searchAuthor,
  searchImport,
  chunkAuthorFilter,
  branchesMin,
  loopsMin,
  breaksMin,
  continuesMin,
  churnMin,
  extFilter,
  metaFilters,
  modifiedAfter,
  modifiedSinceDays,
  fieldWeightsConfig,
  denseVectorMode,
  branchFilter
}) {
  const parsedQuery = parseQueryInput(query);
  const queryAst = annotateQueryAst(parsedQuery.ast, dict, { ...dictConfig, caseSensitive: caseTokens }, postingsConfig);
  const includeTokens = tokenizeQueryTerms(parsedQuery.includeTerms, dict, { ...dictConfig, caseSensitive: caseTokens });
  const phraseTokens = parsedQuery.phrases
    .map((phrase) => tokenizePhrase(phrase, dict, { ...dictConfig, caseSensitive: caseTokens }))
    .filter((tokens) => tokens.length);
  const phraseInfo = buildPhraseNgrams(phraseTokens, postingsConfig);
  const phraseNgrams = phraseInfo.ngrams;
  const phraseNgramSet = phraseNgrams.length ? new Set(phraseNgrams) : null;
  const phraseRange = { min: phraseInfo.minLen, max: phraseInfo.maxLen };
  const excludeTokens = tokenizeQueryTerms(parsedQuery.excludeTerms, dict, { ...dictConfig, caseSensitive: caseTokens });
  const excludePhraseTokens = parsedQuery.excludePhrases
    .map((phrase) => tokenizePhrase(phrase, dict, { ...dictConfig, caseSensitive: caseTokens }))
    .filter((tokens) => tokens.length);
  const excludePhraseInfo = buildPhraseNgrams(excludePhraseTokens, postingsConfig);
  const excludePhraseNgrams = excludePhraseInfo.ngrams;
  const excludePhraseRange = excludePhraseInfo.minLen && excludePhraseInfo.maxLen
    ? { min: excludePhraseInfo.minLen, max: excludePhraseInfo.maxLen }
    : null;
  const queryTokens = [...includeTokens, ...phraseTokens.flat()];
  const rx = buildHighlightRegex(queryTokens);
  const embeddingQueryText = [...parsedQuery.includeTerms, ...parsedQuery.phrases]
    .join(' ')
    .trim() || query;
  const intentInfo = classifyQuery({
    query,
    tokens: queryTokens,
    phrases: parsedQuery.phrases,
    filters: { file: fileFilter }
  });
  const fieldWeights = resolveIntentFieldWeights(fieldWeightsConfig, intentInfo);
  const resolvedDenseVectorMode = resolveIntentVectorMode(denseVectorMode, intentInfo);

  const filters = {
    type: searchType,
    author: searchAuthor,
    importName: searchImport,
    lint: argv.lint,
    churn: churnMin,
    calls: argv.calls,
    uses: argv.uses,
    signature: argv.signature,
    param: argv.param,
    decorator: argv.decorator,
    inferredType: argv['inferred-type'],
    returnType: argv['return-type'],
    throws: argv.throws,
    reads: argv.reads,
    writes: argv.writes,
    mutates: argv.mutates,
    alias: argv.alias,
    risk: argv.risk,
    riskTag: argv['risk-tag'],
    riskSource: argv['risk-source'],
    riskSink: argv['risk-sink'],
    riskCategory: argv['risk-category'],
    riskFlow: argv['risk-flow'],
    structPack: argv['struct-pack'],
    structRule: argv['struct-rule'],
    structTag: argv['struct-tag'],
    awaits: argv.awaits,
    branches: branchesMin,
    loops: loopsMin,
    breaks: breaksMin,
    continues: continuesMin,
    visibility: argv.visibility,
    extends: argv.extends,
    async: argv.async,
    generator: argv.generator,
    returns: argv.returns,
    file: fileFilter,
    caseFile,
    caseTokens,
    regexConfig: fileFilter ? searchRegexConfig : null,
    filePrefilter: {
      enabled: filePrefilterEnabled,
      chargramN: fileChargramN
    },
    ext: extFilter,
    meta: metaFilters,
    chunkAuthor: chunkAuthorFilter,
    modifiedAfter,
    excludeTokens,
    excludePhrases: excludePhraseNgrams,
    excludePhraseRange
  };
  const filtersActive = hasActiveFilters(filters);

  const cacheFilters = {
    type: searchType,
    author: searchAuthor,
    calls: argv.calls || null,
    uses: argv.uses || null,
    signature: argv.signature || null,
    param: argv.param || null,
    import: searchImport,
    lint: argv.lint || false,
    churn: churnMin,
    decorator: argv.decorator || null,
    inferredType: argv['inferred-type'] || null,
    returnType: argv['return-type'] || null,
    throws: argv.throws || null,
    reads: argv.reads || null,
    writes: argv.writes || null,
    mutates: argv.mutates || null,
    risk: argv.risk || null,
    riskTag: argv['risk-tag'] || null,
    riskSource: argv['risk-source'] || null,
    riskSink: argv['risk-sink'] || null,
    riskCategory: argv['risk-category'] || null,
    riskFlow: argv['risk-flow'] || null,
    structPack: argv['struct-pack'] || null,
    structRule: argv['struct-rule'] || null,
    structTag: argv['struct-tag'] || null,
    awaits: argv.awaits || null,
    visibility: argv.visibility || null,
    extends: argv.extends || null,
    async: argv.async || false,
    generator: argv.generator || false,
    returns: argv.returns || false,
    file: fileFilter || null,
    ext: extFilter || null,
    branch: branchFilter || null,
    caseFile,
    caseTokens,
    regexConfig: fileFilter ? searchRegexConfig : null,
    meta: metaFilters,
    chunkAuthor: chunkAuthorFilter || null,
    modifiedAfter,
    modifiedSinceDays
  };

  return {
    parsedQuery,
    queryAst,
    includeTokens,
    phraseTokens,
    phraseNgrams,
    phraseNgramSet,
    phraseRange,
    excludeTokens,
    excludePhraseNgrams,
    excludePhraseRange,
    queryTokens,
    highlightRegex: rx,
    embeddingQueryText,
    intentInfo,
    fieldWeights,
    resolvedDenseVectorMode,
    filters,
    filtersActive,
    cacheFilters
  };
}
