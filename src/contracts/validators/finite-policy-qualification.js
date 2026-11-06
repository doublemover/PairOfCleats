import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { FINITE_POLICY_DOMAIN_SCHEMA, FINITE_POLICY_QUALIFICATION_SCHEMA, FINITE_POLICY_RECEIPT_SCHEMA } from '../schemas/finite-policy-qualification.js';
const schemas = { domain: FINITE_POLICY_DOMAIN_SCHEMA, spec: FINITE_POLICY_QUALIFICATION_SCHEMA, receipt: FINITE_POLICY_RECEIPT_SCHEMA };
const ajv = createAjv({ strict: true, allErrors: true });
const validators = Object.fromEntries(Object.entries(schemas).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const captureFinitePolicyQualification = (kind, input) => {
  if (!Object.hasOwn(schemas, kind)) throw new TypeError('Unknown finite policy qualification contract.');
  const result = captureSemanticRequest(input, schemas[kind]);
  if (!validators[kind](result)) throw Object.assign(new TypeError('Invalid finite policy qualification ' + kind + '.'), { code: 'ERR_FINITE_POLICY_QUALIFICATION' }); return result;
};
