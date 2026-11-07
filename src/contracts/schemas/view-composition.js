import { semanticObject as object, semanticHashSchema as hash } from './semantic-envelopes.js';
import { SELECTED_ADJACENCY_DEFINITION_SCHEMA } from './selected-adjacency.js';
import { GROUPED_ADJACENCY_DEFINITION_SCHEMA } from './grouped-adjacency.js';
import { RELATIONAL_JOIN_DEFINITION_SCHEMA } from './relational-join.js';

const text = { type: 'string', minLength: 1, maxLength: 128 };
const aggregate = { enum: ['key', 'supportCount', 'weightedCount', 'distinctValueCount', 'minimum', 'maximum'] };
export const VIEW_COMPOSITION_DEFINITION_SCHEMA = object({ schemaVersion: { const: 1 }, id: text,
  ruleVersion: text, configHash: hash,
  inputs: { type: 'array', minItems: 1, maxItems: 16, items: object({ id: text, domainId: text }) },
  stages: { type: 'array', minItems: 1, maxItems: 16, items: { oneOf: [
    object({ id: text, kind: { const: 'select' }, input: text, definition: SELECTED_ADJACENCY_DEFINITION_SCHEMA }),
    object({ id: text, kind: { const: 'join' }, left: text, right: text, definition: RELATIONAL_JOIN_DEFINITION_SCHEMA }),
    object({ id: text, kind: { const: 'group' }, input: text, definition: GROUPED_ADJACENCY_DEFINITION_SCHEMA,
      projectFrom: aggregate, projectTo: aggregate })
  ] } },
  outputs: { type: 'array', minItems: 1, maxItems: 16, uniqueItems: true, items: text }
});
export const VIEW_COMPOSITION_LIMITS = Object.freeze({ retainedBytes: 8 * 1024 * 1024, work: 262144, revisions: 128 });
