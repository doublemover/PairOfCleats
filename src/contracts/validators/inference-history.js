import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { INFERENCE_HISTORY_ACCESS_SCHEMA } from '../schemas/inference-history.js';
import { toValidationResult } from './result.js';

const validate = compileSchema(createAjv({ allErrors: true, strict: true, dialect: '2020' }),
  INFERENCE_HISTORY_ACCESS_SCHEMA);

export const validateInferenceHistoryAccess = (payload) => toValidationResult(validate, payload);
