import { semanticObject as object } from './semantic-envelopes.js';
import { POSITIVE_RULE_MODEL_SCHEMAS } from './positive-rule-model.js';

export const POSITIVE_RULE_REPAIR_VERSION = 1;
const text = { type: 'string', minLength: 1, maxLength: 4096 };
const id = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_.-]{0,63}$' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const list = (items, maxItems) => ({ type: 'array', items, maxItems, uniqueItems: true });
const editFields = { id, revertAllowed: { type: 'boolean' }, userCost: { type: 'integer', minimum: 0, maximum: 1000000000 } };
export const POSITIVE_RULE_REPAIR_SCHEMAS = {
  problem: object({ schemaVersion: { const: POSITIVE_RULE_REPAIR_VERSION }, expectedBaselineRootId: hash,
    context: object({ investigationId: text, taskRevision: text, branchId: text, assumptionSetId: text }),
    proposedEdits: { ...list({ oneOf: [object({ ...editFields, kind: { const: 'add-support' }, support: POSITIVE_RULE_MODEL_SCHEMAS.support }),
      object({ ...editFields, kind: { const: 'remove-support' }, supportId: hash })] }, 16), minItems: 1 },
    forbiddenFacts: list(id, 128), preservedFacts: list(id, 128),
    objective: { const: 'revert-cardinality-then-user-cost-then-stable-edit-ids' } }),
  candidate: object({ problemId: hash, revertEditIds: list(id, 16) }),
  page: object({ problemId: hash, cursor: { anyOf: [{ type: 'string', minLength: 1, maxLength: 64 }, { type: 'null' }] } }, {
    limits: object({}, { candidates: { type: 'integer', minimum: 1, maximum: 256 }, workMs: { type: 'integer', minimum: 1, maximum: 250 },
      bytes: { type: 'integer', minimum: 1024, maximum: 131072 } })
  })
};
