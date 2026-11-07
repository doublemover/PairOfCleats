import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { INTERVENTION_DATASET_SCHEMA } from '../schemas/intervention-dataset.js';
import { captureSemanticRequest, isSemanticRequestContractFailure } from '../../semantic/request-snapshot.js';
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), INTERVENTION_DATASET_SCHEMA);
export const assertInterventionDataset = value => {
  let owned;
  try { owned = captureSemanticRequest(value, INTERVENTION_DATASET_SCHEMA); }
  catch (cause) {
    if (!isSemanticRequestContractFailure(cause)) throw cause;
    throw Object.assign(new TypeError('Invalid explicit offline intervention dataset section.', { cause }), { code: 'ERR_EVAL_INTERVENTION_INPUT' });
  }
  if (!validate(owned)) throw Object.assign(new TypeError('Invalid explicit offline intervention dataset section.'), { code: 'ERR_EVAL_INTERVENTION_INPUT' }); return owned;
};
