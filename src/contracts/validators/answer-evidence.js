import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { ANSWER_INPUT_SCHEMA, ANSWER_REVISION_SCHEMA, ANSWER_PATCH_SCHEMA } from '../schemas/answer-evidence.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = { input: compileSchema(ajv, ANSWER_INPUT_SCHEMA), revision: compileSchema(ajv, ANSWER_REVISION_SCHEMA), patch: compileSchema(ajv, ANSWER_PATCH_SCHEMA) };
export const assertAnswerEvidence = (kind, value) => {
  const validate = validators[kind];
  if (!validate || !validate(value)) throw Object.assign(new TypeError('Invalid answer evidence ' + kind + ': ' + ajv.errorsText(validate?.errors)),
    { code: 'ERR_ANSWER_EVIDENCE_CONTRACT' });
  return value;
};
