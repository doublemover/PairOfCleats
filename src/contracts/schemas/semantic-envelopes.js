import { SEMANTIC_COVERAGE_SCHEMA } from './semantic.js';
export const semanticObject = (properties, optional = {}) => ({
  type: 'object', additionalProperties: false,
  properties: { ...properties, ...optional }, required: Object.keys(properties)
});
export const semanticInteger = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const semanticText = { type: 'string', minLength: 1 };
export const semanticHashSchema = { type: 'string', pattern: '^[a-f0-9]{64}$' };
export const semanticNullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = semanticObject;
const integer = semanticInteger;
const text = semanticText;
const hash = semanticHashSchema;
const nullable = semanticNullable;
const sourceId = { type: 'string', pattern: '^su1:[a-f0-9]{64}$' };
const partitionId = { type: 'string', pattern: '^(sy1|sa1):[a-f0-9]{64}$' };
const relativePath = {
  type: 'string', minLength: 1,
  pattern: '^(?!/)(?!.*(?:^|/)\\.\\.?(?:/|$))(?!.*\\\\)(?!.*:)[^\\u0000]+$'
};
export const SEMANTIC_SOURCE_SCHEMA = object({
  schemaVersion: { const: 1 }, sourceUnitId: sourceId, repositoryNamespace: text,
  path: relativePath, byteHash: hash, textHash: hash, encoding: { enum: ['utf8', 'binary'] },
  decoding: { enum: ['utf8-fatal-preserve-bom-v1', 'wasm-binary-v1'] }, language: text, dialect: nullable(text),
  mapping: nullable(object({
    identity: hash, parentSourceUnitId: sourceId, mapRef: text,
    quality: { enum: ['exact', 'coarse', 'synthetic'] }
  })),
  coordinateUnit: { enum: ['utf16', 'byte'] }, textLength: integer, byteLength: integer,
  lineStarts: { type: 'array', minItems: 1, items: integer }
});
export const SEMANTIC_PIECE_SCHEMA = object({
  path: relativePath, offsetsPath: relativePath, hash, offsetsHash: hash,
  count: integer, bytes: integer, firstRow: integer
});
export const SEMANTIC_MEMBER_NAMES = Object.freeze([
  'semantic_sources', 'semantic_records', 'semantic_operands', 'semantic_ownership',
  'semantic_edges', 'semantic_coverage', 'semantic_lookup', 'semantic_frontier'
]);
export const SEMANTIC_PARTITION_SCHEMA = object({
  schemaVersion: { const: 1 }, semanticSchemaVersion: { const: 1 },
  partitionId, sourceUnitId: sourceId, producerHash: hash,
  contextHash: nullable(hash), policyHash: hash, canonicalHash: hash,
  structuralSlots: { type: 'array', items: text, uniqueItems: true },
  members: object(Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [
    name, { type: 'array', items: SEMANTIC_PIECE_SCHEMA }
  ])))
});
export const SEMANTIC_GENERATION_SCHEMA = object({
  baseBuildId: text, semanticRevision: { const: 0 }
});
export const SEMANTIC_PROVIDER_SCHEMA = object({
  schemaVersion: { const: 1 },
  contexts: { type: 'array', items: object({
    contextKey: text, sourceUnits: { type: 'array', items: object({ sourceUnitId: sourceId, byteHash: hash }) },
    providerId: text, providerVersion: text, compilerVersion: nullable(text),
    configHash: hash, moduleResolutionHash: hash, vfsMappingHash: hash
  }) },
  partitions: { type: 'array', items: SEMANTIC_PARTITION_SCHEMA },
  coverageRef: nullable(text), diagnosticsRef: nullable(text)
});
export const SEMANTIC_FILE_FACTS_REF_SCHEMA = object({
  schemaVersion: { const: 1 }, repositoryNamespace: text, sourceUnitId: sourceId, sourceHash: hash,
  syntaxPartitionId: { type: 'string', pattern: '^sy1:[a-f0-9]{64}$' }, extractionHash: hash, canonicalHash: hash,
  storage: object({ generation: SEMANTIC_GENERATION_SCHEMA, relativePath }),
  partitions: { type: 'array', minItems: 1, items: SEMANTIC_PARTITION_SCHEMA },
  counts: object(Object.fromEntries(SEMANTIC_MEMBER_NAMES.map((name) => [name, integer]))),
  coverage: { type: 'array', maxItems: 512, items: SEMANTIC_COVERAGE_SCHEMA }
});
export const SEMANTIC_ENVELOPE_SCHEMAS = Object.freeze({
  fileFactsRef: SEMANTIC_FILE_FACTS_REF_SCHEMA, source: SEMANTIC_SOURCE_SCHEMA, partition: SEMANTIC_PARTITION_SCHEMA,
  generation: SEMANTIC_GENERATION_SCHEMA, provider: SEMANTIC_PROVIDER_SCHEMA
});
