import { HISTORY_AGENT_REQUESTS } from './inference-history-agent.js';
const identity = { type: 'string', minLength: 1, maxLength: 512 };

// This envelope is produced by trusted host policy, never by an export or client.
export const INFERENCE_HISTORY_ACCESS_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'inference-history-access',
  type: 'object',
  additionalProperties: false,
  required: ['principalId', 'tenantId', 'ownerType', 'ownerId', 'sourceScope', 'policyEpoch', 'allowed'],
  properties: {
    principalId: identity,
    tenantId: identity,
    ownerType: { enum: ['individual', 'organization', 'collection'] },
    ownerId: identity,
    sourceScope: identity,
    policyEpoch: identity,
    allowed: { const: true }
  }
};

export const INFERENCE_HISTORY_SCHEMA_DEFS = {
  'inference-history-access': INFERENCE_HISTORY_ACCESS_SCHEMA,
  ...Object.fromEntries(Object.entries(HISTORY_AGENT_REQUESTS).map(([name, value]) => ['inference-history-agent-' + name, value]))
};
