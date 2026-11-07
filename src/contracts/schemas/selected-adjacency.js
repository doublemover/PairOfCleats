import { semanticObject as object, semanticHashSchema as hash, semanticNullable as nullable } from './semantic-envelopes.js';
const text = { type: 'string', minLength: 1, maxLength: 128 };
const endpoint = { enum: ['from', 'to'] };
export const SELECTED_ADJACENCY_DEFINITION_SCHEMA = object({ schemaVersion: { const: 1 }, id: text,
  operator: { const: 'select-project-adjacency' }, ruleVersion: text, configHash: hash, domainId: text, inputDomainId: text,
  whereField: nullable(endpoint), whereEquals: nullable({ type: 'string', minLength: 1, maxLength: 4096 }),
  projectFrom: endpoint, projectTo: endpoint });
export const SELECTED_ADJACENCY_LIMITS = Object.freeze({ inputSupports: 256, outputSupports: 256, retainedBytes: 1048576, work: 65536 });
