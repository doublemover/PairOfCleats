import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  METADATA_V2_SCHEMA,
  RISK_RULES_BUNDLE_SCHEMA,
  ANALYSIS_POLICY_SCHEMA,
  GRAPH_CONTEXT_PACK_SCHEMA,
  GRAPH_IMPACT_SCHEMA,
  COMPOSITE_CONTEXT_PACK_SCHEMA,
  API_CONTRACTS_SCHEMA,
  ARCHITECTURE_REPORT_SCHEMA,
  SUGGEST_TESTS_SCHEMA
} from '../schemas/analysis.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

const META_V2_VALIDATOR = compileSchema(ajv, METADATA_V2_SCHEMA);
const RISK_RULES_VALIDATOR = compileSchema(ajv, RISK_RULES_BUNDLE_SCHEMA);
const ANALYSIS_POLICY_VALIDATOR = compileSchema(ajv, ANALYSIS_POLICY_SCHEMA);
const GRAPH_CONTEXT_PACK_VALIDATOR = compileSchema(ajv, GRAPH_CONTEXT_PACK_SCHEMA);
const GRAPH_IMPACT_VALIDATOR = compileSchema(ajv, GRAPH_IMPACT_SCHEMA);
const COMPOSITE_CONTEXT_PACK_VALIDATOR = compileSchema(ajv, COMPOSITE_CONTEXT_PACK_SCHEMA);
const API_CONTRACTS_VALIDATOR = compileSchema(ajv, API_CONTRACTS_SCHEMA);
const ARCHITECTURE_REPORT_VALIDATOR = compileSchema(ajv, ARCHITECTURE_REPORT_SCHEMA);
const SUGGEST_TESTS_VALIDATOR = compileSchema(ajv, SUGGEST_TESTS_SCHEMA);

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

export function validateGraphContextPack(payload) {
  const ok = Boolean(GRAPH_CONTEXT_PACK_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(GRAPH_CONTEXT_PACK_VALIDATOR) };
}

export function validateGraphImpact(payload) {
  const ok = Boolean(GRAPH_IMPACT_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(GRAPH_IMPACT_VALIDATOR) };
}

export function validateCompositeContextPack(payload) {
  const ok = Boolean(COMPOSITE_CONTEXT_PACK_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(COMPOSITE_CONTEXT_PACK_VALIDATOR) };
}

export function validateApiContracts(payload) {
  const ok = Boolean(API_CONTRACTS_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(API_CONTRACTS_VALIDATOR) };
}

export function validateArchitectureReport(payload) {
  const ok = Boolean(ARCHITECTURE_REPORT_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(ARCHITECTURE_REPORT_VALIDATOR) };
}

export function validateSuggestTests(payload) {
  const ok = Boolean(SUGGEST_TESTS_VALIDATOR(payload));
  return { ok, errors: ok ? [] : formatErrors(SUGGEST_TESTS_VALIDATOR) };
}
