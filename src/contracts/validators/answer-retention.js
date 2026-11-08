import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { ANSWER_RETENTION_SCHEMAS } from '../schemas/answer-retention.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = Object.fromEntries(Object.entries(ANSWER_RETENTION_SCHEMAS).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const assertAnswerRetention = (kind, value) => {
  if (!validators[kind]?.(value)) throw Object.assign(new TypeError('Invalid retained answer ' + kind + '.'), { code: 'ERR_ANSWER_RETENTION_INTEGRITY' });
  return value;
};
