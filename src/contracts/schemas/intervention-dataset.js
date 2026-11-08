import { semanticObject as object } from './semantic-envelopes.js';
import { FINITE_CAUSAL_MODEL_SCHEMAS } from './finite-causal-model.js';
import { FINITE_MODEL_INTERVENTION_SCHEMA } from './finite-model-intervention.js';
import { ORIGIN_OBSERVATION_SCHEMA } from './origin-observation.js';
import { ANSWER_INTEGRITY_EVALUATION_SCHEMA } from './answer-integrity-evaluation.js';
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
export const INTERVENTION_DATASET_SCHEMA = object({ schemaVersion: { const: 1 }, queryDigest: hash,
  trials: { type: 'array', minItems: 1, maxItems: 8, items: { oneOf: [
    object({ id: hash, profile: { const: 'finite-lookup-v1' }, model: FINITE_CAUSAL_MODEL_SCHEMAS.model, spec: FINITE_MODEL_INTERVENTION_SCHEMA }),
    object({ id: hash, profile: { const: 'origin-observation-v1' }, input: ORIGIN_OBSERVATION_SCHEMA }),
    object({ id: hash, profile: { const: 'retained-answer-integrity-v1' }, input: ANSWER_INTEGRITY_EVALUATION_SCHEMA })
  ] } } });
