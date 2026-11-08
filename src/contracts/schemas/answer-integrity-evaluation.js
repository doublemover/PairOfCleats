import { semanticObject as object } from './semantic-envelopes.js';
import { ANSWER_REVISION_SCHEMA } from './answer-evidence.js';
export const ANSWER_INTEGRITY_CASES = Object.freeze(['identity-control', 'moved-citation', 'negated-predicate', 'changed-numeric-value',
  'removed-qualification', 'wrong-world', 'changed-quotation', 'replacement-input-control']);
export const ANSWER_INTEGRITY_EVALUATION_SCHEMA = object({ schemaVersion: { const: 1 }, revision: ANSWER_REVISION_SCHEMA,
  cases: { type: 'array', items: { enum: ANSWER_INTEGRITY_CASES }, minItems: 1, maxItems: ANSWER_INTEGRITY_CASES.length, uniqueItems: true } });
