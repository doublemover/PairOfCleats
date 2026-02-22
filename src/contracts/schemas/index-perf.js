const INDEX_OPTIMIZATION_PROFILES = ['default', 'throughput', 'memory-saver'];

const PERF_STAGE_METRIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['wallMs', 'cpuBusyPct', 'queueDepth', 'inFlightBytes', 'workerUtilizationPct'],
  properties: {
    wallMs: { type: 'number', minimum: 0 },
    cpuBusyPct: { type: 'number', minimum: 0, maximum: 100 },
    queueDepth: { type: 'number', minimum: 0 },
    inFlightBytes: { type: 'number', minimum: 0 },
    workerUtilizationPct: { type: 'number', minimum: 0, maximum: 100 }
  }
};

export const INDEX_PERF_CORPUS_MANIFEST_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'index-perf-corpus-manifest',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'generatedAt', 'corpusId', 'files', 'totals'],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    generatedAt: { type: 'string' },
    corpusId: { type: 'string' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'sizeBytes', 'language'],
        properties: {
          path: { type: 'string' },
          sizeBytes: { type: 'number', minimum: 0 },
          language: { type: 'string' }
        }
      }
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: ['files', 'bytes'],
      properties: {
        files: { type: 'integer', minimum: 0 },
        bytes: { type: 'number', minimum: 0 }
      }
    }
  }
};

export const INDEX_PERF_TELEMETRY_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'index-perf-telemetry',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'generatedAt', 'phase', 'indexOptimizationProfile', 'stageMetrics'],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    generatedAt: { type: 'string' },
    phase: { type: 'string', enum: ['baseline', 'after'] },
    indexOptimizationProfile: { type: 'string', enum: INDEX_OPTIMIZATION_PROFILES },
    stageMetrics: {
      type: 'object',
      additionalProperties: false,
      required: ['scan', 'read', 'chunk', 'parse', 'relation'],
      properties: {
        scan: PERF_STAGE_METRIC_SCHEMA,
        read: PERF_STAGE_METRIC_SCHEMA,
        chunk: PERF_STAGE_METRIC_SCHEMA,
        parse: PERF_STAGE_METRIC_SCHEMA,
        relation: PERF_STAGE_METRIC_SCHEMA
      }
    }
  }
};

export const INDEX_PERF_DELTA_REPORT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'index-perf-delta-report',
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'generatedAt', 'indexOptimizationProfile', 'baselineRef', 'afterRef', 'deltaByStage'],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    generatedAt: { type: 'string' },
    indexOptimizationProfile: { type: 'string', enum: INDEX_OPTIMIZATION_PROFILES },
    baselineRef: { type: 'string' },
    afterRef: { type: 'string' },
    deltaByStage: {
      type: 'object',
      additionalProperties: false,
      required: ['scan', 'read', 'chunk', 'parse', 'relation'],
      properties: {
        scan: { type: 'number' },
        read: { type: 'number' },
        chunk: { type: 'number' },
        parse: { type: 'number' },
        relation: { type: 'number' }
      }
    }
  }
};

export const INDEX_PERF_SCHEMA_DEFS = Object.freeze({
  corpusManifest: INDEX_PERF_CORPUS_MANIFEST_SCHEMA,
  telemetry: INDEX_PERF_TELEMETRY_SCHEMA,
  deltaReport: INDEX_PERF_DELTA_REPORT_SCHEMA
});
