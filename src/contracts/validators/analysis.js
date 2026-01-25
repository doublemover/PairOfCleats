import Ajv from 'ajv';
import { METADATA_V2_SCHEMA, RISK_RULES_BUNDLE_SCHEMA, ANALYSIS_POLICY_SCHEMA } from '../schemas/analysis.js';

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const cloneSchema = (schema) => {
  if (typeof structuredClone === 'function') {
    return structuredClone(schema);
  }
  return JSON.parse(JSON.stringify(schema));
};

const META_V2_VALIDATOR = ajv.compile(cloneSchema(METADATA_V2_SCHEMA));
const RISK_RULES_VALIDATOR = ajv.compile(cloneSchema(RISK_RULES_BUNDLE_SCHEMA));
const ANALYSIS_POLICY_VALIDATOR = ajv.compile(cloneSchema(ANALYSIS_POLICY_SCHEMA));

const formatError = (error) => {
  const path = error.instancePath || '/';
  const message = error.message || 'schema error';
  return `${path} ${message}`.trim();
};

const formatErrors = (validator) => (
  validator.errors ? validator.errors.map(formatError) : []
);

export function validateMetadataV2(payload) {
  const ok = Boolean(META_V2_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(META_V2_VALIDATOR) };
}

export function validateRiskRulesBundle(payload) {
  const ok = Boolean(RISK_RULES_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(RISK_RULES_VALIDATOR) };
}

export function validateAnalysisPolicy(payload) {
  const ok = Boolean(ANALYSIS_POLICY_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(ANALYSIS_POLICY_VALIDATOR) };
}
