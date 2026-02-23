const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const posInt = { type: 'integer', minimum: 1 };
const semverString = { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' };
const modeName = { type: 'string', enum: ['code', 'prose', 'extracted-prose', 'records'] };

const fileListBucket = {
  type: 'object',
  required: ['count', 'sample'],
  properties: {
    count: intId,
    sample: { type: 'array', items: { type: 'object' } }
  },
  additionalProperties: true
};

const fileListsSchema = {
  type: 'object',
  required: ['generatedAt', 'scanned', 'skipped'],
  properties: {
    generatedAt: { type: 'string' },
    scanned: fileListBucket,
    skipped: fileListBucket,
    extensions: { type: 'object' }
  },
  additionalProperties: false
};

const extractionReportExtractor = {
  type: ['object', 'null'],
  properties: {
    name: nullableString,
    version: nullableString,
    target: nullableString
  },
  additionalProperties: false
};

const extractionReportFile = {
  type: 'object',
  required: [
    'file',
    'sourceType',
    'status',
    'reason',
    'extractor',
    'sourceBytesHash',
    'sourceBytesHashAlgo',
    'normalizationPolicy',
    'chunkerVersion',
    'extractionConfigDigest',
    'extractionIdentityHash',
    'unitCounts',
    'warnings'
  ],
  properties: {
    file: { type: 'string' },
    sourceType: { type: 'string', enum: ['pdf', 'docx'] },
    status: { type: 'string', enum: ['ok', 'skipped'] },
    reason: nullableString,
    extractor: extractionReportExtractor,
    sourceBytesHash: nullableString,
    sourceBytesHashAlgo: nullableString,
    normalizationPolicy: nullableString,
    chunkerVersion: nullableString,
    extractionConfigDigest: { type: 'string' },
    extractionIdentityHash: nullableString,
    unitCounts: {
      anyOf: [
        {
          type: 'object',
          required: ['pages', 'paragraphs', 'totalUnits'],
          properties: {
            pages: intId,
            paragraphs: intId,
            totalUnits: intId
          },
          additionalProperties: false
        },
        { type: 'null' }
      ]
    },
    warnings: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: false
};

/**
 * Low-yield bailout is a deterministic gate decision record.
 * Every decision-context field stays required even when `triggered=false`,
 * so downstream diagnostics do not need null-guards for schema-level fields.
 */
const extractionReportLowYieldBailout = {
  type: 'object',
  required: [
    'enabled',
    'triggered',
    'reason',
    'qualityImpact',
    'seed',
    'warmupWindowSize',
    'warmupSampleSize',
    'sampledFiles',
    'sampledYieldedFiles',
    'sampledChunkCount',
    'observedYieldRatio',
    'minYieldRatio',
    'minYieldedFiles',
    'skippedFiles',
    'decisionAtOrderIndex',
    'decisionAt',
    'deterministic',
    'downgradedRecall'
  ],
  properties: {
    enabled: { type: 'boolean' },
    triggered: { type: 'boolean' },
    reason: nullableString,
    qualityImpact: nullableString,
    seed: nullableString,
    warmupWindowSize: intId,
    warmupSampleSize: intId,
    sampledFiles: intId,
    sampledYieldedFiles: intId,
    sampledChunkCount: intId,
    observedYieldRatio: { type: 'number' },
    minYieldRatio: { type: 'number' },
    minYieldedFiles: intId,
    skippedFiles: intId,
    decisionAtOrderIndex: nullableInt,
    decisionAt: nullableString,
    deterministic: { type: 'boolean' },
    downgradedRecall: { type: 'boolean' }
  },
  additionalProperties: false
};

const extractionReportQuality = {
  type: 'object',
  required: ['lowYieldBailout'],
  properties: {
    lowYieldBailout: extractionReportLowYieldBailout
  },
  additionalProperties: false
};

/**
 * Extraction report invariants:
 * - `mode` is locked to `extracted-prose`.
 * - `files[*].unitCounts` is always present but nullable for skipped sources.
 * - `counts.byReason` allows extensible reason keys while preserving integer values.
 */
const extractionReportSchema = {
  type: 'object',
  required: [
    'schemaVersion',
    'mode',
    'generatedAt',
    'chunkerVersion',
    'extractionConfigDigest',
    'quality',
    'counts',
    'extractors',
    'files'
  ],
  properties: {
    schemaVersion: posInt,
    mode: { type: 'string', const: 'extracted-prose' },
    generatedAt: { type: 'string' },
    chunkerVersion: { type: 'string' },
    extractionConfigDigest: { type: 'string' },
    quality: extractionReportQuality,
    counts: {
      type: 'object',
      required: ['total', 'ok', 'skipped', 'byReason'],
      properties: {
        total: intId,
        ok: intId,
        skipped: intId,
        byReason: { type: 'object', additionalProperties: intId }
      },
      additionalProperties: false
    },
    extractors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'version', 'target'],
        properties: {
          name: nullableString,
          version: nullableString,
          target: nullableString
        },
        additionalProperties: false
      }
    },
    files: { type: 'array', items: extractionReportFile }
  },
  additionalProperties: false
};

const lexiconRelationFilterCategoryCounts = {
  type: 'object',
  required: ['keywords', 'literals', 'builtins', 'types'],
  properties: {
    keywords: intId,
    literals: intId,
    builtins: intId,
    types: intId
  },
  additionalProperties: false
};

const lexiconRelationFilterReportFile = {
  type: 'object',
  required: [
    'file',
    'languageId',
    'droppedCalls',
    'droppedUsages',
    'droppedCallDetails',
    'droppedCallDetailsWithRange',
    'droppedTotal',
    'droppedCallsByCategory',
    'droppedUsagesByCategory'
  ],
  properties: {
    file: { type: 'string' },
    languageId: nullableString,
    droppedCalls: intId,
    droppedUsages: intId,
    droppedCallDetails: intId,
    droppedCallDetailsWithRange: intId,
    droppedTotal: intId,
    droppedCallsByCategory: lexiconRelationFilterCategoryCounts,
    droppedUsagesByCategory: lexiconRelationFilterCategoryCounts
  },
  additionalProperties: false
};

const lexiconRelationFilterReportSchema = {
  type: 'object',
  required: ['schemaVersion', 'mode', 'totals', 'files'],
  properties: {
    schemaVersion: posInt,
    mode: modeName,
    totals: {
      type: 'object',
      required: [
        'files',
        'droppedCalls',
        'droppedUsages',
        'droppedCallDetails',
        'droppedCallDetailsWithRange',
        'droppedTotal'
      ],
      properties: {
        files: intId,
        droppedCalls: intId,
        droppedUsages: intId,
        droppedCallDetails: intId,
        droppedCallDetailsWithRange: intId,
        droppedTotal: intId
      },
      additionalProperties: false
    },
    files: {
      type: 'array',
      items: lexiconRelationFilterReportFile
    }
  },
  additionalProperties: false
};

const boilerplateCatalogEntry = {
  type: 'object',
  required: ['ref', 'count', 'positions', 'tags', 'sampleFiles'],
  properties: {
    ref: { type: 'string' },
    count: intId,
    positions: {
      type: 'object',
      additionalProperties: intId
    },
    tags: { type: 'array', items: { type: 'string' } },
    sampleFiles: { type: 'array', items: { type: 'string' } }
  },
  additionalProperties: false
};

const boilerplateCatalogSchema = {
  type: 'object',
  required: ['schemaVersion', 'generatedAt', 'entries'],
  properties: {
    schemaVersion: semverString,
    generatedAt: { type: 'string' },
    entries: {
      type: 'array',
      items: boilerplateCatalogEntry
    }
  },
  additionalProperties: false
};

export const REPORT_ARTIFACT_SCHEMA_DEFS = {
  filelists: fileListsSchema,
  extraction_report: extractionReportSchema,
  lexicon_relation_filter_report: lexiconRelationFilterReportSchema,
  boilerplate_catalog: boilerplateCatalogSchema,
  determinism_report: {
    type: 'object',
    required: [
      'schemaVersion',
      'generatedAt',
      'mode',
      'stableHashExclusions',
      'sourceReasons',
      'normalizedStateHash'
    ],
    properties: {
      schemaVersion: { type: 'integer', minimum: 1 },
      generatedAt: { type: 'string' },
      mode: nullableString,
      stableHashExclusions: {
        type: 'array',
        items: { type: 'string' }
      },
      sourceReasons: {
        type: 'array',
        items: {
          type: 'object',
          required: ['path', 'category', 'reason', 'source'],
          properties: {
            path: { type: 'string' },
            category: { type: 'string' },
            reason: { type: 'string' },
            source: { type: 'string' }
          },
          additionalProperties: false
        }
      },
      normalizedStateHash: nullableString
    },
    additionalProperties: false
  }
};
