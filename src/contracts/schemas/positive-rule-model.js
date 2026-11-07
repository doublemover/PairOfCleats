import { semanticObject as object } from './semantic-envelopes.js';
import { QUESTION_WORLD_SCHEMA, QUESTION_SOURCE_REFERENCE_SCHEMA } from './repository-question.js';

export const POSITIVE_RULE_MODEL_VERSION = 1;
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const list = (items, maxItems) => ({ type: 'array', maxItems, items });
const support = object({ factId: id, originId: hash, sourceRef: { anyOf: [QUESTION_SOURCE_REFERENCE_SCHEMA, { type: 'null' }] } });
const definition = object({ schemaVersion: { const: POSITIVE_RULE_MODEL_VERSION },
  facts: { ...list(object({ id, kind: { enum: ['edb', 'idb'] } }), 128), minItems: 1 },
  rules: list(object({ id, head: id, body: { ...list(id, 8), uniqueItems: true } }), 256) });
export const POSITIVE_RULE_MODEL_SCHEMAS = {
  input: object({ worldRef: QUESTION_WORLD_SCHEMA, definition, supports: list(support, 1024) }),
  delta: object({ expectedRootId: hash, removeSupportIds: { ...list(hash, 1024), uniqueItems: true }, addSupports: list(support, 1024) }),
  support, definition
};
