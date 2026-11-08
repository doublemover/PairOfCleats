import { semanticObject as object, semanticHashSchema as hash } from './semantic-envelopes.js';
const text = { type: 'string', minLength: 1, maxLength: 128 };
export const RELATIONAL_JOIN_DEFINITION_SCHEMA = object({ schemaVersion: { const: 1 }, id: text,
  operator: { enum: ['inner-join', 'left-anti-join'] }, ruleVersion: text, configHash: hash, domainId: text,
  leftDomainId: text, rightDomainId: text });
export const RELATIONAL_JOIN_LIMITS = Object.freeze({ inputSupports: 256, outputSupports: 1024, retainedBytes: 1048576, work: 65536 });
