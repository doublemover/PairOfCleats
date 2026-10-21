import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { TUI_SETTINGS_REQUEST_SCHEMAS } from '../schemas/tui-settings.js';
import { assertBoundedTuiRequest } from './tui-request.js';

const ajv = createAjv({ allErrors: true, strict: true });
const validators = Object.fromEntries(Object.entries(TUI_SETTINGS_REQUEST_SCHEMAS)
  .map(([name, schema]) => [name, compileSchema(ajv, schema)]));
const invalid = () => { throw Object.assign(new TypeError('Malformed or oversized TUI settings request.'),
  { code: 'ERR_TUI_SETTINGS_REQUEST' }); };

/** Bound arbitrary JSON before recursive validators, stringification or redaction. */
export const assertTuiSettingsRequest = (kind, value) => {
  assertBoundedTuiRequest(value, { code: 'ERR_TUI_SETTINGS_REQUEST', message: 'Malformed or oversized TUI settings request.' });
  if (!validators[kind]?.(value)) invalid();
  return value;
};
