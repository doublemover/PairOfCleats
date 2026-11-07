import { semanticObject as object, semanticHashSchema as hash, SEMANTIC_GENERATION_SCHEMA } from './semantic-envelopes.js';
import { RELATIONAL_JOIN_DEFINITION_SCHEMA } from './relational-join.js';
import { GROUPED_ADJACENCY_DEFINITION_SCHEMA } from './grouped-adjacency.js';
import { SELECTED_ADJACENCY_DEFINITION_SCHEMA } from './selected-adjacency.js';
const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const list = (items, maximum) => ({ type: 'array', items, maxItems: maximum });
const row = signed => object({ occurrenceId: text(64), supportId: text(64), from: text(32), to: text(32), sourceRef: { type: 'null' },
  multiplicity: { type: 'string', pattern: signed ? '^-?[1-8]$' : '^[1-8]$' } });
const world = object({ generation: SEMANTIC_GENERATION_SCHEMA, repositoryNamespace: text(128), contextKey: text(128) });
export const REVISION_RELATIONAL_VERSION = 3;
export const REVISION_RELATIONAL_PROFILE = 'finite-relational-revisions-v3';
export const REVISION_RELATIONAL_SCHEMA = object({ schemaVersion: { const: REVISION_RELATIONAL_VERSION }, profile: { const: REVISION_RELATIONAL_PROFILE },
  family: text(64), seed: { type: 'integer', minimum: 0, maximum: 4294967295 }, definition: {
    oneOf: [RELATIONAL_JOIN_DEFINITION_SCHEMA, GROUPED_ADJACENCY_DEFINITION_SCHEMA, SELECTED_ADJACENCY_DEFINITION_SCHEMA] },
  world, initial: object({ left: list(row(false), 8), right: list(row(false), 8), leftComplete: { type: 'boolean' }, rightComplete: { type: 'boolean' } }),
  revisions: list(object({ id: text(64), beforeId: hash, afterId: hash, toWorld: world,
    left: list(row(true), 8), right: list(row(true), 8), leftComplete: { type: 'boolean' }, rightComplete: { type: 'boolean' } }), 16) });
const parent = object({ occurrenceId: text(64), supportId: text(64), sourceRef: { type: 'null' } });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const operators = ['inner-join', 'left-anti-join', 'grouped-adjacency', 'select-project-adjacency'];
const outputFields = { capturedDomainComplete: { type: 'boolean' }, relationCardinality: { type: 'string', pattern: '^(0|[1-9][0-9]{0,3})$' },
  unresolvedLeftSupports: { type: 'integer', minimum: 0, maximum: 8 } };
const output = { oneOf: [object({ ...outputFields, operator: { enum: ['inner-join', 'left-anti-join'] },
  rows: list(object({ from: text(32), to: text(32), multiplicity: { type: 'string', pattern: '^[1-9][0-9]?$' },
    parents: object({ left: parent, right: nullable(parent) }) }), 64) }),
object({ ...outputFields, operator: { const: 'select-project-adjacency' },
  rows: list(object({ from: text(32), to: text(32), multiplicity: { type: 'string', pattern: '^[1-8]$' }, parent: row(false) }), 8) }),
object({ ...outputFields, operator: { const: 'grouped-adjacency' }, rows: list(object({ key: text(32),
  supportCount: { type: 'integer', minimum: 1, maximum: 8 }, weightedCount: { type: 'string', pattern: '^[1-9][0-9]?$' },
  distinctValueCount: { type: 'integer', minimum: 1, maximum: 8 }, minimum: text(32), maximum: text(32),
  status: { enum: ['exact-in-captured-domain', 'observed-in-incomplete-domain'] }, alternatives: list(row(false), 8) }), 8) })] };
const milliseconds = { type: 'number', minimum: 0 };
const count = maximum => ({ type: 'integer', minimum: 0, maximum });
const workBase = { candidateMs: milliseconds, rebuildMs: milliseconds, referenceMs: milliseconds,
  referenceOperations: count(4096), workUnits: count(65536) };
const joinWork = { ...object({ ...workBase, strategy: { enum: ['full-affected-view-recomputation', 'role-ordered-inner-join'] },
  derivedSupportHashes: count(1024), incrementalPairTerms: nullable(count(65536)) }),
allOf: [{ if: { type: 'object', required: ['strategy'], properties: { strategy: { const: 'full-affected-view-recomputation' } } },
  then: { type: 'object', properties: { incrementalPairTerms: { type: 'null' } } },
  else: { type: 'object', properties: { incrementalPairTerms: count(65536) } } }] };
const antiWork = object({ ...workBase, strategy: { const: 'full-affected-view-recomputation' },
  derivedSupportHashes: count(1024), incrementalPairTerms: { type: 'null' } });
const groupWork = object({ ...workBase, strategy: { enum: ['full-affected-view-recomputation', 'affected-group-recomputation'] },
  recomputedGroups: count(256), derivedGroupHashes: count(256) });
const selectedWork = object({ ...workBase, strategy: { enum: ['full-affected-view-recomputation', 'incremental-selected-supports'] },
  derivedSupportHashes: count(256) });
const checkpoint = { oneOf: [object({ index: { type: 'integer', minimum: 0, maximum: 16 }, checkpointId: text(64),
  outcome: { const: 'not-run' }, reason: text(128) }),
object({ index: { type: 'integer', minimum: 0, maximum: 16 }, checkpointId: text(64), stateId: hash,
  outcome: { enum: ['pass', 'fail', 'unknown'] }, candidateExecutionId: text(64), rebuildExecutionId: text(64),
  candidateViewRootId: hash, rebuildViewRootId: hash, candidateRelationRootId: hash, rebuildRelationRootId: hash,
  candidateOutputId: hash, referenceOutputId: nullable(hash),
  claims: { type: 'array', minItems: 2, maxItems: 2, items: { oneOf: [object({ tier: { const: 'independent-tiny-expanded-bag' },
    outcome: { enum: ['pass', 'fail', 'unknown'] }, reason: nullable(text(128)), counterexample: nullable(object({ expected: output, actual: output })),
    counterexampleState: { enum: ['not-applicable', 'retained', 'omitted-after-first; failure-retained'] } }),
  object({ tier: { const: 'same-implementation-clean-rebuild' }, outcome: { enum: ['pass', 'fail'] },
    identity: { const: 'relation-content; private-ledgers-are-invocation-specific' } })] } },
  work: { oneOf: [joinWork, groupWork, selectedWork] }, capturedDomainComplete: { type: 'boolean' },
  unresolvedLeftSupports: { type: 'integer', minimum: 0, maximum: 8 } })] };
const workFor = (operators, work) => ({ if: { type: 'object', required: ['operator'], properties: { operator: { enum: operators } } },
  then: { type: 'object', properties: { checkpoints: { type: 'array', items: { type: 'object', properties: { work } } } } } });
export const REVISION_RELATIONAL_RECEIPT_SCHEMA = { ...object({ schemaVersion: { const: REVISION_RELATIONAL_VERSION }, kind: { const: 'finite-relational-revision-run' },
  scenarioId: hash, executionId: text(64), profile: { const: REVISION_RELATIONAL_PROFILE }, operator: { enum: operators }, outcome: { enum: ['pass', 'fail', 'unknown'] },
  checkpoints: { ...list(checkpoint, 17), minItems: 1 }, scope: { const: 'tiny-supplied-occurrence-bags-and-captured-domain-observations' },
  sourceAuthority: { const: 'not-established' }, semanticClosure: { const: 'not-implied' }, elapsedMs: milliseconds,
  limits: object({ maxMs: { type: 'integer', minimum: 1, maximum: 1000 }, maxReferenceWork: { type: 'integer', minimum: 0, maximum: 4096 },
    inputSupportsPerSide: { const: 8 }, copiesPerSupport: { const: 8 }, checkpoints: { const: 17 }, receiptBytes: { const: 262144 } }) }),
allOf: [workFor(['inner-join'], joinWork), workFor(['left-anti-join'], antiWork), workFor(['grouped-adjacency'], groupWork),
  workFor(['select-project-adjacency'], selectedWork)] };
