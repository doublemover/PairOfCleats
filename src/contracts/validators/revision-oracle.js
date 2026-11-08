import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { canonicalSemanticJson } from '../../index/semantic/identity.js';
import { REVISION_ORACLE_SCHEMAS } from '../schemas/revision-oracle.js';

const ajv = createAjv({ strict: true, allErrors: true });
const validators = Object.fromEntries(Object.entries(REVISION_ORACLE_SCHEMAS).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const captureRevisionOracle = (kind, input) => {
  if (!Object.hasOwn(validators, kind)) throw new TypeError('Unknown revision oracle contract.');
  const value = captureSemanticRequest(input, REVISION_ORACLE_SCHEMAS[kind]);
  if (!validators[kind](value)) throw Object.assign(new TypeError('Invalid revision oracle ' + kind + '.'), { code: 'ERR_REVISION_ORACLE_CONTRACT' });
  canonicalSemanticJson(value, { maxBytes: 1024 * 1024 }); return value;
};
