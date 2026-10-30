import { createHash } from 'node:crypto';
import { VECTOR_EVALUATION_VERSION } from '../../src/contracts/schemas/vector-evaluation.js';
import { vectorEvaluationSourceKey, vectorEvaluationCorpusDigest, vectorEvaluationEmbeddingKey,
  vectorEvaluationQueryKey, vectorEvaluationOriginalDigest } from '../../src/retrieval/evaluation/vector-oracle.js';
import { captureFusionReplay } from '../../src/retrieval/evaluation/fusion-replay.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export const fusionFixtureInput = (id = 'q1', { overlap = false } = {}) => {
  const sources = ['a.js', 'b.js', 'c.js'].map((name, index) => ({ repoId: 'fusion-fixture', mode: 'code',
    file: overlap && index === 1 ? 'a.js' : name,
    start: overlap && index === 1 ? 1 : 0, end: overlap && index === 1 ? 9 : 8,
    offsetUnit: 'utf16-code-unit', contentDigest: hash(name) }));
  const rows = sources.map((source, index) => ({ key: vectorEvaluationSourceKey(source), source,
    presence: { code: true, doc: false, merged: true }, original: [[1, 0], [0, 1], [-1, 0]][index],
    stored: [[2, 1], [1, 2], [0, 1]][index] }));
  const evaluation = { schemaVersion: VECTOR_EVALUATION_VERSION, kind: 'retrieval-vector-evaluation',
    corpus: { id: 'fusion-fixture', sourceDigest: vectorEvaluationCorpusDigest(rows), generation: hash('fusion-generation') },
    embedding: { modelId: 'fixture-model', revision: 'a'.repeat(40), artifactDigest: hash('graph'), tokenizerDigest: hash('tokenizer'),
      dimensions: 2, normalize: false, metric: 'cosine', channel: 'merged', storage: { encoding: 'uint8-affine-v1', minVal: -1, maxVal: 1, levels: 3 } },
    query: { id, textDigest: hash(`query ${id}`), filterDigest: hash('all'), vector: [1, 0] },
    originals: { status: 'available', capture: 'provider-fp32', digest: vectorEvaluationOriginalDigest(rows) },
    eligibility: { status: 'complete', method: 'hand-admitted', policyDigest: hash('all-source-rows'), admittedKeys: rows.map(row => row.key) },
    rows, observed: { provenance: {}, eligibleKeys: rows.map(row => row.key), sparseKeys: rows.slice(0, 2).map(row => row.key),
      vectorKeys: rows.slice(1).map(row => row.key), finalKeys: [], judgments: rows.map((row, index) => ({ key: row.key, relevance: index === 1 ? 4 : 0 })) } };
  evaluation.observed.provenance = { sourceDigest: evaluation.corpus.sourceDigest, generation: evaluation.corpus.generation,
    embeddingKey: vectorEvaluationEmbeddingKey(evaluation.embedding), queryKey: vectorEvaluationQueryKey(evaluation) };
  const fusionInput = { bmHits: [{ idx: 0, score: 10 }, { idx: 1, score: 1 }],
    annHits: [{ idx: 1, sim: 1, scoreSpace: { kind: 'cosine', metric: 'cosine', backend: 'fixture' }, rawDistance: 0 },
      { idx: 2, sim: 0.4, scoreSpace: { kind: 'cosine', metric: 'cosine', backend: 'fixture' }, rawDistance: 0.6 }],
    sparseType: 'bm25', annSource: 'fixture', rrfEnabled: false, rrfK: 60,
    blendEnabled: true, blendSparseWeight: 0.5, blendAnnWeight: 0.5, fieldWeightsEnabled: false };
  const meta = sources.map((source, index) => ({ file: source.file, start: source.start, end: source.end,
    name: `function${index}`, kind: 'FunctionDeclaration', chunkUid: `chunk-${index}`, tokens: ['query'] }));
  const snapshot = () => ({ candidate: {}, score: {} });
  const rankInput = { idx: { state: { embeddings: { embeddingGeneration: evaluation.corpus.generation } }, fileRelations: null, graphRelations: null },
    meta, searchTopN: 1, topkSlack: 1, allowedIdx: null, hasAllowedId: (_, index) => index !== 99,
    abortIfNeeded: () => {}, poolSnapshot: snapshot, poolSnapshotStart: snapshot(), rankMetrics: {}, explain: false,
    matchesQueryAst: () => true, sqliteFtsMatchesQueryAst: () => true,
    getPhraseMatchInfo: () => ({ matches: 0 }), phraseNgramSet: new Set(),
    symbolBoostEnabled: false, symbolBoostDefinitionWeight: 1.15, symbolBoostExportWeight: 1.1,
    relationBoostEnabled: false, relationBoostConfig: { caseFile: false }, resolveFileRelations: () => null,
    isDefinitionKind: kind => kind === 'FunctionDeclaration', isExportedChunk: () => false,
    queryTokens: ['query'], query: `query ${id}`, graphRankingConfig: { enabled: false }, blendEnabled: true };
  return { evaluationRecord: evaluation, fusionInput, rankInput,
    idToSourceKey: new Map(rows.map((row, index) => [index, row.key])) };
};
export const captureFusionFixture = async id => {
  const input = fusionFixtureInput(id);
  return { input, record: await captureFusionReplay(input) };
};
