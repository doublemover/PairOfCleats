import { createAjv, compileSchema } from '../../shared/validation/ajv-factory.js';
import { EVIDENCE_TASK_COHORT_SCHEMA } from '../schemas/evidence-task-cohort.js';
const validate = compileSchema(createAjv({ strict: true, allErrors: true }), EVIDENCE_TASK_COHORT_SCHEMA);
export const assertEvidenceTaskCohort = value => {
  if (!validate(value)) throw Object.assign(new TypeError('Invalid finite evidence-task cohort.'), { code: 'ERR_EVIDENCE_TASK_COHORT_INPUT' }); return value;
};
