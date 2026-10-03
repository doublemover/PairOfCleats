import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  TEST_COVERAGE_ARTIFACT_SCHEMA,
  TEST_COVERAGE_POLICY_REPORT_SCHEMA,
  TEST_TIMINGS_ARTIFACT_SCHEMA,
  TEST_PROFILE_ARTIFACT_SCHEMA,
  TEST_STABILITY_ARTIFACT_SCHEMA
} from '../schemas/test-artifacts.js';
import { toValidationResult } from './result.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true,
  dialect: '2020'
});

const VALIDATE_TEST_COVERAGE = compileSchema(ajv, TEST_COVERAGE_ARTIFACT_SCHEMA);
const VALIDATE_TEST_COVERAGE_POLICY_REPORT = compileSchema(ajv, TEST_COVERAGE_POLICY_REPORT_SCHEMA);
const VALIDATE_TEST_TIMINGS = compileSchema(ajv, TEST_TIMINGS_ARTIFACT_SCHEMA);
const VALIDATE_TEST_PROFILE = compileSchema(ajv, TEST_PROFILE_ARTIFACT_SCHEMA);
const VALIDATE_TEST_STABILITY = compileSchema(ajv, TEST_STABILITY_ARTIFACT_SCHEMA);

export const validateTestCoverageArtifact = (payload) => (
  toValidationResult(VALIDATE_TEST_COVERAGE, payload)
);

export const validateTestCoveragePolicyReportArtifact = (payload) => (
  toValidationResult(VALIDATE_TEST_COVERAGE_POLICY_REPORT, payload)
);

export const validateTestTimingsArtifact = (payload) => (
  toValidationResult(VALIDATE_TEST_TIMINGS, payload)
);

export const validateTestProfileArtifact = (payload) => (
  toValidationResult(VALIDATE_TEST_PROFILE, payload)
);

export const validateTestStabilityArtifact = (payload) => (
  toValidationResult(VALIDATE_TEST_STABILITY, payload)
);
