import { literalEvidenceProjectionErrors } from '../literal-evidence.js';
import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { ARTIFACT_SCHEMA_DEFS } from '../schemas/artifacts.js';
import { toValidationResult } from './result.js';
import { validateMetadataV2Semantics } from './metadata.js';
import { apiContractProjectionErrors } from '../schemas/api-contracts.js';
import { callableSummaryProjectionErrors } from '../callable-parameters.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

export const ARTIFACT_VALIDATORS = Object.fromEntries(
  Object.entries(ARTIFACT_SCHEMA_DEFS).map(([name, schema]) => [name, compileSchema(ajv, schema, { lazy: true })])
);

export function validateArtifact(name, data) {
  const validator = ARTIFACT_VALIDATORS[name];
  if (!validator) return { ok: true, errors: [] };
  const result = toValidationResult(validator, data);
  if (result.ok && name === 'symbols' && Array.isArray(data)) {
    for (let index = 0; index < data.length; index++) {
      const summary = data[index]?.extensions?.callableParameters;
      result.errors.push(...callableSummaryProjectionErrors(summary).map(error => `/${index}/extensions/callableParameters: ${error}`));
      if (summary?.source === 'legacy-signature-subset') result.errors.push(`/${index}/extensions/callableParameters: legacy display cannot supply parser-node symbol authority.`);
      const language = data[index]?.lang?.toLowerCase();
      if (summary?.source === 'parser-node' && language && !['typescript', 'ts', 'tsx'].includes(language)) {
        result.errors.push(`/${index}/extensions/callableParameters: parameter language differs from the published symbol.`);
      }
      if (result.errors.length >= 20) break;
    }
    result.ok = !result.errors.length;
  }
  if (result.ok && name === 'call_sites' && Array.isArray(data)) {
    for (let index = 0; index < data.length; index++) {
      for (const literal of data[index]?.extensions?.argLiterals || []) {
        if (literal) result.errors.push(...literalEvidenceProjectionErrors(literal)
          .map(error => `/${index}/extensions/argLiterals: ${error}`));
      }
      if (result.errors.length >= 20) break;
    }
    result.ok = !result.errors.length;
  }
  if (result.ok && name === 'api_contracts' && Array.isArray(data)) {
    result.errors.push(...apiContractProjectionErrors({ symbols: data }));
    result.ok = result.errors.length === 0;
  }
  if (result.ok && (name === 'chunk_meta' || name === 'chunk_meta_cold') && Array.isArray(data)) {
    for (let index = 0; index < data.length; index += 1) {
      const errors = validateMetadataV2Semantics(data[index]?.metaV2);
      result.errors.push(...errors.map((error) => `/${index}/metaV2${error}`));
      if (result.errors.length >= 20) break;
    }
    result.ok = result.errors.length === 0;
  }
  return result;
}
