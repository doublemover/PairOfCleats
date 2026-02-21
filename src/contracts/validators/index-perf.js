import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  INDEX_PERF_CORPUS_MANIFEST_SCHEMA,
  INDEX_PERF_DELTA_REPORT_SCHEMA,
  INDEX_PERF_TELEMETRY_SCHEMA
} from '../schemas/index-perf.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  dialect: '2020'
});

const VALIDATE_CORPUS_MANIFEST = compileSchema(ajv, INDEX_PERF_CORPUS_MANIFEST_SCHEMA);
const VALIDATE_TELEMETRY = compileSchema(ajv, INDEX_PERF_TELEMETRY_SCHEMA);
const VALIDATE_DELTA_REPORT = compileSchema(ajv, INDEX_PERF_DELTA_REPORT_SCHEMA);

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

const toResult = (validator, payload) => {
  const ok = Boolean(validator(payload));
  return {
    ok,
    errors: ok || !validator.errors ? [] : validator.errors.map(formatError)
  };
};

export const validateIndexPerfCorpusManifest = (payload) => (
  toResult(VALIDATE_CORPUS_MANIFEST, payload)
);

export const validateIndexPerfTelemetry = (payload) => (
  toResult(VALIDATE_TELEMETRY, payload)
);

export const validateIndexPerfDeltaReport = (payload) => (
  toResult(VALIDATE_DELTA_REPORT, payload)
);
