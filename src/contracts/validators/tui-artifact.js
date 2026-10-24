import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { TUI_ARTIFACT_REQUEST_SCHEMAS } from '../schemas/tui-artifact.js';
import { assertBoundedTuiRequest } from './tui-request.js';

const ajv = createAjv({ allErrors: false, strict: true });
const validators = Object.fromEntries(Object.entries(TUI_ARTIFACT_REQUEST_SCHEMAS)
  .map(([name, schema]) => [name, compileSchema(ajv, schema)]));
export const assertTuiArtifactRequest = (kind, value) => {
  const code = 'ERR_TUI_ARTIFACT_REQUEST', message = 'Malformed or oversized TUI artifact request.';
  assertBoundedTuiRequest(value, { code, message });
  if (!Object.hasOwn(validators, kind) || !validators[kind](value)) throw Object.assign(new TypeError(message), { code });
  return value;
};
