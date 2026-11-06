import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { REPOSITORY_QUESTION_SCHEMA, FINITE_QUESTION_MODEL_SCHEMA, FINITE_QUESTION_RESULT_SCHEMA, QUESTION_SCAN_SCHEMA } from '../schemas/repository-question.js';

const ajv = createAjv({ allErrors: true, strict: true });
const validators = { request: compileSchema(ajv, REPOSITORY_QUESTION_SCHEMA), scan: compileSchema(ajv, QUESTION_SCAN_SCHEMA),
  finiteModel: compileSchema(ajv, FINITE_QUESTION_MODEL_SCHEMA), finiteResult: compileSchema(ajv, FINITE_QUESTION_RESULT_SCHEMA) };
export const assertRepositoryQuestion = (kind, value) => {
  const validate = validators[kind];
  if (!validate || !validate(value)) throw Object.assign(new TypeError('Invalid repository question ' + kind + ': ' + ajv.errorsText(validate?.errors)),
    { code: kind === 'request' ? 'ERR_SEMANTIC_QUERY_CONTRACT' : kind === 'finiteModel' ? 'ERR_REPOSITORY_QUESTION_MODEL' : 'ERR_REPOSITORY_QUESTION_RESULT' });
  if (kind === 'finiteResult' && (value.counts.returnedRows !== value.rows.length
    || value.status === 'partial' && value.counts.totalInSuppliedModel !== null
    || value.status === 'complete-in-supplied-model' && (value.completion.enumeration !== 'complete-in-supplied-input'
      || value.completion.domain !== 'complete' || value.frontier.length || value.frontierOmitted
      || value.counts.totalInSuppliedModel !== value.rows.length))) throw Object.assign(new TypeError('Inconsistent finite question completion/count accounting.'),
    { code: 'ERR_REPOSITORY_QUESTION_RESULT' });
  return value;
};
