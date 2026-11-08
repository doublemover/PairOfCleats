import { semanticObject as object, semanticInteger as uint } from './semantic-envelopes.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref } from './semantic.js';
import { REPOSITORY_QUESTION_SCHEMA, QUESTION_WORLD_SCHEMA as world, QUESTION_SCAN_SCHEMA as scan,
  QUESTION_BINDING_SCHEMA as binding, QUESTION_GENERATION_SCHEMA as generation, REPOSITORY_QUESTION_VERSION } from './repository-question.js';
import { QUESTION_SCALAR_SCHEMA } from './repository-question.js';

const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const list = (items, maximum) => ({ type: 'array', items, maxItems: maximum });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const bounded = maximum => ({ type: 'integer', minimum: 1, maximum });
const backend = { enum: ['artifact', 'sqlite'] };
const envelope = { schemaVersion: { const: REPOSITORY_QUESTION_VERSION }, repoRoot: text(4096), generation };
const limits = object({}, { records: bounded(128), bytes: { type: 'integer', minimum: 1024, maximum: 65536 }, workMs: bounded(250) });
const bindingRefs = object({ invocation: ref, declaration: ref, literal: ref });
export const REPOSITORY_QUERY_EXECUTION_REQUEST_SCHEMA = object({ ...envelope, mode: { const: 'execute' }, question: REPOSITORY_QUESTION_SCHEMA }, { backend,
  cursor: { anyOf: [text(128), { type: 'null' }] }, limits });
export const REPOSITORY_QUERY_REQUEST_SCHEMA = { type: 'object', oneOf: [
  object({ ...envelope, mode: { const: 'describe' }, scan }, { backend }),
  REPOSITORY_QUERY_EXECUTION_REQUEST_SCHEMA,
  object({ ...envelope, mode: { const: 'explain' }, question: REPOSITORY_QUESTION_SCHEMA, bindingRefs }, { backend,
    cursor: { anyOf: [text(128), { type: 'null' }] }, limits })
] };
const operatorId = { type: 'integer', minimum: 0, maximum: 63 };
const fact = object({ owner: ref, member: { enum: ['semantic_edges', 'semantic_operands'] }, offset: uint, rowHash: hash });
const witness = { oneOf: [object({ operatorId, ref }),
  object({ operatorId, meaning: { const: 'recorded-target-candidate' }, fact, contextKey: { anyOf: [text(65536), { type: 'null' }] },
    certainty: { enum: ['exact-static', 'modeled', 'heuristic'] } }),
  object({ operatorId, meaning: { const: 'syntactic-zero-based-argument' }, fact })] };
const diagnostic = object({ operatorId: { anyOf: [operatorId, { type: 'null' }] }, reason: text(128) }, { ref });
const originMap = list(object({ operatorId, authored: list(object({ clauseId: text(64),
  path: list({ anyOf: [text(64), uint] }, 8) }), 64) }), 64);
const tupleDetail = object({ repoRoot: text(4096), generation, refs: { type: 'array', minItems: 3, maxItems: 3, items: ref } },
  { include: { type: 'array', maxItems: 2, uniqueItems: true, items: { enum: ['names', 'operands'] } } });
export const REPOSITORY_QUERY_PAGE_SCHEMA = object({ schemaVersion: { const: REPOSITORY_QUESTION_VERSION },
  kind: { const: 'repository-question-indexed-page' }, profile: text(128), world, requestDigest: hash, logicalPlanId: hash, physicalPlanId: hash,
  status: { enum: ['partial', 'complete-in-retained-input'] }, rows: list(object({ rowId: hash, bindings: { ...list(binding, 3), minItems: 3 },
    witnesses: list(witness, 64), detailRequest: tupleDetail }), 128),
  originMap,
  frontier: list(diagnostic, 64), refutations: list(diagnostic, 64), frontierOmitted: uint, refutationsOmitted: uint,
  completion: object({ enumeration: { enum: ['partial', 'complete-in-retained-input'] },
    analysis: { enum: ['unobserved', 'incomplete', 'complete'] }, programSemantics: { const: 'not-established' }, rankedPrefix: { const: 'not-established' } }),
  counts: object({ returnedRows: uint, emittedThroughCursor: uint, unresolvedThroughCursor: uint,
    totalInRetainedRelation: { anyOf: [uint, { type: 'null' }] }, programTotal: { const: null } }),
  verification: { const: 'retained-records-and-source-headers' }, supportSelection: { const: 'one-deterministic-witness-per-row' },
  diagnosticSelection: { const: 'bounded-observed-clause-failures' }, cursor: { anyOf: [text(128), { type: 'null' }] },
  work: object({ steps: uint, elapsedMs: { type: 'number', minimum: 0 }, retainedStateBytes: uint }) });
/** Semantic receipt excludes random delivery cursors and invocation timing.
 * They remain on the original public page and are never reconstructed here. */
export const REPOSITORY_QUERY_RECEIPT_SCHEMA = object(Object.fromEntries(Object.entries(REPOSITORY_QUERY_PAGE_SCHEMA.properties)
  .filter(([key]) => !['cursor', 'work'].includes(key))));
export const REPOSITORY_QUERY_DESCRIPTION_SCHEMA = object({ schemaVersion: { const: REPOSITORY_QUESTION_VERSION },
  kind: { const: 'repository-question-capabilities' }, profile: text(128), world,
  predicates: list(object({ id: text(128), version: bounded(65536), meaning: text(128) }), 4),
  liveFragment: { const: 'one Invocation, one Declaration, one Literal; conjunctive target/argument producers and pure filters; select all three, Invocation first' },
  sourceDomain: { const: 'expression-bearing-retained-sources' }, programSemantics: { const: 'not-established' } });
const observedValue = { anyOf: [{ type: 'string', maxLength: 4096 }, QUESTION_SCALAR_SCHEMA, { type: 'null' }] };
export const REPOSITORY_QUERY_EXPLANATION_SCHEMA = object({ schemaVersion: { const: REPOSITORY_QUESTION_VERSION },
  kind: { const: 'repository-question-clause-page' }, profile: text(128), world, requestDigest: hash, logicalPlanId: hash, physicalPlanId: hash,
  bindingRefs, qualifiedBindings: list(binding, 3), originMap,
  clauses: list(object({ operatorId, status: { enum: ['satisfied-in-retained-input', 'refuted-in-retained-input', 'unknown'] },
    meaning: text(128), reason: text(128), witnesses: list(witness, 1) }, { expected: observedValue, actual: observedValue }), 64),
  questionAtBinding: { enum: ['incomplete', 'satisfied-in-retained-input', 'refuted-in-retained-input', 'unknown'] },
  frontier: list(diagnostic, 64), frontierOmitted: uint,
  completion: object({ clauses: { enum: ['partial', 'complete'] }, analysis: { enum: ['unobserved', 'incomplete', 'complete'] },
    programSemantics: { const: 'not-established' } }),
  counts: object({ returnedClauses: uint, evaluatedThroughCursor: uint, totalClauses: bounded(64) }),
  verification: { const: 'retained-records-and-source-headers' }, diagnosticSelection: { const: 'all-compiled-clauses-at-the-original-binding' },
  cursor: { anyOf: [text(128), { type: 'null' }] }, work: object({ steps: uint, elapsedMs: { type: 'number', minimum: 0 }, retainedStateBytes: uint }) });
