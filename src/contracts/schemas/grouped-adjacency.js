import { semanticObject as object, semanticHashSchema as hash } from './semantic-envelopes.js';
const text = { type: 'string', minLength: 1, maxLength: 128 };
export const GROUPED_ADJACENCY_DEFINITION_SCHEMA = object({ schemaVersion: { const: 1 }, id: text,
  operator: { const: 'grouped-adjacency' }, ruleVersion: text, configHash: hash,
  domainId: text, inputDomainId: text, groupBy: { enum: ['from', 'to'] } });
export const GROUPED_ADJACENCY_LIMITS = Object.freeze({ inputSupports: 256, groups: 256, retainedBytes: 1048576, work: 65536 });
