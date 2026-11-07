import { semanticObject as object, semanticHashSchema as hash, SEMANTIC_GENERATION_SCHEMA } from './semantic-envelopes.js';
import { RELATIONAL_JOIN_DEFINITION_SCHEMA } from './relational-join.js';
const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const list = (items, maximum) => ({ type: 'array', items, maxItems: maximum });
const row = signed => object({ occurrenceId: text(64), supportId: text(64), from: text(32), to: text(32), sourceRef: { type: 'null' },
  multiplicity: { type: 'string', pattern: signed ? '^-?[1-8]$' : '^[1-8]$' } });
const world = object({ generation: SEMANTIC_GENERATION_SCHEMA, repositoryNamespace: text(128), contextKey: text(128) });
export const REVISION_RELATIONAL_SCHEMA = object({ schemaVersion: { const: 1 }, profile: { const: 'finite-relational-revisions-v1' },
  family: text(64), seed: { type: 'integer', minimum: 0, maximum: 4294967295 }, definition: RELATIONAL_JOIN_DEFINITION_SCHEMA,
  world, initial: object({ left: list(row(false), 8), right: list(row(false), 8), leftComplete: { type: 'boolean' }, rightComplete: { type: 'boolean' } }),
  revisions: list(object({ id: text(64), beforeId: hash, afterId: hash, toWorld: world,
    left: list(row(true), 8), right: list(row(true), 8), leftComplete: { type: 'boolean' }, rightComplete: { type: 'boolean' } }), 16) });
const parent = object({ occurrenceId: text(64), supportId: text(64), sourceRef: { type: 'null' } });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const output = object({ capturedDomainComplete: { type: 'boolean' }, unresolvedLeftSupports: { type: 'integer', minimum: 0, maximum: 8 },
  rows: list(object({ from: text(32), to: text(32), multiplicity: { type: 'string', pattern: '^[1-9][0-9]?$' },
    parents: object({ left: parent, right: nullable(parent) }) }), 64) });
const milliseconds = { type: 'number', minimum: 0 };
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
  work: object({ candidateMs: milliseconds, rebuildMs: milliseconds, referenceMs: milliseconds,
    referencePairs: { type: 'integer', minimum: 0, maximum: 4096 }, workUnits: { type: 'integer', minimum: 0, maximum: 65536 },
    strategy: { const: 'full-affected-view-recomputation' } }), capturedDomainComplete: { type: 'boolean' },
  unresolvedLeftSupports: { type: 'integer', minimum: 0, maximum: 8 } })] };
export const REVISION_RELATIONAL_RECEIPT_SCHEMA = object({ schemaVersion: { const: 1 }, kind: { const: 'finite-relational-revision-run' },
  scenarioId: hash, executionId: text(64), profile: { const: 'finite-relational-revisions-v1' }, outcome: { enum: ['pass', 'fail', 'unknown'] },
  checkpoints: { ...list(checkpoint, 17), minItems: 1 }, scope: { const: 'tiny-supplied-occurrence-bags-and-captured-domain-observations' },
  sourceAuthority: { const: 'not-established' }, semanticClosure: { const: 'not-implied' }, elapsedMs: milliseconds,
  limits: object({ maxMs: { type: 'integer', minimum: 1, maximum: 1000 }, maxReferencePairs: { type: 'integer', minimum: 0, maximum: 4096 },
    inputSupportsPerSide: { const: 8 }, copiesPerSupport: { const: 8 }, checkpoints: { const: 17 }, receiptBytes: { const: 262144 } }) });
