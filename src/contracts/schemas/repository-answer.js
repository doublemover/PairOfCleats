import { semanticObject as object, semanticInteger as uint } from './semantic-envelopes.js';
import { SEMANTIC_RECORD_REF_SCHEMA as ref } from './semantic.js';
import { REPOSITORY_QUERY_EXECUTION_REQUEST_SCHEMA } from './repository-question-live.js';
import { ANSWER_EVIDENCE_VERSION, ANSWER_QUESTION_REF_SCHEMA, ANSWER_REVISION_SCHEMA, ANSWER_PATCH_SCHEMA } from './answer-evidence.js';
const text = maximum => ({ type: 'string', minLength: 1, maxLength: maximum });
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const list = (items, maximum) => ({ type: 'array', items, maxItems: maximum });
const optional = { quoteRefs: { ...list(ref, 16), uniqueItems: true }, openRequirements: list(object({ id: text(256), text: text(2048) }), 64) };
const requestSchema = ({ query, questionRef, revision }) => {
  const common = { schemaVersion: { const: ANSWER_EVIDENCE_VERSION }, query, questionRef };
  return { type: 'object', oneOf: [object({ ...common, mode: { const: 'compile' } }, optional),
    object({ ...common, mode: { const: 'compare' }, previous: revision }, optional),
    object({ schemaVersion: { const: ANSWER_EVIDENCE_VERSION }, mode: { const: 'inspect' }, revision })] };
};
export const REPOSITORY_ANSWER_REQUEST_SCHEMA = requestSchema({ query: REPOSITORY_QUERY_EXECUTION_REQUEST_SCHEMA,
  questionRef: ANSWER_QUESTION_REF_SCHEMA, revision: ANSWER_REVISION_SCHEMA });
// The protocol catalog shares the same factory and definitions. Runtime capture
// uses the expanded owner schema; clients avoid receiving two complete copies
// of the historical revision contract and repeated execution-request schemas.
export const REPOSITORY_ANSWER_TOOL_SCHEMA = { ...requestSchema({ query: { $ref: '#/$defs/query' },
  questionRef: { $ref: '#/$defs/questionRef' }, revision: { $ref: '#/$defs/revision' } }),
$defs: { query: REPOSITORY_QUERY_EXECUTION_REQUEST_SCHEMA, questionRef: ANSWER_QUESTION_REF_SCHEMA, revision: ANSWER_REVISION_SCHEMA } };
const milliseconds = { type: 'number', minimum: 0 };
const work = object({ queryServiceElapsedMs: milliseconds, sourceElapsedMs: milliseconds, renderElapsedMs: milliseconds, totalElapsedMs: milliseconds });
const delivery = { schemaVersion: { const: ANSWER_EVIDENCE_VERSION }, continuation: { anyOf: [text(128), { type: 'null' }] },
  serializedBytes: uint, work };
export const REPOSITORY_ANSWER_RESULT_SCHEMA = { type: 'object', oneOf: [
  object({ ...delivery, kind: { const: 'repository-answer-page' }, answer: ANSWER_REVISION_SCHEMA }),
  object({ ...delivery, kind: { const: 'repository-answer-comparison' }, patch: ANSWER_PATCH_SCHEMA }),
  object({ schemaVersion: { const: ANSWER_EVIDENCE_VERSION }, kind: { const: 'repository-answer-inspection' },
    inspectedDigest: hash, questionRef: ANSWER_QUESTION_REF_SCHEMA, worldId: hash, claims: uint, fragments: uint,
    contentIntegrity: { const: 'verified-by-deterministic-recomputation' }, currentSourceAdmission: { const: 'not-established-by-content-inspection' }, serializedBytes: uint })
] };
