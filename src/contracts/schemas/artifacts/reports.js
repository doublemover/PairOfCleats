const intId = { type: 'integer', minimum: 0 };
const nullableString = { type: ['string', 'null'] };
const nullableInt = { type: ['integer', 'null'], minimum: 0 };
const nullableNumber = { type: ['number', 'null'] };
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
    'suppressedCohortCount',
    'protectedCohortCount',
    'strategyMismatchRiskCount',
    'estimatedSuppressedFiles',
    'estimatedRecallLossRatio',
    'estimatedRecallLossClass',
    'estimatedRecallLossConfidence',
    'skippedFiles',
    'decisionAtOrderIndex',
    'decisionAt',
    'repoFingerprint',
    'suppressedCohorts',
    'protectedCohorts',
    'strategyMismatchRiskCohorts',
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
    suppressedCohortCount: intId,
    protectedCohortCount: intId,
    strategyMismatchRiskCount: intId,
    estimatedSuppressedFiles: intId,
    estimatedRecallLossRatio: { type: 'number' },
    estimatedRecallLossClass: nullableString,
    estimatedRecallLossConfidence: nullableString,
    skippedFiles: intId,
    decisionAtOrderIndex: nullableInt,
    decisionAt: nullableString,
    repoFingerprint: {
      type: 'object',
      required: ['totalEntries', 'docLikeEntries', 'dominantCohort', 'cohortCounts'],
      properties: {
        totalEntries: intId,
        docLikeEntries: intId,
        dominantCohort: nullableString,
        cohortCounts: {
          type: 'object',
          additionalProperties: intId
        }
      },
      additionalProperties: false
    },
    suppressedCohorts: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'key',
          'suppressionClass',
          'expectedYieldClass',
          'warmupFiles',
          'sampledFiles',
          'sampledObservedFiles',
          'sampledYieldedFiles',
          'sampledChunkCount',
          'repoFiles',
          'estimatedSuppressedFiles',
          'estimatedRecallLossRatio'
        ],
        properties: {
          key: { type: 'string' },
          suppressionClass: nullableString,
          expectedYieldClass: { type: 'string' },
          warmupFiles: intId,
          sampledFiles: intId,
          sampledObservedFiles: intId,
          sampledYieldedFiles: intId,
          sampledChunkCount: intId,
          repoFiles: intId,
          estimatedSuppressedFiles: intId,
          estimatedRecallLossRatio: { type: 'number' }
        },
        additionalProperties: false
      }
    },
    protectedCohorts: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'key',
          'expectedYieldClass',
          'strategyMismatchRisk',
          'protectedBySample',
          'protectedByHistory',
          'protectedByPriority'
        ],
        properties: {
          key: { type: 'string' },
          expectedYieldClass: { type: 'string' },
          strategyMismatchRisk: { type: 'boolean' },
          protectedBySample: { type: 'boolean' },
          protectedByHistory: { type: 'boolean' },
          protectedByPriority: { type: 'boolean' }
        },
        additionalProperties: false
      }
    },
    strategyMismatchRiskCohorts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'expectedYieldClass'],
        properties: {
          key: { type: 'string' },
          expectedYieldClass: { type: 'string' }
        },
        additionalProperties: false
      }
    },
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

const scanProfileCountMap = {
  type: 'object',
  additionalProperties: intId
};

const scanProfileLanguageLines = {
  type: 'object',
  additionalProperties: intId
};

const scanProfileModeSchema = {
  type: 'object',
  required: [
    'mode',
    'indexDir',
    'cache',
    'files',
    'chunks',
    'tokens',
    'lines',
    'bytes',
    'artifacts',
    'timings',
    'throughput',
    'queues',
    'quality'
  ],
  properties: {
    mode: modeName,
    indexDir: nullableString,
    cache: {
      type: 'object',
      required: ['hits', 'misses', 'hitRate'],
      properties: {
        hits: nullableInt,
        misses: nullableInt,
        hitRate: nullableNumber
      },
      additionalProperties: false
    },
    files: {
      type: 'object',
      required: ['candidates', 'scanned', 'skipped', 'skippedByReason'],
      properties: {
        candidates: nullableInt,
        scanned: nullableInt,
        skipped: nullableInt,
        skippedByReason: scanProfileCountMap
      },
      additionalProperties: false
    },
    chunks: {
      type: 'object',
      required: ['total', 'avgTokens'],
      properties: {
        total: nullableInt,
        avgTokens: nullableNumber
      },
      additionalProperties: false
    },
    tokens: {
      type: 'object',
      required: ['total', 'vocab'],
      properties: {
        total: nullableInt,
        vocab: nullableInt
      },
      additionalProperties: false
    },
    lines: {
      type: 'object',
      required: ['total', 'byLanguage'],
      properties: {
        total: nullableInt,
        byLanguage: scanProfileLanguageLines
      },
      additionalProperties: false
    },
    bytes: {
      type: 'object',
      required: ['source', 'artifact'],
      properties: {
        source: nullableInt,
        artifact: nullableInt
      },
      additionalProperties: false
    },
    artifacts: {
      type: 'object',
      required: ['filterIndex'],
      properties: {
        filterIndex: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: true
            }
          ]
        }
      },
      additionalProperties: false
    },
    timings: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: {
            anyOf: [
              { type: 'number' },
              { type: 'integer' },
              { type: 'boolean' },
              { type: 'string' },
              {
                type: 'object',
                additionalProperties: true
              }
            ]
          }
        }
      ]
    },
    throughput: {
      type: 'object',
      required: [
        'totalMs',
        'writeMs',
        'filesPerSec',
        'chunksPerSec',
        'tokensPerSec',
        'bytesPerSec',
        'linesPerSec',
        'writeBytesPerSec'
      ],
      properties: {
        totalMs: nullableNumber,
        writeMs: nullableNumber,
        filesPerSec: nullableNumber,
        chunksPerSec: nullableNumber,
        tokensPerSec: nullableNumber,
        bytesPerSec: nullableNumber,
        linesPerSec: nullableNumber,
        writeBytesPerSec: nullableNumber
      },
      additionalProperties: false
    },
    queues: {
      type: 'object',
      required: ['postings'],
      properties: {
        postings: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              additionalProperties: true
            }
          ]
        }
      },
      additionalProperties: false
    },
    quality: {
      type: 'object',
      required: ['lowYieldBailout'],
      properties: {
        lowYieldBailout: {
          anyOf: [
            { type: 'null' },
            extractionReportLowYieldBailout
          ]
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

const scanProfileSchema = {
  type: 'object',
  required: [
    'schemaVersion',
    'generatedAt',
    'source',
    'repo',
    'modes',
    'totals',
    'languageLines'
  ],
  properties: {
    schemaVersion: posInt,
    generatedAt: { type: 'string' },
    source: { type: 'string', const: 'report-artifacts' },
    repo: {
      type: 'object',
      required: ['root', 'cacheRoot'],
      properties: {
        root: nullableString,
        cacheRoot: nullableString
      },
      additionalProperties: false
    },
    modes: {
      type: 'object',
      required: ['code', 'prose', 'extracted-prose', 'records'],
      properties: {
        code: scanProfileModeSchema,
        prose: scanProfileModeSchema,
        'extracted-prose': scanProfileModeSchema,
        records: scanProfileModeSchema
      },
      additionalProperties: false
    },
    totals: {
      type: 'object',
      required: [
        'files',
        'chunks',
        'tokens',
        'lines',
        'bytes',
        'durationMs',
        'filesPerSec',
        'chunksPerSec',
        'tokensPerSec',
        'bytesPerSec',
        'linesPerSec'
      ],
      properties: {
        files: {
          type: 'object',
          required: ['candidates', 'scanned', 'skipped'],
          properties: {
            candidates: intId,
            scanned: intId,
            skipped: intId
          },
          additionalProperties: false
        },
        chunks: intId,
        tokens: intId,
        lines: nullableInt,
        bytes: {
          type: 'object',
          required: ['source', 'artifact'],
          properties: {
            source: nullableInt,
            artifact: intId
          },
          additionalProperties: false
        },
        durationMs: nullableNumber,
        filesPerSec: nullableNumber,
        chunksPerSec: nullableNumber,
        tokensPerSec: nullableNumber,
        bytesPerSec: nullableNumber,
        linesPerSec: nullableNumber
      },
      additionalProperties: false
    },
    languageLines: scanProfileLanguageLines
  },
  additionalProperties: false
};

export const REPORT_ARTIFACT_SCHEMA_DEFS = {
  filelists: fileListsSchema,
  extraction_report: extractionReportSchema,
  scan_profile: scanProfileSchema,
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
