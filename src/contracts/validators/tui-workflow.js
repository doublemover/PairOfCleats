import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { TUI_WORKFLOW_REQUEST_SCHEMAS } from '../schemas/tui-workflow.js';
import { assertBoundedTuiRequest } from './tui-request.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = Object.fromEntries(Object.entries(TUI_WORKFLOW_REQUEST_SCHEMAS)
  .map(([name, schema]) => [name, compileSchema(ajv, schema)]));
export const assertTuiWorkflowRequest = (kind, value) => {
  assertBoundedTuiRequest(value, { code: 'ERR_TUI_WORKFLOW_REQUEST', message: 'Malformed or oversized workflow request.' });
  if (!Object.hasOwn(validators, kind) || !validators[kind](value)) {
    throw Object.assign(new TypeError('Malformed or oversized workflow request.'), { code: 'ERR_TUI_WORKFLOW_REQUEST' });
  }
  return value;
};
