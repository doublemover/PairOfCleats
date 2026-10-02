import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { ARTIFACT_SCHEMA_DEFS } from '../schemas/artifacts.js';
import { toValidationResult } from './result.js';
import { validateMetadataV2Semantics } from './metadata.js';

const ajv = createAjv({
  allErrors: true,
  allowUnionTypes: true,
  strict: true
});

export const ARTIFACT_VALIDATORS = Object.fromEntries(
  Object.entries(ARTIFACT_SCHEMA_DEFS).map(([name, schema]) => [name, compileSchema(ajv, schema)])
);

export function validateArtifact(name, data) {
  const validator = ARTIFACT_VALIDATORS[name];
  if (!validator) return { ok: true, errors: [] };
  const result = toValidationResult(validator, data);
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
