import { semanticObject as object } from './semantic-envelopes.js';
import { REPOSITORY_ANSWER_REQUEST_SCHEMA } from './repository-answer.js';
import { CONTEXT_DELIVERY_CORE_SCHEMAS } from './context-delivery-core.js';
export * from './context-delivery-core.js';
export const CONTEXT_DELIVERY_SCHEMAS = { ...CONTEXT_DELIVERY_CORE_SCHEMAS,
  answerSelection: object({ answerRequest: REPOSITORY_ANSWER_REQUEST_SCHEMA.oneOf[0] }, {
    quoteRoles: { type: 'array', maxItems: 16, items: CONTEXT_DELIVERY_CORE_SCHEMAS.entry.properties.roles }
  })
};
