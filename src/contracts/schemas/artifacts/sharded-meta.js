const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const semverString = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' };

const shardedJsonlPart = {
  type: 'object',
  required: ['path', 'records', 'bytes'],
  properties: {
    path: { type: 'string' },
    records: intId,
    bytes: intId,
    checksum: nullableString,
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

const SHARDED_JSONL_META_REQUIRED = [
  'schemaVersion',
  'artifact',
  'format',
  'generatedAt',
  'compression',
  'totalRecords',
  'totalBytes',
  'maxPartRecords',
  'maxPartBytes',
  'targetMaxBytes',
  'parts'
];

const SHARDED_JSONL_META_COMMON_PROPERTIES = {
  schemaVersion: semverString,
  format: { type: 'string', enum: ['jsonl-sharded'] },
  generatedAt: { type: 'string' },
  compression: { type: 'string', enum: ['none', 'gzip', 'zstd'] },
  totalRecords: intId,
  totalBytes: intId,
  maxPartRecords: intId,
  maxPartBytes: intId,
  targetMaxBytes: nullableInt,
  parts: { type: 'array', items: shardedJsonlPart },
  extensions: { type: 'object' }
};

/**
 * Sharded-meta invariants:
 * - `artifact` is a per-schema `const`, so each *_meta contract is artifact-bound.
 * - `required` remains shared/immutable across generated schemas.
 * - This avoids repeated spread-clone assembly from a base object on every schema build.
 */
const createShardedJsonlMetaSchema = (artifact) => ({
  type: 'object',
  required: SHARDED_JSONL_META_REQUIRED,
  properties: {
    schemaVersion: SHARDED_JSONL_META_COMMON_PROPERTIES.schemaVersion,
    artifact: { type: 'string', const: artifact },
    format: SHARDED_JSONL_META_COMMON_PROPERTIES.format,
    generatedAt: SHARDED_JSONL_META_COMMON_PROPERTIES.generatedAt,
    compression: SHARDED_JSONL_META_COMMON_PROPERTIES.compression,
    totalRecords: SHARDED_JSONL_META_COMMON_PROPERTIES.totalRecords,
    totalBytes: SHARDED_JSONL_META_COMMON_PROPERTIES.totalBytes,
    maxPartRecords: SHARDED_JSONL_META_COMMON_PROPERTIES.maxPartRecords,
    maxPartBytes: SHARDED_JSONL_META_COMMON_PROPERTIES.maxPartBytes,
    targetMaxBytes: SHARDED_JSONL_META_COMMON_PROPERTIES.targetMaxBytes,
    parts: SHARDED_JSONL_META_COMMON_PROPERTIES.parts,
    extensions: SHARDED_JSONL_META_COMMON_PROPERTIES.extensions
  },
  additionalProperties: false
});

const SHARDED_META_ARTIFACT_KEY_MAP = [
  ['file_meta_meta', 'file_meta'],
  ['chunk_meta_meta', 'chunk_meta'],
  ['chunk_meta_cold_meta', 'chunk_meta_cold'],
  ['chunk_uid_map_meta', 'chunk_uid_map'],
  ['vfs_manifest_meta', 'vfs_manifest'],
  ['vfs_path_map_meta', 'vfs_path_map'],
  ['field_tokens_meta', 'field_tokens'],
  ['file_relations_meta', 'file_relations'],
  ['symbols_meta', 'symbols'],
  ['symbol_occurrences_meta', 'symbol_occurrences'],
  ['symbol_edges_meta', 'symbol_edges'],
  ['call_sites_meta', 'call_sites'],
  ['risk_summaries_meta', 'risk_summaries'],
  ['risk_flows_meta', 'risk_flows'],
  ['repo_map_meta', 'repo_map'],
  ['graph_relations_meta', 'graph_relations']
];

export const SHARDED_META_ARTIFACT_SCHEMA_DEFS = Object.fromEntries(
  SHARDED_META_ARTIFACT_KEY_MAP.map(([schemaKey, artifact]) => [
    schemaKey,
    createShardedJsonlMetaSchema(artifact)
  ])
);
