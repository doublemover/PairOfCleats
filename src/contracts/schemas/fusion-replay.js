export const FUSION_REPLAY_VERSION = 2;
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const nullable = schema => ({ anyOf: [{ type: 'null' }, schema] });
const text = maxLength => ({ type: 'string', maxLength });
const record = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const idx = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const data = { type: 'object', maxProperties: 512 };
const scoreSpace = record({ kind: { enum: ['cosine', 'jaccard', 'negative-distance', 'dot', 'dot-product'] },
  metric: { enum: ['cosine', 'jaccard', 'l2', 'ip', 'dot'] }, backend: nullable(text(128)) });
const result = record({ key: hash, score: { type: 'number' }, scoreType: text(128),
  sparseScore: nullable({ type: 'number' }), annScore: nullable({ type: 'number' }) });
const channelCoverage = record({ ordering: { const: 'ranked-prefix' },
  requestedDepth: nullable({ type: 'integer', minimum: 0, maximum: 4096 }),
  capturedCount: { type: 'integer', minimum: 0, maximum: 4096 },
  exhaustion: nullable(record({ state: { const: 'exhausted' }, basis: { const: 'capture-owner-complete-enumeration' },
    eligibleCount: { type: 'integer', minimum: 0, maximum: 4096 }, prefixHash: hash, queryKey: hash,
    sourceDigest: hash, generation: hash })) });
export const FUSION_REPLAY_RECORD_SCHEMA = record({ schemaVersion: { const: FUSION_REPLAY_VERSION },
  kind: { const: 'retrieval-fusion-replay' }, recordKey: hash, policy: hash,
  provenance: record({ corpus: record({ id: text(256), sourceDigest: hash, generation: hash }),
    embeddingKey: hash, queryKey: hash, oracleRecordKey: hash, queryId: text(256), textDigest: hash, filterDigest: hash }),
  fusionOptions: { ...data, required: ['sparseType', 'rrfEnabled', 'rrfK', 'blendEnabled', 'blendSparseWeight', 'blendAnnWeight', 'fieldWeightsEnabled'],
    additionalProperties: false, properties: { sparseType: text(128), annSource: nullable(text(128)),
      rrfEnabled: { type: 'boolean' }, rrfK: { type: 'integer', minimum: 1, maximum: 1024 }, blendEnabled: { type: 'boolean' },
      blendSparseWeight: { type: 'number', minimum: 0, maximum: 1 }, blendAnnWeight: { type: 'number', minimum: 0, maximum: 1 },
      fieldWeightsEnabled: { type: 'boolean' } } },
  rankOptions: { ...data, required: ['searchTopN', 'topkSlack'], properties: {
    searchTopN: { type: 'integer', minimum: 1, maximum: 128 }, topkSlack: { type: 'integer', minimum: 0, maximum: 256 } } },
  channelCoverage: record({ sparse: channelCoverage, dense: channelCoverage }),
  channels: record({ sparse: { type: 'array', maxItems: 4096, items: record({ idx, score: { type: 'number' }, rank: { type: 'integer', minimum: 1, maximum: 4096 } }) },
    dense: { type: 'array', maxItems: 4096, items: record({ idx, sim: { type: 'number' }, rank: { type: 'integer', minimum: 1, maximum: 4096 },
      scoreSpace, rawDistance: nullable({ type: 'number' }) }) } }),
  candidates: { type: 'array', maxItems: 4096, items: record({ idx, key: hash, chunk: data,
    facts: record({ allowed: { type: 'boolean' }, sparse: { type: 'boolean' }, semantic: { type: 'boolean' },
      fts: { type: 'boolean' }, exported: { type: 'boolean' }, phraseMatches: { type: 'integer', minimum: 0, maximum: 1000000 } }) }) },
  fileRelations: data, graphRelations: nullable(data),
  definitionKinds: { type: 'object', maxProperties: 512, additionalProperties: { type: 'boolean' } },
  phrases: { type: 'array', maxItems: 256, uniqueItems: true, items: text(4096) },
  judgments: { type: 'array', maxItems: 32768, items: record({ key: hash, relevance: { type: 'integer', minimum: 0, maximum: 4 } }) },
  oracle: record({ representation: { enum: ['captured-original-fp32', 'declared-stored-uint8'] },
    referenceKeys: { type: 'array', maxItems: 128, uniqueItems: true, items: hash }, counts: data }),
  baseline: { type: 'array', maxItems: 128, items: result }
});
