import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  INDEX_PERF_CORPUS_MANIFEST_SCHEMA,
  INDEX_PERF_DELTA_REPORT_SCHEMA,
  INDEX_PERF_TELEMETRY_SCHEMA
} from '../schemas/index-perf.js';
import { toValidationResult } from './result.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  dialect: '2020'
});

const VALIDATE_CORPUS_MANIFEST = compileSchema(ajv, INDEX_PERF_CORPUS_MANIFEST_SCHEMA);
const VALIDATE_TELEMETRY = compileSchema(ajv, INDEX_PERF_TELEMETRY_SCHEMA);
const VALIDATE_DELTA_REPORT = compileSchema(ajv, INDEX_PERF_DELTA_REPORT_SCHEMA);

export const validateIndexPerfCorpusManifest = (payload) => (
  toValidationResult(VALIDATE_CORPUS_MANIFEST, payload)
);

export const validateIndexPerfTelemetry = (payload) => (
  toValidationResult(VALIDATE_TELEMETRY, payload)
);

export const validateIndexPerfDeltaReport = (payload) => (
  toValidationResult(VALIDATE_DELTA_REPORT, payload)
);
