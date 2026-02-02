export const BUILD_STATE_SCHEMA_VERSION = 1;

const ISO_DATE_TIME = {
  type: 'string'
};

const MODE_ENTRY = {
  type: 'string',
  enum: ['code', 'prose', 'extracted-prose', 'records']
};

const BUILD_PHASE_STATUS = {
  type: 'string',
  enum: ['running', 'done', 'failed']
};

const PHASE_ENTRY = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'updatedAt'],
  properties: {
    status: BUILD_PHASE_STATUS,
    detail: {
      anyOf: [
        { type: 'string' },
        { type: 'number' },
        { type: 'boolean' },
        { type: 'object', additionalProperties: true },
        { type: 'array' },
        { type: 'null' }
      ]
    },
    startedAt: ISO_DATE_TIME,
    finishedAt: ISO_DATE_TIME,
    updatedAt: ISO_DATE_TIME
  }
};

const PROGRESS_ENTRY = {
  type: 'object',
  additionalProperties: false,
  required: ['processedFiles', 'totalFiles', 'updatedAt'],
  properties: {
    processedFiles: { type: 'number' },
    totalFiles: { type: ['number', 'null'] },
    updatedAt: ISO_DATE_TIME
  }
};

const COUNT_ENTRY = {
  type: 'object',
  additionalProperties: false,
  required: ['files', 'chunks', 'skipped'],
  properties: {
    files: { type: 'number' },
    chunks: { type: 'number' },
    skipped: { type: 'number' }
  }
};

const SIGNATURE_ENTRY = {
  type: 'object',
  additionalProperties: false,
  required: ['tokenizationKey', 'cacheSignature', 'signatureVersion'],
  properties: {
    tokenizationKey: { type: 'string' },
    cacheSignature: { type: 'string' },
    signatureVersion: { type: 'number' }
  }
};

const REPO_HEAD = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    commitId: { type: ['string', 'null'] },
    changeId: { type: ['string', 'null'] },
    branch: { type: ['string', 'null'] },
    bookmarks: { type: ['array', 'null'], items: { type: 'string' } },
    author: { type: ['string', 'null'] },
    timestamp: { type: ['string', 'null'] }
  }
};

const REPO_PROVENANCE = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    provider: { type: ['string', 'null'], enum: ['git', 'jj', 'none', null] },
    root: { type: ['string', 'null'] },
    head: REPO_HEAD,
    dirty: { type: ['boolean', 'null'] },
    bookmarks: { type: ['array', 'null'], items: { type: 'string' } },
    detectedBy: { type: ['string', 'null'] },
    isRepo: { type: ['boolean', 'null'] },
    commit: { type: ['string', 'null'] },
    branch: { type: ['string', 'null'] }
  },
  allOf: [
    {
      if: { properties: { provider: { const: 'none' } } },
      then: {
        properties: {
          head: { type: 'null' },
          dirty: { type: ['boolean', 'null'] }
        }
      }
    }
  ]
};

export const BUILD_STATE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'build_state.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'buildId',
    'buildRoot',
    'repoRoot',
    'createdAt',
    'updatedAt',
    'startedAt',
    'finishedAt',
    'stage',
    'modes',
    'currentPhase',
    'tool',
    'signatureVersion',
    'configHash',
    'repo',
    'phases',
    'progress'
  ],
  properties: {
    schemaVersion: { type: 'number', const: BUILD_STATE_SCHEMA_VERSION },
    buildId: { type: 'string' },
    buildRoot: { type: 'string' },
    repoRoot: { type: ['string', 'null'] },
    createdAt: ISO_DATE_TIME,
    updatedAt: ISO_DATE_TIME,
    startedAt: ISO_DATE_TIME,
    finishedAt: { anyOf: [ISO_DATE_TIME, { type: 'null' }] },
    stage: { type: ['string', 'null'] },
    modes: { type: ['array', 'null'], items: MODE_ENTRY },
    currentPhase: { type: ['string', 'null'] },
    tool: {
      type: 'object',
      additionalProperties: false,
      required: ['version', 'node'],
      properties: {
        version: { type: ['string', 'null'] },
        node: { type: 'string' }
      }
    },
    signatureVersion: { type: ['number', 'null'] },
    configHash: { type: ['string', 'null'] },
    repo: REPO_PROVENANCE,
    phases: {
      type: 'object',
      additionalProperties: PHASE_ENTRY
    },
    progress: {
      type: 'object',
      additionalProperties: PROGRESS_ENTRY
    },
    heartbeat: {
      type: 'object',
      additionalProperties: false,
      required: ['stage', 'lastHeartbeatAt'],
      properties: {
        stage: { type: ['string', 'null'] },
        lastHeartbeatAt: ISO_DATE_TIME
      }
    },
    counts: {
      type: 'object',
      additionalProperties: COUNT_ENTRY
    },
    signatures: {
      type: 'object',
      additionalProperties: SIGNATURE_ENTRY
    },
    ignore: {
      type: 'object',
      additionalProperties: false,
      required: ['files', 'warnings'],
      properties: {
        files: { type: 'array', items: { type: 'string' } },
        warnings: { type: ['array', 'null'], items: { type: 'string' } }
      }
    },
    validation: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'issueCount', 'warningCount', 'issues'],
      properties: {
        ok: { type: 'boolean' },
        issueCount: { type: 'number' },
        warningCount: { type: 'number' },
        issues: { type: ['array', 'null'], items: { type: 'string' } }
      }
    }
  }
};
