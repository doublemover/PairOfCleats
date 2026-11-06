import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { POSITIVE_RULE_REPAIR_SCHEMAS } from '../schemas/positive-rule-repair.js';
const ajv = createAjv({ strict: true, allErrors: true });
const validators = Object.fromEntries(Object.entries(POSITIVE_RULE_REPAIR_SCHEMAS).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const assertPositiveRuleRepair = (kind, value) => {
  if (!validators[kind]?.(value)) throw Object.assign(new TypeError('Invalid finite positive-rule repair ' + kind + '.'), { code: 'ERR_POSITIVE_RULE_REPAIR_CONTRACT' });
  return value;
};
