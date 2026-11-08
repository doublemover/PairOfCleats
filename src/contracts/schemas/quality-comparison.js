export const QUALITY_COMPARISON_VERSION = 1;
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const record = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const outcome = { enum: ['complete', 'missing', 'failed', 'timeout', 'cancelled'] };
const observation = record({ taskKey: hash, inputKey: hash, repoId: text(256), familyId: text(256), slice: text(64),
  status: outcome, value: { anyOf: [{ type: 'null' }, { type: 'number', minimum: 0, maximum: 1 }] } });
export const PAIRED_QUALITY_REQUEST_SCHEMA = record({ schemaVersion: { const: QUALITY_COMPARISON_VERSION },
  kind: { const: 'paired-quality-comparison' },
  metric: record({ name: text(128), definitionKey: hash, unit: { const: 'quality-unit-interval' } }),
  baselineKey: hash, candidateKey: hash, cluster: { enum: ['repository', 'family'] }, seed: text(256),
  resamples: { type: 'integer', minimum: 32, maximum: 2048 },
  slices: { type: 'array', maxItems: 16, uniqueItems: true, items: text(64) },
  baseline: { type: 'array', maxItems: 4096, items: observation },
  candidate: { type: 'array', maxItems: 4096, items: observation }
});
