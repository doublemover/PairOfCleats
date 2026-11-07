import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { FINITE_MODEL_INTERVENTION_SCHEMA } from '../schemas/finite-model-intervention.js';
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), FINITE_MODEL_INTERVENTION_SCHEMA);
export const assertFiniteModelIntervention = value => {
  if (!validate(value)) throw Object.assign(new TypeError('Invalid finite-model intervention specification.'), { code: 'ERR_FINITE_MODEL_INTERVENTION_CONTRACT' }); return value;
};
