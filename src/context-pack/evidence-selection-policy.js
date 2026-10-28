import { types } from 'node:util';
import { createAjv, compileSchema } from '../shared/validation/ajv-factory.js';
import { CONTEXT_EVIDENCE_SELECTION_SCHEMA } from '../contracts/schemas/context-evidence-selection.js';
import { stableStringify } from '../shared/stable-json.js';
import { contextDigest } from '../contracts/context-token-budget.js';

const validate = compileSchema(createAjv({ strict: true, allErrors: true }), CONTEXT_EVIDENCE_SELECTION_SCHEMA);
const invalid = () => Object.assign(new Error('Invalid bounded evidence-set selection policy.'), { code: 'ERR_CONTEXT_PACK_INVALID_REQUEST', status: 400 });
export const resolveEvidenceSelectionPolicy = input => {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input) || types.isProxy(input)) throw invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length > 10) throw invalid();
  const captured = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
      || !['string', 'number'].includes(typeof descriptor.value)) throw invalid();
    captured[key] = descriptor.value;
  }
  if (!validate(captured)) throw invalid();
  return Object.freeze({ schemaVersion: 1, algorithm: captured.algorithm, maxCandidates: captured.maxCandidates ?? 16,
    maxSelected: captured.maxSelected ?? 4, maxPairwise: captured.maxPairwise ?? 1024, maxWorkUnits: captured.maxWorkUnits ?? 65536,
    maxWallClockMs: captured.maxWallClockMs ?? 3000, maxPoolBytes: captured.maxPoolBytes ?? 262144,
    maxMeasurements: captured.maxMeasurements ?? 64, lambda: captured.lambda ?? 0.5 });
};
export const evidenceSelectionPolicyDigest = policy => contextDigest(stableStringify(policy));
