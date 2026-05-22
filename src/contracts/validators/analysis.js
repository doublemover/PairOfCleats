import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import {
  METADATA_V2_SCHEMA,
  RISK_RULES_BUNDLE_SCHEMA,
  ANALYSIS_POLICY_SCHEMA,
  GRAPH_CONTEXT_PACK_SCHEMA,
  GRAPH_IMPACT_SCHEMA,
  RISK_DELTA_SCHEMA,
  COMPOSITE_CONTEXT_PACK_SCHEMA,
  API_CONTRACTS_SCHEMA,
  ARCHITECTURE_REPORT_SCHEMA,
  SUGGEST_TESTS_SCHEMA
} from '../schemas/analysis.js';
import { validateContextPackRiskContractCompatibility } from '../context-pack-risk-contract.js';
import { formatValidatorErrors, toValidationResult } from './result.js';

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
const RISK_DELTA_VALIDATOR = compileSchema(ajv, RISK_DELTA_SCHEMA);
const COMPOSITE_CONTEXT_PACK_VALIDATOR = compileSchema(ajv, COMPOSITE_CONTEXT_PACK_SCHEMA);
const API_CONTRACTS_VALIDATOR = compileSchema(ajv, API_CONTRACTS_SCHEMA);
const ARCHITECTURE_REPORT_VALIDATOR = compileSchema(ajv, ARCHITECTURE_REPORT_SCHEMA);
const SUGGEST_TESTS_VALIDATOR = compileSchema(ajv, SUGGEST_TESTS_SCHEMA);

export function validateMetadataV2(payload) {
  return toValidationResult(META_V2_VALIDATOR, payload);
}

export function validateRiskRulesBundle(payload) {
  return toValidationResult(RISK_RULES_VALIDATOR, payload);
}

export function validateAnalysisPolicy(payload) {
  return toValidationResult(ANALYSIS_POLICY_VALIDATOR, payload);
}

export function validateGraphContextPack(payload) {
  return toValidationResult(GRAPH_CONTEXT_PACK_VALIDATOR, payload);
}

export function validateGraphImpact(payload) {
  return toValidationResult(GRAPH_IMPACT_VALIDATOR, payload);
}

export function validateRiskDelta(payload) {
  return toValidationResult(RISK_DELTA_VALIDATOR, payload);
}

export function validateCompositeContextPack(payload) {
  const schemaOk = Boolean(COMPOSITE_CONTEXT_PACK_VALIDATOR(payload));
  const errors = schemaOk ? [] : formatValidatorErrors(COMPOSITE_CONTEXT_PACK_VALIDATOR);
  const compatibility = validateContextPackRiskContractCompatibility(payload);
  if (!compatibility.ok) {
    errors.push(...compatibility.errors);
  }
  return { ok: errors.length === 0, errors };
}

export function validateApiContracts(payload) {
  return toValidationResult(API_CONTRACTS_VALIDATOR, payload);
}

export function validateArchitectureReport(payload) {
  return toValidationResult(ARCHITECTURE_REPORT_VALIDATOR, payload);
}

export function validateSuggestTests(payload) {
  return toValidationResult(SUGGEST_TESTS_VALIDATOR, payload);
}
