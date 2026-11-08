import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { TUI_RECORDING_REQUEST_SCHEMAS } from '../schemas/tui-recording.js';
import { assertBoundedTuiRequest } from './tui-request.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = Object.fromEntries(Object.entries(TUI_RECORDING_REQUEST_SCHEMAS)
  .map(([name, schema]) => [name, compileSchema(ajv, schema)]));
export const assertTuiRecordingRequest = (kind, value) => {
  assertBoundedTuiRequest(value, { code: 'ERR_TUI_RECORDING_REQUEST', message: 'Malformed or oversized recording request.' });
  if (!Object.hasOwn(validators, kind) || !validators[kind](value)) {
    throw Object.assign(new TypeError('Malformed or oversized recording request.'), { code: 'ERR_TUI_RECORDING_REQUEST' });
  }
  return value;
};
