import assert from 'node:assert/strict';
import { buildQueryPlan } from '../../../src/retrieval/cli/query-plan.js';
import { applyQueryMatchPolicy } from '../../../src/retrieval/cli/search-controls.js';
import { annotateQueryAst, buildPhraseNgrams, createQueryLeafAnalysis, parseQueryWithFallback,
  tokenizePhrase, tokenizeQueryTerms } from '../../../src/retrieval/query-parse.js';
import { hydrateQueryPlan, serializeQueryPlan } from '../../../src/retrieval/query-plan-cache.js';
import { normalizePostingsConfig } from '../../../src/shared/postings-config.js';

// UNVALIDATED: compare the actual planner with its original tokenizer call
// sequence; no fixture drops aggregate language/profile or custom-hook calls.
const project = (query, dict, options, postings = {}, match = 'auto', analysis = null) => {
  const parsed = parseQueryWithFallback(query).parsed;
  const queryAst = applyQueryMatchPolicy(annotateQueryAst(parsed.ast, dict, options, postings, analysis), match);
  const terms = raw => analysis ? analysis.tokenizeTerms(raw) : tokenizeQueryTerms(raw, dict, options);
  const phrase = raw => analysis ? analysis.tokenizePhrase(raw) : tokenizePhrase(raw, dict, options);
  const includeTokens = terms(parsed.includeTerms);
  const phraseTokens = parsed.phrases.map(phrase).filter(tokens => tokens.length);
  const phraseInfo = buildPhraseNgrams(phraseTokens, postings);
  const excludeTokens = terms(parsed.excludeTerms);
  const excluded = parsed.excludePhrases.map(phrase).filter(tokens => tokens.length);
  const excludedInfo = buildPhraseNgrams(excluded, postings);
  const scoring = analysis ? analysis.tokenizeScoringTerms(parsed.phrases)
    : tokenizeQueryTerms(parsed.phrases, dict, { ...options, caseSensitive: false });
  return { parsedQuery: parsed, queryAst, includeTokens, phraseTokens, phraseNgrams: phraseInfo.ngrams,
    phraseNgramSet: phraseInfo.ngrams.length ? new Set(phraseInfo.ngrams) : null,
    phraseRange: { min: phraseInfo.minLen, max: phraseInfo.maxLen }, excludeTokens,
    excludePhraseNgrams: excludedInfo.ngrams,
    excludePhraseRange: excludedInfo.minLen && excludedInfo.maxLen ? { min: excludedInfo.minLen, max: excludedInfo.maxLen } : null,
    queryTokens: [...includeTokens, ...scoring] };
};
const projectFields = (actual, expected) => Object.fromEntries(Object.keys(expected).map(key => [key, actual[key]]));
const cases = [
  ['alpha AND (beta OR NOT gamma) "alpha beta" -"gamma delta"', {}],
  ['alpha alpha OR (beta AND NOT beta)', {}],
  ['"unterminated alpha beta', {}],
  ['東京検索 OR alpha "東京 検索" -"大阪 検索"', {}],
  ['running walked runners "running walked"', { stemming: 'auto', language: 'en' }],
  ['AlphaBeta alphaBeta "Alpha BETA"', { caseSensitive: true }],
  ['alphabeta delta "alpha beta"', { dpMaxTokenLength: 24 }]
];
for (const [query, supplied] of cases) for (const match of ['auto', 'all', 'any']) {
  const dict = new Set(['alpha', 'beta', 'gamma', 'delta', 'running', 'walked', 'runners']);
  const options = { ...supplied, caseSensitive: supplied.caseSensitive === true };
  const postings = { enablePhraseNgrams: true, phraseMinN: 2, phraseMaxN: 3 };
  const baseline = project(query, dict, options, postings, match);
  const leaf = createQueryLeafAnalysis(dict, options);
  assert.equal(leaf.snapshotWork().reusableDefaultCore, true);
  assert.deepEqual(project(query, dict, options, postings, match, leaf), baseline);
  const actual = buildQueryPlan({ query, argv: { match }, dict, dictConfig: supplied,
    caseTokens: options.caseSensitive, postingsConfig: postings });
  assert.deepEqual(projectFields(actual, baseline), baseline);
  const serialized = JSON.stringify(serializeQueryPlan(actual));
  assert.equal(serialized, JSON.stringify(serializeQueryPlan({ ...actual, ...baseline })));
  const restored = hydrateQueryPlan(JSON.parse(serialized));
  assert.deepEqual(restored.queryTokens, actual.queryTokens);
  assert.deepEqual(restored.cacheFilters, actual.cacheFilters);
  assert.equal(restored.highlightRegex.source, actual.highlightRegex.source);
  assert.equal(Object.hasOwn(actual, 'leafAnalysis'), false);
  assert.equal(Object.hasOwn(actual, 'snapshotWork'), false);
}

const words = Array.from({ length: 24 }, (_, index) => 'evidence' + String.fromCharCode(97 + index));
const countedDict = new Set(words), counted = createQueryLeafAnalysis(countedDict, {});
project(`${words.join(' ')} "positive phrase" -"negative phrase"`, countedDict, {},
  { enablePhraseNgrams: false }, 'auto', counted);
assert.deepEqual(counted.snapshotWork(), { reusableDefaultCore: true, termCoreAnalyses: 25, phraseCoreAnalyses: 2 });
const first = counted.tokenizeTerms([words[0]]); first.push('caller mutation');
assert.equal(counted.tokenizeTerms([words[0]]).includes('caller mutation'), false);
const firstPhrase = counted.tokenizePhrase('positive phrase'); firstPhrase.length = 0;
assert.ok(counted.tokenizePhrase('positive phrase').length > 0);
assert.deepEqual(counted.snapshotWork(), { reusableDefaultCore: true, termCoreAnalyses: 25, phraseCoreAnalyses: 2 });
const fresh = createQueryLeafAnalysis(new Set(words), {});
fresh.tokenizeTerms([words[0]]); assert.equal(fresh.snapshotWork().termCoreAnalyses, 1, 'no cache crosses plan/dictionary ownership');

const hooked = (useAnalysis, hookName) => {
  const calls = [], dict = new Set(['alpha', 'beta']); let sequence = 0;
  const hook = (token, context) => { calls.push({ token, kind: context.kind, rawTerms: [...context.rawTerms], profile: { ...context.profile } });
    return `${token}_${++sequence}`; };
  const options = hookName === 'tokenHooks' ? { tokenHooks: { expandToken: hook } } : { [hookName]: hook };
  const analysis = useAnalysis ? createQueryLeafAnalysis(dict, options) : null;
  if (analysis) assert.equal(analysis.snapshotWork().reusableDefaultCore, false);
  const output = project('alpha OR beta "alpha beta" -"beta alpha"', dict, options, {}, 'auto', analysis);
  return { output, calls };
};
for (const hook of ['tokenHook', 'expandToken', 'languageTokenHook', 'tokenHooks']) {
  assert.deepEqual(hooked(true, hook), hooked(false, hook), 'stateful hook call order, aggregate rawTerms and profiles are unchanged');
}
const dictionaryControl = useAnalysis => {
  let calls = 0;
  const dict = new Set(), originalHas = dict.has;
  dict.has = function (value) { calls++; return originalHas.call(this, value); };
  const analysis = useAnalysis ? createQueryLeafAnalysis(dict, {}) : null;
  if (analysis) assert.equal(analysis.snapshotWork().reusableDefaultCore, false);
  return { output: project('alphabet beta "alphabet beta"', dict, {}, {}, 'auto', analysis), get calls() { return calls; } };
};
const baselineDictionary = dictionaryControl(false), ownedDictionary = dictionaryControl(true);
assert.deepEqual(ownedDictionary.output, baselineDictionary.output); assert.equal(ownedDictionary.calls, baselineDictionary.calls);
let customHasReads = 0;
const getterDictionary = new Set(); Object.defineProperty(getterDictionary, 'has', { get() { customHasReads++; return Set.prototype.has; } });
assert.equal(createQueryLeafAnalysis(getterDictionary, {}).snapshotWork().reusableDefaultCore, false);
assert.equal(customHasReads, 0, 'eligibility cannot inspect a custom dictionary callback getter');
const ordinaryConfig = { languages: ['en'], files: [], slangDirs: [], slangFiles: [],
  segmentation: 'auto', dpMaxTokenLength: 32, dpMaxTokenLengthByFileCount: [{ minFiles: 1000, dpMaxTokenLength: 16 }] };
const ordinaryDict = new Set(['alpha', 'beta']); ordinaryDict.__maxTokenLength = 5;
const ordinaryPostings = normalizePostingsConfig({});
const ordinaryAnalysis = createQueryLeafAnalysis(ordinaryDict, ordinaryConfig, { postingsConfig: ordinaryPostings });
assert.equal(ordinaryAnalysis.snapshotWork().reusableDefaultCore, true, 'ordinary language/inventory arrays and normalized postings retain the actual default path');
assert.deepEqual(project('alpha beta "alpha beta"', ordinaryDict, ordinaryConfig, ordinaryPostings, 'auto', ordinaryAnalysis),
  project('alpha beta "alpha beta"', ordinaryDict, ordinaryConfig, ordinaryPostings));
const ordinaryExpected = project('alpha beta "alpha beta"', ordinaryDict, ordinaryConfig, ordinaryPostings);
const ordinaryPlan = buildQueryPlan({ query: 'alpha beta "alpha beta"', argv: {}, dict: ordinaryDict,
  dictConfig: ordinaryConfig, postingsConfig: ordinaryPostings });
assert.deepEqual(projectFields(ordinaryPlan, ordinaryExpected), ordinaryExpected);
assert.equal(createQueryLeafAnalysis(new Set(), { languages: [{ toString() { return 'en'; } }] }).snapshotWork().reusableDefaultCore, false);
const variant = new Set(); variant.queryDictionaries = [new Set(['alpha']), new Set(['beta'])];
const variantAnalysis = createQueryLeafAnalysis(variant, {});
assert.equal(variantAnalysis.snapshotWork().reusableDefaultCore, false);
assert.deepEqual(project('alphabeta "alpha beta"', variant, {}, {}, 'auto', variantAnalysis), project('alphabeta "alpha beta"', variant, {}));
const ngramCallbackControl = useAnalysis => {
  const dict = new Set(['alphabeta']); let callbacks = 0;
  const postings = { get enablePhraseNgrams() { callbacks++; dict.delete('alphabeta'); dict.add('alpha'); dict.add('beta'); return false; } };
  const analysis = useAnalysis ? createQueryLeafAnalysis(dict, {}, { postingsConfig: postings }) : null;
  if (analysis) assert.equal(analysis.snapshotWork().reusableDefaultCore, false);
  return { output: project('alphabeta "alpha beta"', dict, {}, postings, 'auto', analysis), callbacks };
};
assert.deepEqual(ngramCallbackControl(true), ngramCallbackControl(false), 'interleaved ngram getters cannot change dictionary state beneath cached leaves');
assert.equal(createQueryLeafAnalysis(new Set(), {}, { queryMatch: { toString() { assert.fail('eligibility must not coerce match values'); } } })
  .snapshotWork().reusableDefaultCore, false);
console.log('Cold query leaf/core reuse and unchanged aggregate/custom semantics authored; execution deferred.');
