import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { RUNTIME_FAMILY_MANIFEST_SCHEMA, RUNTIME_FAMILY_POINTER_SCHEMA } from '../schemas/runtime-evidence-family.js';
import { assertCurrentIndexFormat } from '../index-format.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = { manifest: compileSchema(ajv, RUNTIME_FAMILY_MANIFEST_SCHEMA), pointer: compileSchema(ajv, RUNTIME_FAMILY_POINTER_SCHEMA) };
export const assertRuntimeFamily = (kind, value, { indexPath = 'runtime-evidence-family', repoRoot = process.cwd() } = {}) => {
  assertCurrentIndexFormat({ operation: 'read', component: 'runtime evidence family', foundVersion: value?.artifactSurfaceVersion,
    repoRoot, indexPath });
  const validate = validators[kind];
  if (!validate || !validate(value)) throw Object.assign(new TypeError('Invalid runtime family ' + kind + ': ' + ajv.errorsText(validate?.errors)),
    { code: 'ERR_RUNTIME_FAMILY_CONTRACT' });
  if (kind === 'manifest') {
    const ids = new Set(value.raw.map(row => row.artifactId));
    if (ids.size !== value.raw.length || value.coverage.length !== value.raw.length
      || new Set(value.coverage.map(row => row.artifactId)).size !== ids.size
      || value.coverage.some(row => !ids.has(row.artifactId))) {
      throw Object.assign(new TypeError('Runtime raw/coverage inventory mismatch.'), { code: 'ERR_RUNTIME_FAMILY_CONTRACT' });
    }
    if (value.coverage.reduce((count, row) => count + row.observedRecords, 0) !== value.evidence.count) {
      throw Object.assign(new TypeError('Runtime projection/coverage count mismatch.'), { code: 'ERR_RUNTIME_FAMILY_CONTRACT' });
    }
  }
  return value;
};
