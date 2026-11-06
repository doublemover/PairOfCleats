import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { REPOSITORY_QUERY_REQUEST_SCHEMA, REPOSITORY_QUERY_PAGE_SCHEMA, REPOSITORY_QUERY_DESCRIPTION_SCHEMA, REPOSITORY_QUERY_EXPLANATION_SCHEMA, REPOSITORY_QUERY_RECEIPT_SCHEMA } from '../schemas/repository-question-live.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = { request: compileSchema(ajv, REPOSITORY_QUERY_REQUEST_SCHEMA), page: compileSchema(ajv, REPOSITORY_QUERY_PAGE_SCHEMA),
  description: compileSchema(ajv, REPOSITORY_QUERY_DESCRIPTION_SCHEMA), explanation: compileSchema(ajv, REPOSITORY_QUERY_EXPLANATION_SCHEMA),
  receipt: compileSchema(ajv, REPOSITORY_QUERY_RECEIPT_SCHEMA) };
export const assertRepositoryQuery = (kind, value) => {
  const validate = validators[kind];
  if (!validate || !validate(value)) throw Object.assign(new TypeError('Invalid repository query ' + kind + ': ' + ajv.errorsText(validate?.errors)),
    { code: kind === 'request' ? 'ERR_SEMANTIC_QUERY_CONTRACT' : 'ERR_REPOSITORY_QUESTION_RESULT' });
  if (['page', 'receipt'].includes(kind) && (value.counts.returnedRows !== value.rows.length
    || value.counts.emittedThroughCursor < value.rows.length
    || value.status === 'partial' && value.counts.totalInRetainedRelation !== null
    || value.status === 'complete-in-retained-input' && (value.completion.enumeration !== 'complete-in-retained-input'
      || kind === 'page' && value.cursor !== null || value.counts.unresolvedThroughCursor !== 0
      || value.frontier.length !== 0 || value.frontierOmitted !== 0
      || value.counts.totalInRetainedRelation !== value.counts.emittedThroughCursor))) {
    throw Object.assign(new TypeError('Inconsistent repository question completion/counts.'), { code: 'ERR_REPOSITORY_QUESTION_RESULT' });
  }
  if (kind === 'explanation' && (value.counts.returnedClauses !== value.clauses.length
    || value.counts.evaluatedThroughCursor < value.clauses.length || value.counts.evaluatedThroughCursor > value.counts.totalClauses
    || value.completion.clauses === 'complete' && (value.cursor !== null || value.counts.evaluatedThroughCursor !== value.counts.totalClauses
      || value.questionAtBinding === 'incomplete')
    || value.completion.clauses === 'partial' && (value.cursor === null || value.questionAtBinding !== 'incomplete'))) {
    throw Object.assign(new TypeError('Inconsistent repository clause explanation completion/counts.'), { code: 'ERR_REPOSITORY_QUESTION_RESULT' });
  }
  return value;
};
