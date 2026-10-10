import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_ENVELOPE_SCHEMAS } from '../schemas/semantic-envelopes.js';
import { toValidationResult } from './result.js';
const ajv = createAjv({ allErrors: true, strict: true });
const validators = new Map(Object.entries(SEMANTIC_ENVELOPE_SCHEMAS)
  .map(([name, schema]) => [name, compileSchema(ajv, schema)]));
export const validateSemanticEnvelope = (family, value) => {
  const validator = validators.get(family);
  if (!validator) throw new TypeError('Unknown semantic envelope: ' + family);
  const result = toValidationResult(validator, value);
  if (!result.ok) return result;
  const errors = [];
  if (family === 'source') {
    if (value.lineStarts[0] !== 0) errors.push('line map must start at UTF-16 offset zero');
    for (let i = 0; i < value.lineStarts.length; i += 1) {
      if (value.lineStarts[i] > value.textLength
        || (i && value.lineStarts[i] <= value.lineStarts[i - 1])) errors.push('invalid source line map');
    }
  }
  if (family === 'partition') {
    for (const [name, pieces] of Object.entries(value.members)) {
      let next = 0;
      for (const piece of pieces) {
        if (!piece.count || piece.firstRow !== next) errors.push('noncontiguous piece inventory: ' + name);
        next += piece.count;
        if (!Number.isSafeInteger(next)) errors.push('unsafe partition row count');
      }
    }
  }
  return { ok: errors.length === 0, errors };
};
export const assertSemanticEnvelope = (family, value) => {
  const validation = validateSemanticEnvelope(family, value);
  if (!validation.ok) {
    const error = new Error('Invalid semantic ' + family + ': ' + validation.errors.join('; '));
    error.code = 'ERR_SEMANTIC_CONTRACT';
    throw error;
  }
  return value;
};
