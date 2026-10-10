import { SEMANTIC_TASK_SCHEMA } from '../schemas/semantic-task.js';
import { assertSemanticTask } from './semantic-task.js';
import { compileSchema, createAjv } from '../../shared/validation/ajv-factory.js';
import { SEMANTIC_SCHEMA_DEFS } from '../schemas/semantic.js';
import { toValidationResult } from './result.js';

const ajv = createAjv({ allErrors: true, strict: true });
const validators = new Map(Object.entries({ ...SEMANTIC_SCHEMA_DEFS, frontier: SEMANTIC_TASK_SCHEMA })
  .map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));

/** Validate wire shape plus local invariants; partition reconciliation checks FKs. */
export const validateSemanticRecord = (family, row, { sourceLength, structuralSlots = [] } = {}) => {
  const validator = validators.get(family);
  if (!validator) throw new TypeError('Unknown semantic record family: ' + family);
  const result = toValidationResult(validator, row);
  if (!result.ok) return result;
  const errors = [];
  if (family === 'frontier') {
    try { assertSemanticTask(row); } catch (error) { errors.push(error.message); }
  }
  if (family === 'node' && row.span !== null) {
    if (row.span[1] < row.span[0]) errors.push('span must be half-open and ordered');
    if (sourceLength != null && row.span[1] > sourceLength) errors.push('span exceeds decoded source');
  }
  if (family === 'operand') {
    if (row.slot.startsWith('ast:') && !structuralSlots.includes(row.slot)) {
      errors.push('structural slot is not approved by the parser adapter');
    }
    const hole = row.flags.includes('hole');
    if ((row.child === null) !== hole || (hole && row.slot !== 'element')) {
      errors.push('only explicit array holes may have a null child');
    }
  }
  if (family === 'coverage' && row.observedCount !== null && row.completedCount !== null
    && row.completedCount > row.observedCount) errors.push('completedCount exceeds observedCount');
  if (family === 'coverage' && row.state === 'complete' && row.frontierRef !== null) {
    errors.push('complete coverage cannot have an unresolved frontier');
  }
  return { ok: errors.length === 0, errors };
};
