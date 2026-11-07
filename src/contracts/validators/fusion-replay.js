import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { FUSION_REPLAY_RECORD_SCHEMA } from '../schemas/fusion-replay.js';
import { toValidationResult } from './result.js';
const ajv = createAjv({ allErrors: false, strict: true });
const validator = compileSchema(ajv, FUSION_REPLAY_RECORD_SCHEMA, { lazy: true });
export const validateFusionReplayRecord = value => toValidationResult(validator, value);
