import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { TASK_SPAN_TRACE_SCHEMA } from '../schemas/task-span-trace.js';
import { toValidationResult } from './result.js';
const validator = compileSchema(createAjv({ allErrors: false, strict: true }), TASK_SPAN_TRACE_SCHEMA, { lazy: true });
export const validateTaskSpanTrace = value => toValidationResult(validator, value);
