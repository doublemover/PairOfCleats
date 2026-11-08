import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { TUI_SEARCH_REQUEST_SCHEMAS, TUI_SEARCH_DIAGNOSTICS_SCHEMA } from '../schemas/tui-search.js';
import { assertBoundedTuiRequest } from './tui-request.js';
import { createSearchValidator } from '../../../tools/api/validation.js';

const ajv = createAjv({ allErrors: false, strict: true });
const validators = Object.fromEntries(Object.entries(TUI_SEARCH_REQUEST_SCHEMAS)
  .map(([name, schema]) => [name, compileSchema(ajv, schema)]));
const validateSearch = createSearchValidator();
const validateDiagnostics = compileSchema(ajv, TUI_SEARCH_DIAGNOSTICS_SCHEMA);
export const assertTuiSearchDiagnostics = value => {
  if (!validateDiagnostics(value)) throw Object.assign(new TypeError('Malformed search diagnostic projection.'), { code: 'ERR_TUI_SEARCH_OUTPUT' });
  return value;
};
const invalid = () => { throw Object.assign(new TypeError('Malformed or oversized TUI search request.'),
  { code: 'ERR_TUI_SEARCH_REQUEST' }); };

export const assertTuiSearchRequest = (kind, value) => {
  assertBoundedTuiRequest(value, { code: 'ERR_TUI_SEARCH_REQUEST', message: 'Malformed or oversized TUI search request.' });
  if (!validators[kind]?.(value)) invalid();
  if (kind === 'query') {
    // Scope, output and continuation authority belong to this operator, not an
    // arbitrary filter object. All remaining fields use the shared API owner.
    if (['repo', 'repoPath', 'cursor', 'output'].some(key => Object.hasOwn(value.search, key))
      || !validateSearch(value.search).ok) invalid();
  }
  return value;
};
