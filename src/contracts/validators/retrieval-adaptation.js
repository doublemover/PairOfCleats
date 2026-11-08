import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { captureSemanticRequest } from '../../semantic/request-snapshot.js';
import { DIRECTIONAL_QUERY_ARTIFACT_SCHEMA, DIRECTIONAL_QUERY_SPEC_SCHEMA,
  DIRECTIONAL_QUERY_CONTRACT_SCHEMA, DIRECTIONAL_DOCUMENT_CONTRACT_SCHEMA,
  RETRIEVAL_TRAINING_RUN_SCHEMA, RETRIEVAL_TRAINING_CHECKPOINT_SCHEMA } from '../schemas/retrieval-adaptation.js';

const schemas = { artifact: DIRECTIONAL_QUERY_ARTIFACT_SCHEMA, spec: DIRECTIONAL_QUERY_SPEC_SCHEMA,
  query: DIRECTIONAL_QUERY_CONTRACT_SCHEMA, document: DIRECTIONAL_DOCUMENT_CONTRACT_SCHEMA,
  run: RETRIEVAL_TRAINING_RUN_SCHEMA, checkpoint: RETRIEVAL_TRAINING_CHECKPOINT_SCHEMA };
const ajv = createAjv({ strict: true, allErrors: true });
const validators = Object.fromEntries(Object.entries(schemas).map(([key, schema]) => [key, compileSchema(ajv, schema)]));
export const captureRetrievalAdaptation = (kind, input) => {
  if (!Object.hasOwn(schemas, kind)) throw new TypeError('Unknown retrieval adaptation contract.');
  const value = captureSemanticRequest(input, schemas[kind]);
  if (!validators[kind](value)) throw Object.assign(new TypeError('Invalid retrieval adaptation ' + kind + '.'), { code: 'ERR_RETRIEVAL_ADAPTATION_CONTRACT' });
  return value;
};
