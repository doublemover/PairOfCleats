import { semanticObject as object, semanticInteger as uint } from './semantic-envelopes.js';
import { ANSWER_QUESTION_REF_SCHEMA, ANSWER_REVISION_SCHEMA } from './answer-evidence.js';

export const ANSWER_RETENTION_VERSION = 1;
export const ANSWER_RETENTION_MAX_OBJECTS = 4096;
export const ANSWER_RETENTION_MAX_SLOTS = 256;
export const ANSWER_RETENTION_MAX_BYTES = 32 * 1024 * 1024;
export const ANSWER_RETENTION_HASH_SCHEMA = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const hash = ANSWER_RETENTION_HASH_SCHEMA;
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const version = { const: ANSWER_RETENTION_VERSION };
const intent = object({ epoch: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  intentId: { type: 'string', pattern: '^[a-f0-9-]{36}$' }, questionRef: ANSWER_QUESTION_REF_SCHEMA,
  worldId: hash, expectedBaseDigest: nullable(hash) });
const current = object({ answerDigest: hash, manifestHash: hash, questionRef: ANSWER_QUESTION_REF_SCHEMA, worldId: hash });
export const ANSWER_RETENTION_INTENT_SCHEMA = intent;
export const ANSWER_RETENTION_RECEIPT_SCHEMA = object({ ...current.properties, epoch: uint });
export const ANSWER_RETENTION_OPTION_SCHEMA = object({ expectedBaseDigest: nullable(hash) }, { resumeIntent: intent });
export const ANSWER_RETENTION_SCHEMAS = {
  marker: object({ schemaVersion: version, kind: { const: 'retained-answers' }, repositoryNamespace: { type: 'string', minLength: 1, maxLength: 4096 } }),
  begin: object({ questionRef: ANSWER_QUESTION_REF_SCHEMA, worldId: hash, expectedBaseDigest: nullable(hash) }),
  intent,
  receipt: ANSWER_RETENTION_RECEIPT_SCHEMA,
  head: object({ schemaVersion: version, kind: { const: 'retained-answer-head' }, questionId: { type: 'string', minLength: 1, maxLength: 256 },
    epoch: uint, current: nullable(current), pending: nullable(intent) }),
  manifest: object({ schemaVersion: version, kind: { const: 'retained-answer-manifest' }, answerDigest: hash,
    fields: object(Object.fromEntries(Object.entries(ANSWER_REVISION_SCHEMA.properties)
      .filter(([key]) => !['inputs', 'claims', 'fragments'].includes(key)))), inputs: hash,
    claims: { type: 'array', maxItems: 145, items: hash }, fragments: hash }),
  input: object({ schemaVersion: version, kind: { const: 'retained-answer-input' }, value: ANSWER_REVISION_SCHEMA.properties.inputs }),
  support: object({ schemaVersion: version, kind: { const: 'retained-answer-support' }, value: ANSWER_REVISION_SCHEMA.properties.claims.items.properties.support }),
  claim: object({ schemaVersion: version, kind: { const: 'retained-answer-claim' },
    value: object(Object.fromEntries(Object.entries(ANSWER_REVISION_SCHEMA.properties.claims.items.properties).filter(([key]) => key !== 'support'))), support: hash }),
  fragments: object({ schemaVersion: version, kind: { const: 'retained-answer-fragments' }, value: ANSWER_REVISION_SCHEMA.properties.fragments })
};
