import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { VECTOR_EVALUATION_RECORD_SCHEMA } from '../schemas/vector-evaluation.js';
import { toValidationResult } from './result.js';
const ajv = createAjv({ allErrors: false, strict: true });
const validate = compileSchema(ajv, VECTOR_EVALUATION_RECORD_SCHEMA, { lazy: true });
export const validateVectorEvaluationRecord = value => toValidationResult(validate, value);
