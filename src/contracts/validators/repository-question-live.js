import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { REPOSITORY_QUERY_REQUEST_SCHEMA, REPOSITORY_QUERY_PAGE_SCHEMA, REPOSITORY_QUERY_DESCRIPTION_SCHEMA } from '../schemas/repository-question-live.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = { request: compileSchema(ajv, REPOSITORY_QUERY_REQUEST_SCHEMA), page: compileSchema(ajv, REPOSITORY_QUERY_PAGE_SCHEMA),
  description: compileSchema(ajv, REPOSITORY_QUERY_DESCRIPTION_SCHEMA) };
export const assertRepositoryQuery = (kind, value) => {
  const validate = validators[kind];
  if (!validate || !validate(value)) throw Object.assign(new TypeError('Invalid repository query ' + kind + ': ' + ajv.errorsText(validate?.errors)),
    { code: kind === 'request' ? 'ERR_SEMANTIC_QUERY_CONTRACT' : 'ERR_REPOSITORY_QUESTION_RESULT' });
  if (kind === 'page' && (value.counts.returnedRows !== value.rows.length
    || value.counts.emittedThroughCursor < value.rows.length
    || value.status === 'partial' && value.counts.totalInRetainedRelation !== null
    || value.status === 'complete-in-retained-input' && (value.completion.enumeration !== 'complete-in-retained-input'
      || value.cursor !== null || value.counts.totalInRetainedRelation !== value.counts.emittedThroughCursor))) {
    throw Object.assign(new TypeError('Inconsistent repository question completion/counts.'), { code: 'ERR_REPOSITORY_QUESTION_RESULT' });
  }
  return value;
};
