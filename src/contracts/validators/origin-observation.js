import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { ORIGIN_OBSERVATION_SCHEMA } from '../schemas/origin-observation.js';
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), ORIGIN_OBSERVATION_SCHEMA);
export const assertOriginObservation = value => {
  if (!validate(value)) throw Object.assign(new TypeError('Invalid origin-observation input.'), { code: 'ERR_ORIGIN_OBSERVATION_CONTRACT' }); return value;
};
