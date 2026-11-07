import { semanticObject as object } from './semantic-envelopes.js';
import { QUESTION_WORLD_SCHEMA, QUESTION_SOURCE_REFERENCE_SCHEMA } from './repository-question.js';

export const FINITE_FEASIBILITY_VERSION = 1;
export const FINITE_FEASIBILITY_PROFILE = 'finite-boolean-acyclic-v1';
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' };
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
const operation = { oneOf: [
  object({ id, kind: { const: 'constant' }, value: { type: 'boolean' } }),
  object({ id, kind: { enum: ['copy', 'not'] }, operand: id }),
  object({ id, kind: { enum: ['and', 'or', 'xor', 'equal'] }, left: id, right: id }),
  object({ id, kind: { const: 'unsupported' }, reason: { type: 'string', minLength: 1, maxLength: 256 } })
] };
const terminator = { oneOf: [object({ kind: { const: 'goto' }, target: id }),
  object({ kind: { const: 'branch' }, condition: id, onTrue: id, onFalse: id }),
  object({ kind: { enum: ['return', 'throw'] }, value: id }),
  object({ kind: { const: 'unsupported' }, reason: { type: 'string', minLength: 1, maxLength: 256 } })] };
export const FINITE_FEASIBILITY_REQUEST_SCHEMA = object({ schemaVersion: { const: FINITE_FEASIBILITY_VERSION },
  profile: { const: FINITE_FEASIBILITY_PROFILE }, world: QUESTION_WORLD_SCHEMA,
  translation: { const: 'declared-source-mapping-not-execution-qualified' },
  anchors: list(object({ id, source: QUESTION_SOURCE_REFERENCE_SCHEMA }), 32, 1),
  inputs: { ...list(id, 12), uniqueItems: true },
  entryConditions: list(object({ input: id, value: { type: 'boolean' } }), 12), entry: id,
  blocks: list(object({ id, anchorId: id,
    phis: list(object({ id, incoming: list(object({ predecessor: id, value: id }), 64, 1) }), 32),
    operations: list(operation, 128), terminator }), 64, 1),
  predicate: { oneOf: [object({ kind: { const: 'reaches-block' }, block: id }),
    object({ kind: { enum: ['return-value', 'throw-value'] }, block: id, value: { type: 'boolean' } })] } });

const uint = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const nullable = value => ({ anyOf: [value, { type: 'null' }] });
const terminal = nullable(object({ kind: { enum: ['return', 'throw'] }, value: { type: 'boolean' } }));
const ms = { type: 'number', minimum: 0 };
export const FINITE_FEASIBILITY_RESULT_SCHEMA = object({ schemaVersion: { const: FINITE_FEASIBILITY_VERSION },
  kind: { const: 'finite-boolean-feasibility' }, executionId: { type: 'string', minLength: 1, maxLength: 64 },
  targetIdentity: hash, sourceSetId: hash, world: QUESTION_WORLD_SCHEMA,
  anchors: FINITE_FEASIBILITY_REQUEST_SCHEMA.properties.anchors, observationEpoch: uint,
  solverOutcome: { enum: ['sat', 'unsat', 'unknown'] }, semanticOutcome: { enum: ['inModelWitness', 'inModelRefutation', 'unknown'] },
  profile: { const: FINITE_FEASIBILITY_PROFILE }, approximationKind: { enum: ['witnessed-supplied-finite-path', 'exact-supplied-finite-slice', 'unqualified'] },
  sourceMapping: { const: 'verified-source-bytes-and-spans; execution-translation-not-qualified' },
  exploration: object({ phase: { enum: ['explore', 'check-witness', 'check-refutation', 'witness', 'refutation', 'unsupported', 'unknown', 'checker-rejected'] },
    totalAssignments: uint, exploredAssignments: uint, checkedAssignments: uint, unknownAssignments: uint }),
  unsupported: object({ observations: list(object({ assignmentIndex: uint, block: id,
    reason: { type: 'string', minLength: 1, maxLength: 256 } }), 16), omitted: uint }),
  witness: nullable(object({ input: list(object({ input: id, value: { type: 'boolean' } }), 12), trace: list(id, 64, 1), terminal })),
  verification: { enum: ['not-established', 'independent-finite-forward-replay-v1'] },
  frontier: list(object({ reason: { enum: ['cyclic-control-flow-unsupported', 'encountered-unsupported-operation', 'independent-checker-rejected', 'work-budget'] },
    nextAssignment: uint, nextCheck: uint }), 1),
  closure: object({ sourceProgram: { const: 'not-established' }, finitePredicate: { enum: ['unknown', 'checked-in-supplied-model'] },
    heap: { const: 'unsupported' }, calls: { const: 'unsupported' }, solver: { const: 'finite-enumeration-no-smt' } }),
  cursor: nullable(object({ targetIdentity: hash, observationEpoch: uint, token: { type: 'string', minLength: 1, maxLength: 64 } })),
  work: object({ preparationMs: ms, sourceBytesVerified: uint, producerAssignments: uint, checkerAssignments: uint,
    producerSteps: uint, checkerSteps: uint, advanceCalls: uint, canceledCalls: uint, advanceMs: ms }) });

export const FINITE_FEASIBILITY_CLAIM_REQUEST_SCHEMA = object({ targetIdentity: hash, sourceSetId: hash, world: QUESTION_WORLD_SCHEMA,
  predicate: FINITE_FEASIBILITY_REQUEST_SCHEMA.properties.predicate, scope: { const: 'supplied-finite-model-only' } });
export const FINITE_FEASIBILITY_CLAIM_SCHEMA = object({ schemaVersion: { const: FINITE_FEASIBILITY_VERSION },
  kind: { const: 'checked-finite-feasibility-claim' }, claimId: hash, receiptId: hash,
  executionId: FINITE_FEASIBILITY_RESULT_SCHEMA.properties.executionId, observationEpoch: uint,
  targetIdentity: hash, sourceSetId: hash, world: QUESTION_WORLD_SCHEMA,
  scope: { const: 'supplied-finite-model-only' }, predicate: FINITE_FEASIBILITY_REQUEST_SCHEMA.properties.predicate,
  outcome: { enum: ['exists-in-finite-input-domain', 'absent-in-finite-input-domain'] },
  inputs: FINITE_FEASIBILITY_REQUEST_SCHEMA.properties.inputs, entryConditions: FINITE_FEASIBILITY_REQUEST_SCHEMA.properties.entryConditions,
  totalAssignments: uint, witness: FINITE_FEASIBILITY_RESULT_SCHEMA.properties.witness,
  verification: { const: 'independent-finite-forward-replay-v1' }, sourceProgram: { const: 'not-established' } });
