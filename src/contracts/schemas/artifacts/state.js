import { RISK_RULES_BUNDLE_SCHEMA } from '../analysis.js';

const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const nullableBool = { type: ['boolean', 'null'] };
const semverString = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' };

const pieceEntry = {
  type: 'object',
  required: ['type', 'name', 'format', 'path'],
  properties: {
    type: { type: 'string' },
    name: { type: 'string' },
    format: { type: 'string' },
    path: { type: 'string' },
    bytes: nullableInt,
    checksum: nullableString,
    statError: nullableString,
    checksumError: nullableString,
    compression: nullableString,
    tier: nullableString,
    layout: {
      type: ['object', 'null'],
      properties: {
        order: nullableInt,
        group: nullableString,
        contiguous: nullableBool
      },
      additionalProperties: false
    },
    count: nullableInt,
    dims: nullableInt,
    schemaVersion: semverString,
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

/**
 * Repo head payloads are explicitly closed (`additionalProperties=false`)
 * to prevent untracked provenance fields from silently entering build contracts.
 */
const repoHeadSchema = {
  type: ['object', 'null'],
  properties: {
    commitId: nullableString,
    changeId: nullableString,
    operationId: nullableString,
    branch: nullableString,
    bookmarks: { type: ['array', 'null'], items: { type: 'string' } },
    author: nullableString,
    timestamp: nullableString
  },
  additionalProperties: false
};

const repoProvenanceSchema = {
  type: 'object',
  properties: {
    provider: { type: ['string', 'null'], enum: ['git', 'jj', 'none', null] },
    root: nullableString,
    head: repoHeadSchema,
    dirty: nullableBool,
    bookmarks: { type: ['array', 'null'], items: { type: 'string' } },
    detectedBy: nullableString,
    isRepo: nullableBool,
    commit: nullableString,
    branch: nullableString
  },
  additionalProperties: false
};

const toolInfoSchema = {
  type: 'object',
  properties: {
    version: { type: 'string' }
  },
  additionalProperties: false
};

/**
 * Index state is strict at the top level, with controlled extension islands
 * (`embeddings`, `features`, `extensions`, etc.) for forward-compatible payloads.
 */
const indexStateSchema = {
  type: 'object',
  required: ['generatedAt', 'mode', 'artifactSurfaceVersion'],
  properties: {
    generatedAt: { type: 'string' },
    updatedAt: nullableString,
    artifactSurfaceVersion: semverString,
    profile: {
      type: 'object',
      required: ['id', 'schemaVersion'],
      properties: {
        id: { type: 'string', enum: ['default', 'vector_only'] },
        schemaVersion: { type: 'number', const: 1 }
      },
      additionalProperties: false
    },
    compatibilityKey: nullableString,
    cohortKey: nullableString,
    repoId: nullableString,
    buildId: nullableString,
    mode: { type: 'string' },
    stage: nullableString,
    assembled: { type: 'boolean' },
    embeddings: { type: 'object', additionalProperties: true },
    features: { type: 'object', additionalProperties: true },
    shards: { type: 'object', additionalProperties: true },
    enrichment: { type: 'object', additionalProperties: true },
    filterIndex: { type: 'object', additionalProperties: true },
    sqlite: { type: 'object', additionalProperties: true },
    lmdb: { type: 'object', additionalProperties: true },
    artifacts: {
      type: 'object',
      required: ['schemaVersion', 'present', 'omitted', 'requiredForSearch'],
      properties: {
        schemaVersion: { type: 'number', const: 1 },
        present: {
          type: 'object',
          additionalProperties: { type: 'boolean' }
        },
        omitted: {
          type: 'array',
          items: { type: 'string' }
        },
        requiredForSearch: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      additionalProperties: false
    },
    riskInterprocedural: {
      type: 'object',
      required: ['enabled', 'summaryOnly', 'emitArtifacts'],
      properties: {
        enabled: { type: 'boolean' },
        summaryOnly: { type: 'boolean' },
        emitArtifacts: { type: ['string', 'null'] }
      },
      additionalProperties: true
    },
    riskRules: {
      anyOf: [RISK_RULES_BUNDLE_SCHEMA, { type: 'null' }]
    },
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

export const STATE_ARTIFACT_SCHEMA_DEFS = {
  pieces_manifest: {
    type: 'object',
    required: ['version', 'artifactSurfaceVersion', 'pieces'],
    properties: {
      version: { type: 'integer' },
      artifactSurfaceVersion: semverString,
      compatibilityKey: nullableString,
      generatedAt: nullableString,
      updatedAt: nullableString,
      mode: nullableString,
      stage: nullableString,
      repoId: nullableString,
      buildId: nullableString,
      pieces: {
        type: 'array',
        items: pieceEntry
      },
      extensions: { type: 'object' }
    },
    additionalProperties: false
  },
  index_state: indexStateSchema,
  builds_current: {
    type: 'object',
    required: ['buildId', 'buildRoot', 'promotedAt', 'artifactSurfaceVersion'],
    properties: {
      buildId: { type: 'string' },
      buildRoot: { type: 'string' },
      buildRoots: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
      buildRootsByMode: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
      buildRootsByStage: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
      promotedAt: { type: 'string' },
      stage: nullableString,
      modes: { type: ['array', 'null'], items: { type: 'string' } },
      configHash: nullableString,
      artifactSurfaceVersion: semverString,
      compatibilityKey: nullableString,
      tool: toolInfoSchema,
      repo: repoProvenanceSchema,
      extensions: { type: 'object' }
    },
    additionalProperties: false
  }
};
