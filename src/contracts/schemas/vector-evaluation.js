export const VECTOR_EVALUATION_VERSION = 1;
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
const record = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const vector = { type: 'array', minItems: 1, maxItems: 4096, items: { type: 'number' } };
const keys = { type: 'array', maxItems: 32768, uniqueItems: true, items: hash };
export const VECTOR_EVALUATION_SOURCE_SCHEMA = record({ repoId: text(256),
  mode: { enum: ['code', 'prose', 'extracted-prose', 'records'] }, file: text(4096),
  start: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  end: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  offsetUnit: { enum: ['utf8-byte', 'utf16-code-unit'] }, contentDigest: hash });
export const VECTOR_EVALUATION_RECORD_SCHEMA = record({
  schemaVersion: { const: VECTOR_EVALUATION_VERSION }, kind: { const: 'retrieval-vector-evaluation' },
  corpus: record({ id: text(256), sourceDigest: hash, generation: hash }),
  embedding: record({ modelId: text(1024), revision: { type: 'string', pattern: '^(?:[a-f0-9]{40}|[a-f0-9]{64})$' }, artifactDigest: hash, tokenizerDigest: hash,
    dimensions: { type: 'integer', minimum: 1, maximum: 4096 }, normalize: { type: 'boolean' },
    metric: { enum: ['cosine', 'dot', 'l2-squared'] }, channel: { enum: ['code', 'doc', 'merged'] },
    storage: record({ encoding: { const: 'uint8-affine-v1' }, minVal: { type: 'number' }, maxVal: { type: 'number' },
      levels: { type: 'integer', minimum: 2, maximum: 256 } }) }),
  query: record({ id: text(256), textDigest: hash, filterDigest: hash, vector }),
  originals: record({ status: { enum: ['available', 'partial', 'unavailable'] },
    capture: { enum: ['provider-fp32', 'unavailable'] }, digest: nullable(hash) }),
  eligibility: record({ status: { enum: ['complete', 'partial'] },
    method: { enum: ['hand-admitted', 'independent-source-facts'] }, policyDigest: hash, admittedKeys: keys }),
  rows: { type: 'array', maxItems: 32768, items: record({ key: hash, source: VECTOR_EVALUATION_SOURCE_SCHEMA,
    presence: record({ code: { type: 'boolean' }, doc: { type: 'boolean' }, merged: { type: 'boolean' } }),
    original: nullable(vector), stored: nullable({ ...vector, items: { type: 'integer', minimum: 0, maximum: 255 } }) }) },
  observed: record({ provenance: record({ sourceDigest: hash, generation: hash, embeddingKey: hash, queryKey: hash }),
    eligibleKeys: nullable(keys), sparseKeys: keys, vectorKeys: keys, finalKeys: nullable(keys),
    judgments: { type: 'array', maxItems: 32768, items: record({ key: hash,
      relevance: { type: 'integer', minimum: 0, maximum: 4 } }) } })
});
