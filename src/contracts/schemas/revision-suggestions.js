import { semanticObject as object, semanticHashSchema as hash, semanticNullable as nullable } from './semantic-envelopes.js';

export const SUGGESTION_REVISION_PROFILE = 'finite-import-test-suggestion-revisions-v1';
const list = (items, maxItems) => ({ type: 'array', items, maxItems });
const count = maximum => ({ type: 'integer', minimum: 0, maximum });
const id = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' };
const path = { type: 'string', maxLength: 80, pattern: '^(?:[a-z][a-z0-9_-]*/)*[a-z][a-z0-9_.-]*\\.js$' };
const paths = maximum => ({ ...list(path, maximum), uniqueItems: true });
const edge = object({ id, from: path, to: path });
const state = object({ nodes: paths(12), edges: list(edge, 64), testPaths: paths(8), changedPaths: paths(4) });
export const SUGGESTION_REVISION_SCENARIO_SCHEMA = object({ schemaVersion: { const: 1 }, profile: { const: SUGGESTION_REVISION_PROFILE },
  family: id, seed: count(4294967295), repositoryNamespace: id, initial: state,
  revisions: list(object({ id, beforeId: hash, afterId: hash, removeNodes: paths(12), addNodes: paths(12),
    removeEdgeIds: { ...list(id, 64), uniqueItems: true }, addEdges: list(edge, 64), testPaths: paths(8), changedPaths: paths(4) }), 16) });
const row = object({ testPath: path, distance: count(11), score: { type: 'number', exclusiveMinimum: 0, maximum: 1 }, witness: paths(12),
  witnessTarget: nullable(path), witnessDistance: nullable(count(11)) });
export const SUGGESTION_REVISION_OUTPUT_SCHEMA = object({ indexSignature: hash, changedPaths: paths(4),
  graphRows: list(row, 8), heuristicPaths: paths(8), graphAvailable: { type: 'boolean' }, graphUsed: { type: 'boolean' },
  fidelitySource: { enum: ['graph', 'heuristic', 'none'] }, fidelityState: { enum: ['complete', 'partial', 'fallback', 'missing'] },
  complete: { type: 'boolean' }, reasonCodes: list({ type: 'string', minLength: 1, maxLength: 64 }, 8) });
const referenceRow = object({ testPath: path, distance: count(11), score: { type: 'number', exclusiveMinimum: 0, maximum: 1 } });
const claim = object({ tier: { const: 'independent-finite-import-distance-matrix' }, relation: { const: 'graph-suggestions-shortest-distance-and-valid-source-witnesses' },
  outcome: { enum: ['pass', 'fail', 'unknown'] }, reason: nullable({ type: 'string', minLength: 1, maxLength: 96 }),
  counterexample: nullable(object({ expected: list(referenceRow, 8), actual: SUGGESTION_REVISION_OUTPUT_SCHEMA })) });
const ms = { type: 'number', minimum: 0 };
const checkpoint = { oneOf: [object({ index: count(16), checkpointId: id, stateId: hash, outcome: { const: 'not-run' }, reason: { const: 'run-work-budget' } }),
  object({ index: count(16), checkpointId: id, stateId: hash, outcome: { enum: ['pass', 'fail', 'unknown'] },
    candidateExecutionId: id, rebuildExecutionId: id, candidateOutputId: hash, rebuildOutputId: hash, referenceOutputId: nullable(hash),
    originalEdgeIds: { ...list(id, 64), uniqueItems: true }, output: SUGGESTION_REVISION_OUTPUT_SCHEMA,
    claims: { type: 'array', minItems: 2, maxItems: 2, items: { oneOf: [claim, object({ tier: { const: 'same-consumer-fresh-graph' },
      relation: { const: 'exact-output-with-original-index-signature' }, outcome: { enum: ['pass', 'fail', 'unknown'] } })] } },
    work: object({ candidateMs: ms, rebuildMs: ms, referenceMs: ms, referenceOperations: count(4096), graphBuilds: { const: 2 },
      nodes: count(12), edgeSupports: count(64), candidateNeighborReads: count(1024), candidateWitnessLinks: count(128) }) })] };
export const SUGGESTION_REVISION_RECEIPT_SCHEMA = object({ schemaVersion: { const: 1 }, kind: { const: 'finite-import-test-suggestion-revision-run' },
  profile: { const: SUGGESTION_REVISION_PROFILE }, scenarioId: hash, executionId: id, family: id, seed: count(4294967295),
  repositoryNamespace: id, outcome: { enum: ['pass', 'fail', 'unknown'] }, checkpoints: { ...list(checkpoint, 17), minItems: 1 },
  consumer: { const: 'buildSuggestTestsReport:1.0.0' },
  scope: { const: 'supplied-finite-import-supports; no-source-extraction-publication-or-execution-coverage-claim' },
  limits: object({ maxMs: { type: 'integer', minimum: 1, maximum: 1000 }, maxReferenceWork: count(4096), receiptBytes: { const: 262144 } }), elapsedMs: ms });
