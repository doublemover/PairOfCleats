import { semanticObject as object, semanticInteger as uint } from './semantic-envelopes.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref } from './semantic.js';
import { SEMANTIC_DETAIL_REQUEST_SCHEMA } from './semantic-query.js';
import { REPOSITORY_QUESTION_SCHEMA, QUESTION_WORLD_SCHEMA as world, QUESTION_SCAN_SCHEMA as scan,
  QUESTION_BINDING_SCHEMA as binding, QUESTION_GENERATION_SCHEMA as generation, REPOSITORY_QUESTION_VERSION } from './repository-question.js';

const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const list = (items, maximum) => ({ type: 'array', items, maxItems: maximum });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const bounded = maximum => ({ type: 'integer', minimum: 1, maximum });
const backend = { enum: ['artifact', 'sqlite'] };
const envelope = { schemaVersion: { const: REPOSITORY_QUESTION_VERSION }, repoRoot: text(4096), generation };
const limits = object({}, { records: bounded(128), bytes: { type: 'integer', minimum: 1024, maximum: 65536 }, workMs: bounded(250) });
export const REPOSITORY_QUERY_REQUEST_SCHEMA = { type: 'object', oneOf: [
  object({ ...envelope, mode: { const: 'describe' }, scan }, { backend }),
  object({ ...envelope, mode: { const: 'execute' }, question: REPOSITORY_QUESTION_SCHEMA }, { backend,
    cursor: { anyOf: [text(128), { type: 'null' }] }, limits })
] };
const operatorId = { type: 'integer', minimum: 0, maximum: 63 };
const fact = object({ owner: ref, member: { enum: ['semantic_edges', 'semantic_operands'] }, offset: uint, rowHash: hash });
const witness = { oneOf: [object({ operatorId, ref }),
  object({ operatorId, meaning: { const: 'recorded-target-candidate' }, fact, contextKey: { anyOf: [text(65536), { type: 'null' }] },
    certainty: { enum: ['exact-static', 'modeled', 'heuristic'] } }),
  object({ operatorId, meaning: { const: 'syntactic-zero-based-argument' }, fact })] };
const diagnostic = object({ operatorId: { anyOf: [operatorId, { type: 'null' }] }, reason: text(128) }, { ref });
export const REPOSITORY_QUERY_PAGE_SCHEMA = object({ schemaVersion: { const: REPOSITORY_QUESTION_VERSION },
  kind: { const: 'repository-question-indexed-page' }, profile: text(128), world, requestDigest: hash, logicalPlanId: hash, physicalPlanId: hash,
  status: { enum: ['partial', 'complete-in-retained-input'] }, rows: list(object({ rowId: hash, bindings: list(binding, 3),
    witnesses: list(witness, 64), detailRequest: SEMANTIC_DETAIL_REQUEST_SCHEMA }), 128),
  originMap: list(object({ operatorId, authored: list(object({ clauseId: text(64),
    path: list({ anyOf: [text(64), uint] }, 8) }), 64) }), 64),
  frontier: list(diagnostic, 64), refutations: list(diagnostic, 64), frontierOmitted: uint, refutationsOmitted: uint,
  completion: object({ enumeration: { enum: ['partial', 'complete-in-retained-input'] },
    analysis: { enum: ['unobserved', 'incomplete', 'complete'] }, programSemantics: { const: 'not-established' }, rankedPrefix: { const: 'not-established' } }),
  counts: object({ returnedRows: uint, emittedThroughCursor: uint, unresolvedThroughCursor: uint,
    totalInRetainedRelation: { anyOf: [uint, { type: 'null' }] }, programTotal: { const: null } }),
  verification: { const: 'retained-records-and-source-headers' }, supportSelection: { const: 'one-deterministic-witness-per-row' },
  diagnosticSelection: { const: 'bounded-observed-clause-failures' }, cursor: { anyOf: [text(128), { type: 'null' }] },
  work: object({ steps: uint, elapsedMs: { type: 'number', minimum: 0 }, retainedStateBytes: uint }) });
export const REPOSITORY_QUERY_DESCRIPTION_SCHEMA = object({ schemaVersion: { const: REPOSITORY_QUESTION_VERSION },
  kind: { const: 'repository-question-capabilities' }, profile: text(128), world,
  predicates: list(object({ id: text(128), version: bounded(65536), meaning: text(128) }), 4),
  liveFragment: { const: 'one Invocation, one Declaration, one Literal; conjunctive target/argument producers and pure filters; select all three, Invocation first' },
  sourceDomain: { const: 'expression-bearing-retained-sources' }, programSemantics: { const: 'not-established' } });
