import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { POSITIVE_RULE_MODEL_SCHEMAS } from '../schemas/positive-rule-model.js';
const ajv = createAjv({ strict: true, allErrors: true });
const validators = Object.fromEntries(Object.entries(POSITIVE_RULE_MODEL_SCHEMAS).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const assertPositiveRuleModel = (kind, value) => {
  if (!validators[kind]?.(value)) throw Object.assign(new TypeError('Invalid finite positive-rule ' + kind + '.'), { code: 'ERR_POSITIVE_RULE_MODEL_CONTRACT' });
  return value;
};
