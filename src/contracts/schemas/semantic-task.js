import { semanticObject as object, semanticInteger as integer, semanticHashSchema as hash, semanticText as text } from './semantic-envelopes.js';
export const SEMANTIC_TASK_KINDS = ['extract', 'bind', 'localFlow', 'crossFileFlow', 'boundaryModels', 'runtimeJoin'];
export const SEMANTIC_TASK_SCHEMA = object({
  schemaVersion: { const: 1 }, taskId: { type: 'string', pattern: '^st1:[a-f0-9]{64}$' },
  kind: { enum: SEMANTIC_TASK_KINDS }, baseBuildId: text,
  sourceUnits: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', pattern: '^su1:[a-f0-9]{64}$' } },
  inputHashes: { type: 'array', minItems: 1, uniqueItems: true, items: hash }, policyHash: hash,
  targetSetHash: hash, targetsRef: text,
  dependencies: { type: 'array', items: object({ dependencyKey: text, expectedHash: hash }) },
  priority: integer, reason: text,
  coverageToProduce: { type: 'array', minItems: 1, uniqueItems: true,
    items: { enum: ['syntax', 'bindings', 'localFlow', 'crossFileFlow', 'boundaryModels', 'runtimeJoin'] } }
});
