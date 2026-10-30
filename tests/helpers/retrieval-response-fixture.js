import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { buildRetrievalMetadata } from '../../src/retrieval/output/retrieval-metadata.js';
import { createRetrievalExecutionOutcome } from '../../src/retrieval/pipeline/execution-outcome.js';
import { bindRetrievalScoreSpaces, createScoreCoordinateIdentity } from '../../src/retrieval/scoring/score-space.js';

/** Deliberately selected canned adapters exercise report contracts only.
 * Named fixture profile/reason/signature cannot be mistaken for a native run. */
export const createFixtureRetrievalMetadata = ({ fixtureId, backend, modes = ['code', 'prose'], buildId = fixtureId } = {}) => {
  if (typeof fixtureId !== 'string' || !fixtureId || !['memory', 'sqlite', 'sqlite-fts'].includes(backend)) {
    throw new TypeError('An explicit named retrieval fixture and backend are required.');
  }
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const indexes = {}, signatures = {}, generations = {}, executionOutcomes = {};
  for (const mode of modes) {
    indexes[mode] = { state: { buildId, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, profile: { id: `fixture:${fixtureId}` } } };
    signatures[mode] = hash([fixtureId, mode, 'controlled-fixture-source']);
    generations[mode] = { buildId, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      generationKey: `fixture:${buildId}`, activeBuildRoot: `fixture/${buildId}` };
    executionOutcomes[mode] = createRetrievalExecutionOutcome({ mode,
      requestedSparse: backend === 'sqlite-fts' ? 'sqlite-fts' : 'js-bm25', effectiveSparse: backend === 'sqlite-fts' ? 'fts' : 'bm25' });
  }
  return buildRetrievalMetadata({ backendLabel: backend, effectivePlanIdentity: 'eqp1-' + hash([fixtureId, backend]),
    scorePolicyIdentity: 'sqp1-' + hash([fixtureId, 'explicit-score-fixture']),
    effectiveSystemIdentity: 'esp1-' + hash([fixtureId, backend, 'explicit-system-fixture']),
    backendPolicyInfo: { requested: backend, reason: `explicit-fixture-adapter:${fixtureId}` },
    cacheInfo: { hit: false, strategy: 'fixture-adapter', memoryHotPath: false }, executionOutcomes,
    idxCode: indexes.code, idxProse: indexes.prose, idxExtractedProse: indexes['extracted-prose'], idxRecords: indexes.records,
    indexSignaturePayload: { modes: signatures, generationByMode: generations } });
};

/** Explicit fixture coordinates use the real output binder without claiming a
 * measured native provider. Source/policy identity comes from the named capsule. */
export const bindFixtureRetrievalScores = (hits, retrieval, mode = 'code', type = 'bm25') => bindRetrievalScoreSpaces(
  hits.map(hit => ({ ...hit, scoreType: type,
    scoreCoordinateIdentity: createScoreCoordinateIdentity({ type, fixture: 'declared-report-arithmetic-v1' }) })),
  { policyIdentity: retrieval.scorePolicyIdentity, freshness: retrieval.freshness.byMode[mode] });
