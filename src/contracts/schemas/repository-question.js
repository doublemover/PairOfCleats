import { SEMANTIC_GENERATION_SCHEMA, semanticObject as object } from './semantic-envelopes.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref } from './semantic.js';

export const REPOSITORY_QUESTION_VERSION = 1;

const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const list = (items, maximum, minimum = 0) => ({ type: 'array', items, minItems: minimum, maxItems: maximum });
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]{0,63}$' };
const clauseId = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' };
const scalar = object({ type: { enum: ['string', 'number', 'boolean', 'null', 'bigint'] }, representation: { type: 'string', maxLength: 4096 } });
const generation = { ...SEMANTIC_GENERATION_SCHEMA, properties: { ...SEMANTIC_GENERATION_SCHEMA.properties, baseBuildId: text(4096) } };
export const QUESTION_WORLD_SCHEMA = object({ repositoryNamespace: text(4096), generation,
  sourceSnapshotId: text(4096), contextKey: text(4096), domainId: text(4096), producerId: text(4096) });
export const QUESTION_SCALAR_SCHEMA = scalar;
const scan = { oneOf: [object({ sourcePaths: { ...list(text(4096), 32, 1), uniqueItems: true }, invocationKind: { enum: ['call', 'optionalCall', 'construct', 'tag', 'import'] } }),
  object({ sourcePrefix: text(4096), invocationKind: { enum: ['call', 'optionalCall', 'construct', 'tag', 'import'] } })] };
export const REPOSITORY_QUESTION_SCHEMA = object({ schemaVersion: { const: REPOSITORY_QUESTION_VERSION }, world: QUESTION_WORLD_SCHEMA,
  semantics: { const: 'retained-facts' }, bind: list(object({ id, sort: { enum: ['Invocation', 'Declaration', 'Literal'] } }, { scan }), 16, 1),
  where: object({ all: list(object({ id: clauseId, predicate: text(128), args: list({ anyOf: [text(4096),
    { type: 'integer', minimum: 0, maximum: 4096 }, scalar] }, 4) }), 64) }),
  select: { ...list(text(65), 16, 1), uniqueItems: true }, distinctBy: { ...list(text(65), 16, 1), uniqueItems: true },
  order: object({ kind: { const: 'source-order' } }) });

export const QUESTION_SOURCE_REFERENCE_SCHEMA = object({ sourceUnitId: { type: 'string', pattern: '^su1:[a-f0-9]{64}$' },
  sourceHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, path: text(4096),
  span: list({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, 2, 2), coordinateUnit: { const: 'utf16' } });
const source = QUESTION_SOURCE_REFERENCE_SCHEMA;
const entity = { oneOf: [
  object({ ref, sort: { const: 'Invocation' }, source, invocationKind: { enum: ['call', 'optionalCall', 'construct', 'tag', 'import'] } }),
  object({ ref, sort: { const: 'Declaration' }, source, name: { type: 'string', maxLength: 4096 } }),
  object({ ref, sort: { const: 'Expression' }, source }),
  object({ ref, sort: { const: 'Literal' }, source, scalar: { anyOf: [scalar, { type: 'null' }] } })
] };
/** Explicit supplied facts are a reference model, never an admitted live store. */
export const FINITE_QUESTION_MODEL_SCHEMA = object({ schemaVersion: { const: REPOSITORY_QUESTION_VERSION }, world: QUESTION_WORLD_SCHEMA,
  domain: object({ state: { enum: ['complete', 'partial'] }, meaning: { const: 'supplied-finite-input' } }),
  entities: list(entity, 1024), targets: list(object({ id: text(256), invocation: ref, declaration: ref,
    certainty: { enum: ['exact-static', 'modeled', 'heuristic'] } }), 4096),
  operands: list(object({ id: text(256), invocation: ref, role: { const: 'argument' },
    ordinal: { type: 'integer', minimum: 0, maximum: 4096 }, child: { anyOf: [ref, { type: 'null' }] },
    flags: { ...list({ enum: ['spread', 'computed', 'shorthand', 'optional', 'rest', 'hole'] }, 6), uniqueItems: true } }), 4096) });

const uint = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const operator = { type: 'integer', minimum: 0, maximum: 63 };
const binding = { oneOf: [
  object({ variable: text(65), sort: { const: 'Invocation' }, ref, source, invocationKind: { enum: ['call', 'optionalCall', 'construct', 'tag', 'import'] } }),
  object({ variable: text(65), sort: { const: 'Declaration' }, ref, source, name: { type: 'string', maxLength: 4096 } }),
  object({ variable: text(65), sort: { const: 'Literal' }, ref, source, scalar: { anyOf: [scalar, { type: 'null' }] } })
] };
const witness = { oneOf: [object({ operatorId: operator, factId: text(256), certainty: { enum: ['exact-static', 'modeled', 'heuristic'] } }),
  object({ operatorId: operator, factId: text(256), positionMeaning: { const: 'syntactic-zero-based' } }), object({ operatorId: operator, ref })] };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
export const FINITE_QUESTION_RESULT_SCHEMA = object({ schemaVersion: { const: REPOSITORY_QUESTION_VERSION }, kind: { const: 'repository-question-finite-reference' },
  logicalPlanId: hash, physicalPlanId: hash, requestDigest: hash, modelId: hash, world: QUESTION_WORLD_SCHEMA,
  status: { enum: ['partial', 'complete-in-supplied-model'] }, rows: list(object({ bindings: list(binding, 16, 1), witnesses: list(witness, 64) }), 128),
  frontier: list(object({ operatorId: { anyOf: [operator, { type: 'null' }] }, reason: text(128) }, { ref }), 128),
  refutations: list(object({ operatorId: operator, reason: text(128), ref }), 128),
  completion: object({ enumeration: { enum: ['partial', 'complete-in-supplied-input'] }, domain: { enum: ['complete', 'partial'] },
    programSemantics: { const: 'not-established' }, rankedPrefix: { const: 'not-established' } }),
  counts: object({ returnedRows: uint, totalInSuppliedModel: { anyOf: [uint, { type: 'null' }] }, programTotal: { const: null } }),
  supportSelection: { const: 'one-deterministic-witness-per-row' }, verification: { const: 'supplied-finite-model' },
  diagnosticSelection: { const: 'bounded-observed-clause-failures' },
  work: object({ preparationRecords: uint, comparisons: uint, joinAdvances: uint, projectionComparisons: uint }),
  frontierOmitted: uint, refutationsOmitted: uint });
