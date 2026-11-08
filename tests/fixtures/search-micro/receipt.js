import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { RETRIEVAL_EXECUTION_VERSION } from '../../../src/contracts/retrieval-execution.js';
import { buildRetrievalMetadata } from '../../../src/retrieval/output/retrieval-metadata.js';
import { RETRIEVAL_WORK_VERSION } from '../../../src/contracts/retrieval-work.js';

export const samplePayload = ({ hit = false, enabled = false, backend = 'memory', ann = false, source = 'js' } = {}) => {
  const execution = { schemaVersion: RETRIEVAL_EXECUTION_VERSION, kind: 'retrieval-mode-execution', mode: 'code',
    status: 'complete', cacheable: true, requested: { sparse: 'bm25', ann, reranker: false },
    effective: { sparse: 'bm25', ann: ann ? source : null, reranker: null }, reasons: [] };
  const retrieval = buildRetrievalMetadata({ backendLabel: backend, executionOutcomes: { code: execution },
    cacheInfo: { hit, strategy: 'memory', memoryHotPath: hit }, scorePolicyIdentity: `sqp1-${'a'.repeat(64)}`,
    effectivePlanIdentity: `eqp1-${'b'.repeat(64)}`, effectiveSystemIdentity: `esp1-${'c'.repeat(64)}`,
    idxCode: { state: { buildId: 'known-build', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, profile: { id: 'default' } } },
    indexSignaturePayload: { modes: { code: 'known-index-signature' }, generationByMode: { code: {
      buildId: 'known-build', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      generationKey: 'known-generation', activeBuildRoot: 'known-fixture-index-root'
    } } } });
  return { backend, code: [{ chunkUid: 'ck64:v1:repo:src/sample.js:0123456789abcdef', file: 'src/sample.js',
    start: 0, end: 10, name: 'sample', score: 1, scoreType: ann ? 'blend' : 'bm25' }], retrieval,
  stats: { cache: { enabled, hit }, models: { code: 'fixture-model' }, embeddings: { provider: 'fixture' },
    work: { schemaVersion: RETRIEVAL_WORK_VERSION, scope: 'whole-search-invocation',
      embeddingRequests: ann && !hit ? 1 : 0, embeddingApiCalls: ann && !hit ? 1 : 0, embeddingCacheHits: 0, models: {} },
    pipeline: hit ? [] : [{ stage: 'candidates', mode: 'code', counts: { lexicalCandidatesBuilt: true, bmHits: 1, candidates: 1 } },
      { stage: 'ann', mode: 'code', vectorActive: ann, providerAvailable: ann, source: ann ? source : null, hits: ann ? 1 : 0 }] } };
};
