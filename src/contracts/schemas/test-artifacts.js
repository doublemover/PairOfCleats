export const TEST_COVERAGE_ARTIFACT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'test-coverage-artifact',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'generatedAt',
    'runId',
    'pathPolicy',
    'kind',
    'summary',
    'entries'
  ],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    generatedAt: { type: 'string' },
    runId: { type: 'string' },
    pathPolicy: { type: 'string', const: 'repo-relative-posix' },
    kind: { type: 'string', const: 'v8-range-summary' },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['files', 'coveredRanges', 'totalRanges'],
      properties: {
        files: { type: 'integer' },
        coveredRanges: { type: 'number' },
        totalRanges: { type: 'number' }
      }
    },
    entries: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'coveredRanges', 'totalRanges'],
        properties: {
          path: { type: 'string' },
          coveredRanges: { type: 'number' },
          totalRanges: { type: 'number' }
        }
      }
    }
  }
};

export const TEST_TIMINGS_ARTIFACT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'test-timings-artifact',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'generatedAt',
    'runId',
    'totalMs',
    'pathPolicy',
    'timeUnit',
    'watchdog',
    'tests'
  ],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    generatedAt: { type: 'string' },
    runId: { type: 'string' },
    totalMs: { type: 'number' },
    pathPolicy: { type: 'string', const: 'repo-relative-posix' },
    timeUnit: { type: 'string', const: 'ms' },
    watchdog: {
      type: 'object',
      additionalProperties: false,
      required: ['triggered', 'reason'],
      properties: {
        triggered: { type: 'boolean' },
        reason: { type: ['string', 'null'] }
      }
    },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'path', 'lane', 'status', 'durationMs'],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' },
          lane: { type: 'string' },
          status: { type: 'string' },
          durationMs: { type: 'number' }
        }
      }
    }
  }
};

export const TEST_PROFILE_ARTIFACT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'test-profile-artifact',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'generatedAt',
    'runId',
    'pathPolicy',
    'timeUnit',
    'summary',
    'tests'
  ],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    generatedAt: { type: 'string' },
    runId: { type: 'string' },
    pathPolicy: { type: 'string', const: 'repo-relative-posix' },
    timeUnit: { type: 'string', const: 'ms' },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: ['totalMs', 'tests', 'passed', 'failed', 'skipped'],
      properties: {
        totalMs: { type: 'number' },
        tests: { type: 'integer' },
        passed: { type: 'integer' },
        failed: { type: 'integer' },
        skipped: { type: 'integer' },
        watchdogTriggered: { type: 'boolean' }
      }
    },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'path', 'lane', 'status', 'durationMs'],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' },
          lane: { type: 'string' },
          status: { type: 'string' },
          durationMs: { type: 'number' }
        }
      }
    }
  }
};

export const TEST_ARTIFACT_SCHEMA_DEFS = Object.freeze({
  testCoverage: TEST_COVERAGE_ARTIFACT_SCHEMA,
  testTimings: TEST_TIMINGS_ARTIFACT_SCHEMA,
  testProfile: TEST_PROFILE_ARTIFACT_SCHEMA
});
