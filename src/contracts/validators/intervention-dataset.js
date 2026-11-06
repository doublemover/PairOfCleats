import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { INTERVENTION_DATASET_SCHEMA } from '../schemas/intervention-dataset.js';
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), INTERVENTION_DATASET_SCHEMA);
export const assertInterventionDataset = value => {
  if (!validate(value)) throw Object.assign(new TypeError('Invalid explicit offline intervention dataset section.'), { code: 'ERR_EVAL_INTERVENTION_INPUT' }); return value;
};
