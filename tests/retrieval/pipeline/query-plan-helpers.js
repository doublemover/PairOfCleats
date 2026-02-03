import { buildQueryPlan } from '../../../src/retrieval/cli/query-plan.js';
import {
  buildQueryPlanCacheKey,
  buildQueryPlanConfigSignature,
  buildQueryPlanIndexSignature
} from '../../../src/retrieval/query-plan-cache.js';

export function createPlanInputs(overrides = {}) {
  const query = overrides.query ?? 'alpha beta';
  const argv = {
    lint: false,
    calls: null,
    uses: null,
    signature: null,
    param: null,
    decorator: null,
    'inferred-type': null,
    'return-type': null,
    throws: null,
    reads: null,
    writes: null,
    mutates: null,
    alias: null,
    risk: null,
    'risk-tag': null,
    'risk-source': null,
    'risk-sink': null,
    'risk-category': null,
    'risk-flow': null,
    'struct-pack': null,
    'struct-rule': null,
    'struct-tag': null,
    awaits: null,
    visibility: null,
    extends: null,
    async: false,
    generator: false,
    returns: false
  };
  const dict = overrides.dict ?? new Set(['alpha', 'beta', 'gamma']);
  const dictConfig = overrides.dictConfig ?? { caseSensitive: false };
  const postingsConfig = overrides.postingsConfig ?? {
    enablePhraseNgrams: true,
    phraseMinN: 2,
    phraseMaxN: 3,
    chargramMinN: 3
  };
  const inputs = {
    query,
    argv,
    dict,
    dictConfig,
    postingsConfig,
    caseTokens: false,
    fileFilter: null,
    caseFile: false,
    searchRegexConfig: null,
    filePrefilterEnabled: true,
    fileChargramN: postingsConfig.chargramMinN,
    searchType: null,
    searchAuthor: null,
    searchImport: null,
    chunkAuthorFilter: null,
    branchesMin: null,
    loopsMin: null,
    breaksMin: null,
    continuesMin: null,
    churnMin: null,
    extFilter: null,
    langFilter: null,
    extImpossible: null,
    langImpossible: null,
    metaFilters: null,
    modifiedAfter: null,
    modifiedSinceDays: null,
    fieldWeightsConfig: null,
    denseVectorMode: 'merged',
    branchFilter: null
  };
  return { ...inputs, ...overrides };
}

export function buildPlanConfigSignature(inputs) {
  return buildQueryPlanConfigSignature({
    dictConfig: inputs.dictConfig,
    dictSize: inputs.dict?.size ?? null,
    postingsConfig: inputs.postingsConfig,
    caseTokens: inputs.caseTokens,
    fileFilter: inputs.fileFilter,
    caseFile: inputs.caseFile,
    searchRegexConfig: inputs.searchRegexConfig,
    filePrefilterEnabled: inputs.filePrefilterEnabled,
    fileChargramN: inputs.fileChargramN,
    searchType: inputs.searchType,
    searchAuthor: inputs.searchAuthor,
    searchImport: inputs.searchImport,
    chunkAuthorFilter: inputs.chunkAuthorFilter,
    branchesMin: inputs.branchesMin,
    loopsMin: inputs.loopsMin,
    breaksMin: inputs.breaksMin,
    continuesMin: inputs.continuesMin,
    churnMin: inputs.churnMin,
    extFilter: inputs.extFilter,
    langFilter: inputs.langFilter,
    extImpossible: inputs.extImpossible,
    langImpossible: inputs.langImpossible,
    metaFilters: inputs.metaFilters,
    modifiedAfter: inputs.modifiedAfter,
    modifiedSinceDays: inputs.modifiedSinceDays,
    fieldWeightsConfig: inputs.fieldWeightsConfig,
    denseVectorMode: inputs.denseVectorMode,
    branchFilter: inputs.branchFilter
  });
}

export function buildPlanIndexSignature(value = null) {
  const signature = value ?? { backend: 'memory', code: 'sig' };
  return buildQueryPlanIndexSignature(signature);
}

export function buildPlanCacheKey({ query, configSignature, indexSignature }) {
  return buildQueryPlanCacheKey({
    query,
    configSignature,
    indexSignature
  });
}

export function buildTestPlan(inputs) {
  return buildQueryPlan({
    query: inputs.query,
    argv: inputs.argv,
    dict: inputs.dict,
    dictConfig: inputs.dictConfig,
    postingsConfig: inputs.postingsConfig,
    caseTokens: inputs.caseTokens,
    fileFilter: inputs.fileFilter,
    caseFile: inputs.caseFile,
    searchRegexConfig: inputs.searchRegexConfig,
    filePrefilterEnabled: inputs.filePrefilterEnabled,
    fileChargramN: inputs.fileChargramN,
    searchType: inputs.searchType,
    searchAuthor: inputs.searchAuthor,
    searchImport: inputs.searchImport,
    chunkAuthorFilter: inputs.chunkAuthorFilter,
    branchesMin: inputs.branchesMin,
    loopsMin: inputs.loopsMin,
    breaksMin: inputs.breaksMin,
    continuesMin: inputs.continuesMin,
    churnMin: inputs.churnMin,
    extFilter: inputs.extFilter,
    langFilter: inputs.langFilter,
    extImpossible: inputs.extImpossible,
    langImpossible: inputs.langImpossible,
    metaFilters: inputs.metaFilters,
    modifiedAfter: inputs.modifiedAfter,
    modifiedSinceDays: inputs.modifiedSinceDays,
    fieldWeightsConfig: inputs.fieldWeightsConfig,
    denseVectorMode: inputs.denseVectorMode,
    branchFilter: inputs.branchFilter
  });
}
