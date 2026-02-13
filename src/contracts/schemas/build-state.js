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

const DOCUMENT_EXTRACTION_EXTRACTOR = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'version', 'target'],
  properties: {
    name: { type: ['string', 'null'] },
    version: { type: ['string', 'null'] },
    target: { type: ['string', 'null'] }
  }
};

const DOCUMENT_EXTRACTION_FILE_ENTRY = {
  type: 'object',
  additionalProperties: false,
  required: [
    'file',
    'sourceType',
    'extractor',
    'sourceBytesHash',
    'sourceBytesHashAlgo',
    'unitCounts',
    'normalizationPolicy'
  ],
  properties: {
    file: { type: 'string' },
    sourceType: { type: ['string', 'null'], enum: ['pdf', 'docx', null] },
    extractor: DOCUMENT_EXTRACTION_EXTRACTOR,
    sourceBytesHash: { type: ['string', 'null'] },
    sourceBytesHashAlgo: { type: 'string' },
    unitCounts: {
      type: 'object',
      additionalProperties: false,
      required: ['pages', 'paragraphs', 'totalUnits'],
      properties: {
        pages: { type: 'number' },
        paragraphs: { type: 'number' },
        totalUnits: { type: 'number' }
      }
    },
    normalizationPolicy: { type: ['string', 'null'] }
  }
};

const DOCUMENT_EXTRACTION_SUMMARY = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'files', 'extractors', 'totals'],
  properties: {
    schemaVersion: { type: 'number' },
    files: { type: 'array', items: DOCUMENT_EXTRACTION_FILE_ENTRY },
    extractors: { type: 'array', items: DOCUMENT_EXTRACTION_EXTRACTOR },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: ['files', 'pages', 'paragraphs', 'units'],
      properties: {
        files: { type: 'number' },
        pages: { type: 'number' },
        paragraphs: { type: 'number' },
        units: { type: 'number' }
      }
    }
  }
};

const ORDERING_LEDGER_SEEDS = {
  type: 'object',
  additionalProperties: {
    anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }]
  }
};

const ORDERING_LEDGER_ARTIFACT = {
  type: 'object',
  additionalProperties: false,
  required: ['hash'],
  properties: {
    hash: { type: 'string' },
    rule: { type: ['string', 'null'] },
    count: { type: ['number', 'null'] },
    mode: { type: ['string', 'null'] }
  }
};

const ORDERING_LEDGER_STAGE = {
  type: 'object',
  additionalProperties: false,
  required: ['artifacts'],
  properties: {
    updatedAt: ISO_DATE_TIME,
    seeds: ORDERING_LEDGER_SEEDS,
    artifacts: {
      type: 'object',
      additionalProperties: ORDERING_LEDGER_ARTIFACT
    }
  }
};

const ORDERING_LEDGER = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'stages'],
  properties: {
    schemaVersion: { type: 'number' },
    updatedAt: ISO_DATE_TIME,
    seeds: ORDERING_LEDGER_SEEDS,
    stages: {
      type: 'object',
      additionalProperties: ORDERING_LEDGER_STAGE
    }
  }
};

const REPO_HEAD = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    commitId: { type: ['string', 'null'] },
    changeId: { type: ['string', 'null'] },
    operationId: { type: ['string', 'null'] },
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
    documentExtraction: {
      type: 'object',
      additionalProperties: DOCUMENT_EXTRACTION_SUMMARY
    },
    orderingLedger: ORDERING_LEDGER,
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
