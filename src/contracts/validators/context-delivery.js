import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { CONTEXT_DELIVERY_SCHEMAS } from '../schemas/context-delivery.js';
const ajv = createAjv({ strict: true, allErrors: true });
const validators = Object.fromEntries(Object.entries(CONTEXT_DELIVERY_SCHEMAS).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const assertContextDelivery = (kind, value) => {
  if (!validators[kind]?.(value)) throw Object.assign(new TypeError('Invalid evidence-delivery ' + kind + '.'), { code: 'ERR_CONTEXT_DELIVERY_CONTRACT' });
  return value;
};
