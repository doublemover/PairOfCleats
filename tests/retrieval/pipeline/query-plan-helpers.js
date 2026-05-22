import { buildQueryPlan } from '../../../src/retrieval/cli/query-plan.js';
import {
  buildQueryPlanCacheKey,
  buildQueryPlanConfigSignature,
  buildQueryPlanIndexSignature
} from '../../../src/retrieval/query-plan-cache.js';

const createDefaultPlanConfigInputs = ({ dictConfig, postingsConfig }) => ({
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
});

const PLAN_CONFIG_KEYS = Object.keys(createDefaultPlanConfigInputs({
  dictConfig: null,
  postingsConfig: { chargramMinN: null }
}));

const projectPlanConfigInputs = (inputs) => {
  const projected = {};
  for (const key of PLAN_CONFIG_KEYS) {
    projected[key] = inputs[key];
  }
  projected.dictSize = inputs.dict?.size ?? null;
  return projected;
};

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
    ...createDefaultPlanConfigInputs({ dictConfig, postingsConfig })
  };
  return { ...inputs, ...overrides };
}

export function buildPlanConfigSignature(inputs) {
  return buildQueryPlanConfigSignature(projectPlanConfigInputs(inputs));
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
    ...projectPlanConfigInputs(inputs)
  });
}
