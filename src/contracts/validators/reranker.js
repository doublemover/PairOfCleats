import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { LOCAL_CROSS_ENCODER_PROFILE_SCHEMA } from '../schemas/reranker.js';
import { toValidationResult } from './result.js';
const validator = compileSchema(createAjv({ allErrors: false, strict: true }), LOCAL_CROSS_ENCODER_PROFILE_SCHEMA, { lazy: true });
export const validateLocalCrossEncoderProfile = value => toValidationResult(validator, value);
