import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stableStringify } from '../../shared/stable-json.js';
import { throwIfAborted } from '../../shared/abort.js';
import { fuseRankedHits } from '../pipeline/fusion.js';
import { runRankStage } from '../pipeline/rank-stage.js';
import { createTopKReducer } from '../pipeline/topk.js';
import { applyGraphRanking } from '../pipeline/graph-ranking.js';
import { calibrateAnnScore } from '../../shared/ann-similarity.js';
import { admitVectorEvaluationRecord, evaluateVectorOracles } from './vector-oracle.js';
import { FUSION_REPLAY_VERSION } from '../../contracts/schemas/fusion-replay.js';
import { validateFusionReplayRecord } from '../../contracts/validators/fusion-replay.js';

export { FUSION_REPLAY_VERSION };
const MAX_BYTES = 8 * 1024 * 1024, MAX_CANDIDATES = 4096;
const fail = message => Object.assign(new Error(message), { code: 'ERR_FUSION_REPLAY' });
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const pool = () => ({ candidate: {}, score: {} });
const rankOptionNames = ['searchTopN', 'topkSlack', 'symbolBoostEnabled', 'symbolBoostDefinitionWeight',
  'symbolBoostExportWeight', 'relationBoostEnabled', 'relationBoostConfig', 'queryTokens', 'query',
  'graphRankingConfig', 'sqliteFtsNormalize', 'sqliteFtsWeights', 'sqliteFtsProfile', 'sqliteFtsCompilation',
  'sqliteFtsExecution', 'sqliteFtsUnavailable', 'profileId', 'fieldWeightsEnabled', 'bm25K1', 'bm25B',
  'sqliteFtsDesiredForMode', 'annCandidatePolicy', 'blendEnabled'];
const fusionOptionNames = ['sparseType', 'annSource', 'rrfEnabled', 'rrfK', 'blendEnabled',
  'blendSparseWeight', 'blendAnnWeight', 'fieldWeightsEnabled'];
const candidateFields = new Set(['mode', 'sparseDepth', 'denseDepth', 'rrfK', 'sparseWeight', 'denseWeight', 'boosts', 'diversity']);

/** Replays are plain bounded data, never executable callbacks, mutable index
 * handles, native bitmaps or accidental JSON projections of Map/typed objects. */
const snapshot = input => {
  let bytes = 0, objects = 0;
  const active = new WeakSet(), stack = [{ value: input, depth: 0 }];
  while (stack.length) {
    const { value, depth, end } = stack.pop();
    if (end) { active.delete(value); continue; }
    if (depth > 64) throw fail('Replay data nesting exceeded64 levels.');
    if (value === null || typeof value === 'boolean') bytes += 8;
    else if (typeof value === 'number') { if (!Number.isFinite(value)) throw fail('Replay contains a nonfinite number.'); bytes += 24; }
    else if (typeof value === 'string') bytes += value.length * 3 + 8;
    else if (typeof value === 'object') {
      if (active.has(value) || ++objects > 100000 || !Array.isArray(value)
        && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fail('Replay requires bounded acyclic plain data.');
      active.add(value); stack.push({ value, end: true });
      const keys = Object.keys(value);
      if (keys.length > 100000 || stack.length + keys.length > 100000) throw fail('Replay contains too many data members.');
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fail('Replay cannot execute data accessors.');
        bytes += key.length * 3 + 8; stack.push({ value: descriptor.value, depth: depth + 1 });
      }
    } else throw fail('Replay cannot serialize executable or missing data.');
    if (bytes > MAX_BYTES) throw fail('Replay exceeds its8MiB snapshot allowance.');
  }
  return JSON.parse(JSON.stringify(input));
};
const options = (input, names) => Object.fromEntries(names.filter(name => input[name] !== undefined).map(name => [name, input[name]]));
// Whole owner files include private scoring/comparator helpers omitted by a
// public function's toString(). Bind this loaded module instance to that source
// snapshot; captures from another runtime/source policy must be re-captured.
const policySources = ['../pipeline/fusion.js', '../pipeline/rank-stage.js', '../pipeline/topk.js',
  '../pipeline/evidence-selection.js', '../pipeline/graph-ranking.js', '../pipeline/provider-runtime.js',
  '../scoring/relation-boost.js', '../scoring/exact-intent.js', '../../shared/ann-similarity.js',
  '../../graph/prepared-node-indexes.js', '../../graph/work-budget.js', '../../shared/limits.js',
  '../../shared/sort.js', './fusion-replay.js'];
const loadedPolicy = digest({ version: FUSION_REPLAY_VERSION, node: process.version,
  sources: policySources.map(file => [file, createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex')]) });
const currentPolicy = () => loadedPolicy;
const checkSpace = hit => {
  const space = hit.scoreSpace;
  if (!Number.isFinite(hit.sim) || !space || !['cosine', 'jaccard', 'negative-distance', 'dot', 'dot-product'].includes(space.kind)
    || space.kind === 'cosine' && space.metric !== 'cosine'
    || space.kind === 'jaccard' && space.metric !== 'jaccard'
    || space.kind === 'negative-distance' && !['l2', 'ip'].includes(space.metric)
    || space.kind === 'dot' && space.metric !== 'ip'
    || space.kind === 'dot-product' && space.metric !== 'dot') throw fail('Dense replay requires an admitted higher-is-better score space.');
  if (hit.rawDistance != null && (!Number.isFinite(hit.rawDistance)
    || ['dot', 'dot-product', 'jaccard'].includes(space.kind)
    || Math.abs(hit.sim - (space.kind === 'cosine' ? 1 - hit.rawDistance : -hit.rawDistance)) > 1e-12 * Math.max(1, Math.abs(hit.sim)))) throw fail('Dense score/distance conversion disagrees with its declared space.');
};
const validateChannels = record => {
  const candidates = new Map(record.candidates.map(row => [row.idx, row]));
  if (candidates.size !== record.candidates.length || candidates.size > MAX_CANDIDATES
    || new Set(record.candidates.map(row => row.key)).size !== record.candidates.length) throw fail('Replay requires unique bounded source/ordinal mappings.');
  for (const channel of ['sparse', 'dense']) {
    const ids = new Set();
    if (!Array.isArray(record.channels[channel]) || record.channels[channel].length > MAX_CANDIDATES) throw fail('Replay channel exceeded candidate allowance.');
    record.channels[channel].forEach((hit, index) => {
      if (!candidates.has(hit.idx) || ids.has(hit.idx) || hit.rank !== index + 1) throw fail('Replay channel has foreign/duplicate IDs or inconsistent ranks.');
      ids.add(hit.idx);
      if (channel === 'sparse') { if (!Number.isFinite(hit.score)) throw fail('Sparse replay score must be finite.'); }
      else checkSpace(hit);
    });
  }
  return candidates;
};

const contextFor = (record, boosts) => {
  const meta = Object.fromEntries(record.candidates.map(row => [row.idx, { ...row.chunk, __pocFusionReplayId: row.idx }]));
  const facts = new Map(record.candidates.map(row => [row.idx, row.facts]));
  const context = { ...record.rankOptions, idx: { fileRelations: record.fileRelations, graphRelations: record.graphRelations }, meta,
    allowedIdx: null, hasAllowedId: () => true, abortIfNeeded: () => {}, rankMetrics: {}, explain: false,
    poolSnapshot: pool, poolSnapshotStart: pool(), phraseNgramSet: boosts ? new Set(record.phrases) : null,
    getPhraseMatchInfo: (_, id) => ({ matches: facts.get(id).phraseMatches }),
    matchesQueryAst: (_, id, chunk, semantic) => facts.get(id).allowed && (semantic ? facts.get(id).semantic : facts.get(id).sparse),
    sqliteFtsMatchesQueryAst: (_, id) => facts.get(id).allowed && facts.get(id).fts,
    isDefinitionKind: kind => record.definitionKinds[kind] === true,
    isExportedChunk: chunk => facts.get(chunk.__pocFusionReplayId).exported,
    resolveFileRelations: (relations, file) => relations[file] || null };
  if (!boosts) { context.symbolBoostEnabled = false; context.relationBoostEnabled = false; context.graphRankingConfig = { enabled: false }; }
  return context;
};
const summarize = (entries, candidates) => entries.map(entry => ({ key: candidates.get(entry.__pocFusionReplayId).key,
  score: entry.score, scoreType: entry.scoreType, sparseScore: entry.sparseScore, annScore: entry.annScore }));

/** Capture is explicit/offline. It freezes actual gate/phrase/export facts and
 * resolved file relations from the same source generation before any grid runs.
 * Original/stored oracle evidence supplies independently admitted source keys.
 */
export const captureFusionReplay = async ({ evaluationRecord, fusionInput, rankInput, idToSourceKey, signal = null }) => {
  throwIfAborted(signal);
  const { record: evaluation, key: oracleRecordKey } = admitVectorEvaluationRecord(evaluationRecord);
  const k = rankInput.searchTopN, slack = rankInput.topkSlack || 0;
  if (typeof rankInput.query !== 'string'
    || createHash('sha256').update(rankInput.query).digest('hex') !== evaluation.query.textDigest) throw fail('Replay rank query disagrees with admitted query text identity.');
  if (rankInput.idx.state?.embeddings?.embeddingGeneration !== evaluation.corpus.generation) throw fail('Replay capture requires the actual selected embedding generation.');
  if (!Number.isSafeInteger(k) || k < 1 || k > 128 || !Number.isSafeInteger(slack) || slack < 0 || slack > 256) throw fail('Replay output/slack exceeded bounded capture.');
  if (!Array.isArray(fusionInput.bmHits) || !Array.isArray(fusionInput.annHits)
    || fusionInput.bmHits.length > MAX_CANDIDATES || fusionInput.annHits.length > MAX_CANDIDATES) throw fail('Replay needs bounded ordered sparse and dense channel lists.');
  if (rankInput.graphRankingConfig?.enabled && rankInput.graphRankingConfig?.maxWallClockMs != null) throw fail('Time-dependent graph truncation cannot authorize deterministic replay.');
  const ids = [...new Set([...fusionInput.bmHits, ...fusionInput.annHits].map(hit => hit.idx))];
  if (ids.length > MAX_CANDIDATES || ids.some(id => !Number.isSafeInteger(id) || id < 0)) throw fail('Replay candidate ordinal domain is unsupported.');
  const known = new Map(evaluation.rows.map(row => [row.key, row.source])), relations = Object.create(null), definitionKinds = Object.create(null), candidates = [];
  for (const id of ids) {
    throwIfAborted(signal);
    const key = idToSourceKey instanceof Map ? idToSourceKey.get(id) : idToSourceKey[id];
    const chunk = rankInput.meta[id];
    if (!known.has(key) || !chunk || Object.hasOwn(chunk, '__pocFusionReplayId')) throw fail('Replay source mapping is missing, ambiguous or uses a reserved field.');
    const source = known.get(key);
    if (source.file !== chunk.file || source.start !== chunk.start || source.end !== chunk.end
      || source.offsetUnit !== 'utf16-code-unit') throw fail('Replay ordinal mapping disagrees with admitted source span identity.');
    const file = chunk.file || '';
    if (!Object.hasOwn(relations, file)) relations[file] = rankInput.resolveFileRelations?.(rankInput.idx.fileRelations, file,
      rankInput.relationBoostConfig?.caseFile) || null;
    const relation = relations[file];
    const enriched = relation ? { ...chunk, imports: relation.imports ?? chunk.imports,
      exports: relation.exports ?? chunk.exports, usages: relation.usages ?? chunk.usages,
      importLinks: relation.importLinks ?? chunk.importLinks } : chunk;
    const definition = rankInput.isDefinitionKind?.(chunk.kind) === true;
    if (Object.hasOwn(definitionKinds, chunk.kind || '') && definitionKinds[chunk.kind || ''] !== definition) throw fail('Definition callback is not replayable by kind.');
    definitionKinds[chunk.kind || ''] = definition;
    candidates.push({ idx: id, key, chunk, facts: {
      allowed: !rankInput.allowedIdx || rankInput.hasAllowedId(rankInput.allowedIdx, id),
      sparse: rankInput.matchesQueryAst(rankInput.idx, id, chunk, false) === true,
      semantic: rankInput.matchesQueryAst(rankInput.idx, id, chunk, true) === true,
      fts: rankInput.sqliteFtsMatchesQueryAst ? rankInput.sqliteFtsMatchesQueryAst(rankInput.idx, id, chunk, false) === true
        : rankInput.matchesQueryAst(rankInput.idx, id, chunk, false) === true,
      exported: rankInput.isExportedChunk?.(enriched) === true,
      phraseMatches: rankInput.phraseNgramSet?.size ? rankInput.getPhraseMatchInfo(rankInput.idx, id, rankInput.phraseNgramSet, chunk.tokens)?.matches || 0 : 0
    } });
  }
  // Own all production values and the actual baseline before the first await.
  // Oracle work yields; shared metadata or channel arrays can change meanwhile.
  const record = snapshot({ schemaVersion: FUSION_REPLAY_VERSION, kind: 'retrieval-fusion-replay',
    policy: currentPolicy(), provenance: { corpus: evaluation.corpus, embeddingKey: vectorEvaluationEmbeddingKeyFor(evaluation),
      queryKey: evaluation.observed.provenance.queryKey, oracleRecordKey, queryId: evaluation.query.id,
      textDigest: evaluation.query.textDigest, filterDigest: evaluation.query.filterDigest },
    fusionOptions: options(fusionInput, fusionOptionNames), rankOptions: { ...options(rankInput, rankOptionNames), topkSlack: slack },
    channels: { sparse: fusionInput.bmHits.map((hit, index) => ({ idx: hit.idx, score: hit.score, rank: index + 1 })),
      dense: fusionInput.annHits.map((hit, index) => ({ idx: hit.idx, sim: hit.sim, rank: index + 1,
        scoreSpace: hit.scoreSpace ? { kind: hit.scoreSpace.kind, metric: hit.scoreSpace.metric, backend: hit.scoreSpace.backend ?? null } : null,
        rawDistance: hit.rawDistance ?? null })) },
    candidates, fileRelations: relations, graphRelations: rankInput.idx.graphRelations || null,
    definitionKinds, phrases: [...(rankInput.phraseNgramSet || [])], judgments: evaluation.observed.judgments,
    baseline: [] });
  const mapping = validateChannels(record), fused = fuseRankedHits({ ...fusionInput, scoreBuffer: null });
  const captureMeta = Object.fromEntries(record.candidates.map(row => [row.idx, { ...row.chunk, __pocFusionReplayId: row.idx }]));
  const baseline = runRankStage({ ...rankInput, meta: captureMeta, explain: false,
    rankMetrics: {}, poolSnapshotStart: pool(), poolSnapshot: pool, fusedScores: fused.scored, useRrf: fused.useRrf });
  record.baseline = summarize(baseline, mapping);
  const oracle = await evaluateVectorOracles(evaluation, { k, signal });
  throwIfAborted(signal);
  if (!oracle.complete) throw fail('Incomplete independent vector universe cannot authorize a replay capture.');
  const reference = oracle.original.status === 'complete' ? oracle.original : oracle.stored;
  record.oracle = snapshot({ representation: reference.representation, referenceKeys: reference.results.map(row => row.key), counts: oracle.counts });
  record.recordKey = digest(record);
  const verified = replayFusionRecord(record);
  if (stableStringify(verified.results) !== stableStringify(record.baseline)) throw fail('Saved fusion/rank baseline did not replay exactly.');
  return record;
};
// Kept distinct from generation-local ordinal maps even when all score channels
// happen to use the same IDs in one captured generation.
const vectorEvaluationEmbeddingKeyFor = evaluation => evaluation.observed.provenance.embeddingKey;

export const admitFusionReplayRecord = input => {
  const captured = snapshot(input), validation = validateFusionReplayRecord(captured);
  if (!validation.ok) throw fail(`Invalid fusion replay record: ${validation.errors.slice(0, 4).join('; ')}`);
  const { recordKey, ...body } = captured;
  if (body.schemaVersion !== FUSION_REPLAY_VERSION || body.kind !== 'retrieval-fusion-replay'
    || body.policy !== currentPolicy() || recordKey !== digest(body)) throw fail('Replay schema, runtime policy or immutable record digest is stale.');
  validateChannels(captured);
  return captured;
};

export const replayFusionRecord = (input, candidate = null) => {
  const { recordKey, ...record } = admitFusionReplayRecord(input), mapping = validateChannels(record);
  if (candidate !== null && (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
    || Object.keys(candidate).some(name => !candidateFields.has(name)))) throw fail('Unsupported fusion replay policy fields.');
  const setting = { mode: 'current', sparseDepth: record.channels.sparse.length, denseDepth: record.channels.dense.length,
    rrfK: record.fusionOptions.rrfK, sparseWeight: record.fusionOptions.blendSparseWeight,
    denseWeight: record.fusionOptions.blendAnnWeight, boosts: true, diversity: true, ...(candidate || {}) };
  if (!['current', 'rrf', 'blend', 'fixed-missing'].includes(setting.mode)
    || ![setting.sparseDepth, setting.denseDepth].every(value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_CANDIDATES)
    || typeof setting.boosts !== 'boolean' || typeof setting.diversity !== 'boolean') throw fail('Unsupported fusion replay candidate.');
  if (setting.mode === 'rrf' && (!Number.isSafeInteger(setting.rrfK) || setting.rrfK < 1 || setting.rrfK > 1024)
    || ['blend', 'fixed-missing'].includes(setting.mode) && (![setting.sparseWeight, setting.denseWeight].every(value => Number.isFinite(value) && value >= 0 && value <= 1)
      || setting.sparseWeight + setting.denseWeight <= 0)) throw fail('Fusion sweep parameters are outside their bounded domain.');
  const sparse = record.channels.sparse.slice(0, setting.sparseDepth), dense = record.channels.dense.slice(0, setting.denseDepth);
  const fusionOptions = { ...record.fusionOptions };
  if (setting.mode !== 'current') Object.assign(fusionOptions, { rrfEnabled: setting.mode === 'rrf',
    blendEnabled: setting.mode !== 'rrf', rrfK: setting.rrfK,
    blendSparseWeight: setting.sparseWeight, blendAnnWeight: setting.denseWeight });
  // This experimental baseline defines missing normalized contributions as
  // zero but retains every observed union member, including a zero-weight-only
  // member. Raw absent source scores remain null in the receipt.
  if (setting.mode === 'fixed-missing') Object.assign(fusionOptions, { blendSparseWeight: 1, blendAnnWeight: 1 });
  const fused = fuseRankedHits({ ...fusionOptions, bmHits: sparse, annHits: dense });
  if (setting.mode === 'fixed-missing') {
    const sparseMaximum = sparse.reduce((maximum, hit) => Math.max(maximum, hit.score), 0), spaces = new Map(dense.map(hit => [hit.idx, hit.scoreSpace]));
    for (const entry of fused.scored) {
      const left = entry.sparseScore !== null && sparseMaximum > 0 ? entry.sparseScore / sparseMaximum : null;
      const right = calibrateAnnScore(entry.annScore, spaces.get(entry.idx));
      entry.score = ((left ?? 0) * setting.sparseWeight + (right ?? 0) * setting.denseWeight) / (setting.sparseWeight + setting.denseWeight);
      entry.scoreType = 'fixed-missing-blend';
    }
  }
  const context = contextFor(record, setting.boosts), finalK = context.searchTopN, slack = context.topkSlack || 0;
  let results;
  if (setting.diversity) {
    // Keep the ordinary replay on the complete production rank call. Only the
    // explicit diversity ablation needs a separate bounded selection below.
    results = summarize(runRankStage({ ...context, fusedScores: fused.scored,
      useRrf: fused.useRrf, blendEnabled: fusionOptions.blendEnabled }), mapping);
  } else {
    const reducer = createTopKReducer({ k: finalK, slack, buildPayload: entry => entry.payload });
    // A one-member production call applies the existing gates/boosts without
    // removing overlapping members before this explicit diversity ablation.
    fused.scored.forEach((entry, sourceRank) => {
      const chunk = runRankStage({ ...context, graphRankingConfig: { enabled: false },
        searchTopN: 1, topkSlack: 0, fusedScores: [entry], useRrf: fused.useRrf,
        blendEnabled: fusionOptions.blendEnabled })[0];
      if (!chunk) return;
      const idx = chunk.__pocFusionReplayId;
      reducer.pushRaw(chunk.score, idx, sourceRank, { idx, score: chunk.score, chunk,
        sparseScore: chunk.sparseScore, annScore: chunk.annScore, scoreType: chunk.scoreType });
    });
    const poolRows = reducer.finish({ limit: finalK + slack });
    let selected = poolRows.slice(0, finalK);
    if (context.graphRankingConfig?.enabled) selected = applyGraphRanking({ entries: selected,
      graphRelations: context.idx.graphRelations, config: context.graphRankingConfig, explain: false }).entries;
    results = selected.map(entry => ({ key: mapping.get(entry.idx).key, score: entry.score,
      scoreType: entry.scoreType, sparseScore: entry.sparseScore, annScore: entry.annScore }));
  }
  const union = new Set([...sparse, ...dense].map(hit => hit.idx)), sparseIds = new Set(sparse.map(hit => hit.idx)), denseIds = new Set(dense.map(hit => hit.idx));
  const reference = record.oracle.referenceKeys, unionKeys = new Set([...union].map(id => mapping.get(id).key));
  return { schemaVersion: FUSION_REPLAY_VERSION, recordKey, policyKey: digest(setting), setting, results,
    candidateRecall: { hits: reference.filter(key => unionKeys.has(key)).length, denominator: reference.length,
      value: reference.length ? reference.filter(key => unionKeys.has(key)).length / reference.length : null,
      representation: record.oracle.representation },
    missingness: { union: union.size, sparse: sparse.length, dense: dense.length,
      missingSparse: [...union].filter(id => !sparseIds.has(id)).length, missingDense: [...union].filter(id => !denseIds.has(id)).length },
    costScope: 'saved-score-replay; retrieval/model/index-IO-not-measured' };
};
