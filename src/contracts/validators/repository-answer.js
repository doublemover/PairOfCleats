import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { REPOSITORY_ANSWER_REQUEST_SCHEMA, REPOSITORY_ANSWER_RESULT_SCHEMA } from '../schemas/repository-answer.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = { request: compileSchema(ajv, REPOSITORY_ANSWER_REQUEST_SCHEMA), result: compileSchema(ajv, REPOSITORY_ANSWER_RESULT_SCHEMA) };
export const assertRepositoryAnswer = (kind, value) => {
  const validate = validators[kind];
  if (!validate || !validate(value)) throw Object.assign(new TypeError('Invalid repository answer ' + kind + ': ' + ajv.errorsText(validate?.errors)),
    { code: kind === 'request' ? 'ERR_SEMANTIC_QUERY_CONTRACT' : 'ERR_ANSWER_EVIDENCE_CONTRACT' });
  return value;
};
