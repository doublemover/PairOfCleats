import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { ANSWER_INTEGRITY_EVALUATION_SCHEMA } from '../schemas/answer-integrity-evaluation.js';
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), ANSWER_INTEGRITY_EVALUATION_SCHEMA);
export const assertAnswerIntegrityEvaluation = value => {
  if (!validate(value)) throw Object.assign(new TypeError('Invalid answer integrity evaluation.'), { code: 'ERR_ANSWER_INTEGRITY_INPUT' }); return value;
};
