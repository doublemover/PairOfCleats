import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_TASK_SCHEMA } from '../schemas/semantic-task.js';
import { createSemanticTaskId } from '../../index/semantic/identity.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validate = compileSchema(ajv, SEMANTIC_TASK_SCHEMA);
export const assertSemanticTask = (value) => {
  const valid = validate(value);
  if (!valid) throw Object.assign(new TypeError('Invalid semantic task: ' + ajv.errorsText(validate.errors)), { code: 'ERR_SEMANTIC_TASK_CONTRACT' });
  const expected = createSemanticTaskId({ kind: value.kind, inputHashes: value.inputHashes,
    policyHash: value.policyHash, targetSetHash: value.targetSetHash });
  if (value.taskId !== expected || new Set(value.dependencies.map(row => row.dependencyKey)).size !== value.dependencies.length) {
    throw Object.assign(new TypeError('Semantic task identity or dependency inventory mismatch.'), { code: 'ERR_SEMANTIC_TASK_CONTRACT' });
  }
  return value;
};
