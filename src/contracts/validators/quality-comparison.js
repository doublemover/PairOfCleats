import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { PAIRED_QUALITY_REQUEST_SCHEMA } from '../schemas/quality-comparison.js';
import { toValidationResult } from './result.js';
const validator = compileSchema(createAjv({ allErrors: false, strict: true }), PAIRED_QUALITY_REQUEST_SCHEMA, { lazy: true });
export const validatePairedQualityRequest = value => toValidationResult(validator, value);
