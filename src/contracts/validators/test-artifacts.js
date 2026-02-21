import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  TEST_COVERAGE_ARTIFACT_SCHEMA,
  TEST_TIMINGS_ARTIFACT_SCHEMA,
  TEST_PROFILE_ARTIFACT_SCHEMA
} from '../schemas/test-artifacts.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  dialect: '2020'
});

const VALIDATE_TEST_COVERAGE = compileSchema(ajv, TEST_COVERAGE_ARTIFACT_SCHEMA);
const VALIDATE_TEST_TIMINGS = compileSchema(ajv, TEST_TIMINGS_ARTIFACT_SCHEMA);
const VALIDATE_TEST_PROFILE = compileSchema(ajv, TEST_PROFILE_ARTIFACT_SCHEMA);

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

export const validateTestCoverageArtifact = (payload) => (
  toResult(VALIDATE_TEST_COVERAGE, payload)
);

export const validateTestTimingsArtifact = (payload) => (
  toResult(VALIDATE_TEST_TIMINGS, payload)
);

export const validateTestProfileArtifact = (payload) => (
  toResult(VALIDATE_TEST_PROFILE, payload)
);
