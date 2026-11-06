import { semanticObject as object } from './semantic-envelopes.js';
import { EVIDENCE_TASK_SCHEMAS, EVIDENCE_TASK_VERSION } from './evidence-task.js';

export const EVIDENCE_TASK_COHORT_SCHEMA = object({ schemaVersion: { const: EVIDENCE_TASK_VERSION },
  compilations: { type: 'array', items: EVIDENCE_TASK_SCHEMAS.compilation, minItems: 1, maxItems: 8 },
  splitPolicy: EVIDENCE_TASK_SCHEMAS.split,
  candidates: { type: 'array', items: EVIDENCE_TASK_SCHEMAS.baseline, minItems: 1, maxItems: 2, uniqueItems: true } });
