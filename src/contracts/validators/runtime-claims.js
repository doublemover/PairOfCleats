import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { RUNTIME_CLAIMS_SCHEMAS } from '../schemas/runtime-claims.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = new Map(Object.entries(RUNTIME_CLAIMS_SCHEMAS).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const assertRuntimeClaims = (kind, value) => {
  const validate = validators.get(kind);
  if (!validate || !validate(value)) throw Object.assign(new TypeError('Invalid runtime claims ' + kind + ': ' + ajv.errorsText(validate?.errors)),
    { code: 'ERR_RUNTIME_CLAIMS_CONTRACT' });
  return value;
};
