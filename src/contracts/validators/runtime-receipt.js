import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { RUNTIME_ATTEMPT_SCHEMA } from '../schemas/runtime-receipt.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validate = compileSchema(ajv, RUNTIME_ATTEMPT_SCHEMA);
export const assertRuntimeAttempt = (value) => {
  if (!validate(value)) throw Object.assign(new TypeError(`Invalid runtime receipt: ${ajv.errorsText(validate.errors)}`), { code: 'ERR_RUNTIME_RECEIPT_CONTRACT' });
  return value;
};
