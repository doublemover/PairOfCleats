import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { EVIDENCE_TASK_SCHEMAS } from '../schemas/evidence-task.js';
const ajv = createAjv({ strict: true, allErrors: true });
const validators = Object.fromEntries(Object.entries(EVIDENCE_TASK_SCHEMAS).map(([kind, schema]) => [kind, compileSchema(ajv, schema)]));
export const assertEvidenceTask = (kind, value) => {
  if (!validators[kind]?.(value)) throw Object.assign(new TypeError('Invalid finite evidence task ' + kind + '.'), { code: 'ERR_EVIDENCE_TASK_CONTRACT' }); return value;
};
