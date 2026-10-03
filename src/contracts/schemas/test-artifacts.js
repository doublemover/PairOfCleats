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

export const TEST_COVERAGE_POLICY_REPORT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'test-coverage-policy-report',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'generatedAt',
    'kind',
    'policyVersion',
    'mode',
    'sourceCoverageKind',
    'sourceCoverageRunId',
    'overall',
    'changedFiles',
    'criticalSurfaces',
    'policy'
  ],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    generatedAt: { type: 'string' },
    kind: { type: 'string', const: 'test-coverage-policy-report' },
    policyVersion: { type: 'string' },
    mode: { type: 'string' },
    sourceCoverageKind: { type: 'string' },
    sourceCoverageRunId: { type: 'string' },
    overall: {
      type: 'object',
      additionalProperties: false,
      required: ['files', 'coveredRanges', 'totalRanges', 'coverageFraction'],
      properties: {
        files: { type: 'integer' },
        coveredRanges: { type: 'number' },
        totalRanges: { type: 'number' },
        coverageFraction: { type: ['number', 'null'] }
      }
    },
    changedFiles: {
      type: 'object',
      additionalProperties: false,
      required: ['available', 'strategy', 'baseRef', 'headRef', 'reason', 'summary', 'files'],
      properties: {
        available: { type: 'boolean' },
        strategy: { type: 'string' },
        baseRef: { type: ['string', 'null'] },
        headRef: { type: ['string', 'null'] },
        reason: { type: ['string', 'null'] },
        summary: {
          type: 'object',
          additionalProperties: false,
          required: ['files', 'coveredRanges', 'totalRanges', 'coverageFraction'],
          properties: {
            files: { type: 'integer' },
            coveredRanges: { type: 'number' },
            totalRanges: { type: 'number' },
            coverageFraction: { type: ['number', 'null'] }
          }
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'coveredRanges', 'totalRanges', 'coverageFraction'],
            properties: {
              path: { type: 'string' },
              coveredRanges: { type: 'number' },
              totalRanges: { type: 'number' },
              coverageFraction: { type: ['number', 'null'] }
            }
          }
        }
      }
    },
    criticalSurfaces: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'patterns', 'summary', 'topUncoveredFiles'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          patterns: {
            type: 'array',
            items: { type: 'string' }
          },
          summary: {
            type: 'object',
            additionalProperties: false,
            required: ['files', 'coveredRanges', 'totalRanges', 'coverageFraction'],
            properties: {
              files: { type: 'integer' },
              coveredRanges: { type: 'number' },
              totalRanges: { type: 'number' },
              coverageFraction: { type: ['number', 'null'] }
            }
          },
          topUncoveredFiles: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'coveredRanges', 'totalRanges', 'coverageFraction'],
              properties: {
                path: { type: 'string' },
                coveredRanges: { type: 'number' },
                totalRanges: { type: 'number' },
                coverageFraction: { type: ['number', 'null'] }
              }
            }
          }
        }
      }
    },
    policy: {
      type: 'object',
      additionalProperties: false,
      required: ['phase', 'progression'],
      properties: {
        phase: { type: 'string' },
        progression: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    }
  }
};

const TEST_RUN_ENTRY_SCHEMA = {
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
};

const TEST_STABILITY_FAMILY_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tests',
    'unstable',
    'flaky',
    'slow',
    'environmentSensitive',
    'failed',
    'timedOut',
    'redo',
    'avgDurationMs',
    'maxDurationMs'
  ],
  properties: {
    id: { type: 'string' },
    tests: { type: 'integer' },
    unstable: { type: 'integer' },
    flaky: { type: 'integer' },
    slow: { type: 'integer' },
    environmentSensitive: { type: 'integer' },
    failed: { type: 'integer' },
    timedOut: { type: 'integer' },
    redo: { type: 'integer' },
    avgDurationMs: { type: 'number' },
    maxDurationMs: { type: 'number' }
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
      items: TEST_RUN_ENTRY_SCHEMA
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
      items: TEST_RUN_ENTRY_SCHEMA
    }
  }
};

export const TEST_STABILITY_ARTIFACT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'test-stability-artifact',
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'generatedAt',
    'runId',
    'pathPolicy',
    'timeUnit',
    'lane',
    'history',
    'environment',
    'policy',
    'diagnostics',
    'summary',
    'suiteCategories',
    'familyTrends',
    'families',
    'tests'
  ],
  properties: {
    schemaVersion: { type: 'number', const: 1 },
    generatedAt: { type: 'string' },
    runId: { type: 'string' },
    pathPolicy: { type: 'string', const: 'repo-relative-posix' },
    timeUnit: { type: 'string', const: 'ms' },
    lane: { type: 'string' },
    history: {
      type: 'object',
      additionalProperties: false,
      required: ['sourceDir', 'loadedArtifacts', 'historyLimit'],
      properties: {
        sourceDir: { type: ['string', 'null'] },
        loadedArtifacts: { type: 'integer' },
        historyLimit: { type: 'integer' }
      }
    },
    environment: {
      type: 'object',
      additionalProperties: false,
      required: ['fingerprint', 'platform', 'arch', 'node', 'ci', 'suiteMode'],
      properties: {
        fingerprint: { type: 'string' },
        platform: { type: 'string' },
        arch: { type: 'string' },
        node: { type: 'string' },
        ci: { type: 'boolean' },
        suiteMode: { type: ['string', 'null'] }
      }
    },
    policy: {
      type: 'object',
      additionalProperties: false,
      required: ['retry', 'quarantine', 'escalation', 'retryBySuiteCategory'],
      properties: {
        retry: {
          type: 'object',
          additionalProperties: false,
          required: ['runnerRetries', 'automaticRetryEnabled', 'note'],
          properties: {
            runnerRetries: { type: 'integer' },
            automaticRetryEnabled: { type: 'boolean' },
            note: { type: 'string' }
          }
        },
        quarantine: {
          type: 'object',
          additionalProperties: false,
          required: ['automaticQuarantine', 'note'],
          properties: {
            automaticQuarantine: { type: 'boolean' },
            note: { type: 'string' }
          }
        },
        escalation: {
          type: 'object',
          additionalProperties: false,
          required: ['flaky', 'slow', 'environmentSensitive'],
          properties: {
            flaky: { type: 'string' },
            slow: { type: 'string' },
            environmentSensitive: { type: 'string' }
          }
        },
        retryBySuiteCategory: {
          type: 'object',
          additionalProperties: false,
          required: ['hero', 'matrix', 'meta', 'soak', 'heavy-runtime'],
          properties: {
            hero: {
              type: 'object',
              additionalProperties: false,
              required: ['maxRetries', 'quarantine', 'note'],
              properties: {
                maxRetries: { type: 'integer' },
                quarantine: { type: 'string' },
                note: { type: 'string' }
              }
            },
            matrix: {
              type: 'object',
              additionalProperties: false,
              required: ['maxRetries', 'quarantine', 'note'],
              properties: {
                maxRetries: { type: 'integer' },
                quarantine: { type: 'string' },
                note: { type: 'string' }
              }
            },
            meta: {
              type: 'object',
              additionalProperties: false,
              required: ['maxRetries', 'quarantine', 'note'],
              properties: {
                maxRetries: { type: 'integer' },
                quarantine: { type: 'string' },
                note: { type: 'string' }
              }
            },
            soak: {
              type: 'object',
              additionalProperties: false,
              required: ['maxRetries', 'quarantine', 'note'],
              properties: {
                maxRetries: { type: 'integer' },
                quarantine: { type: 'string' },
                note: { type: 'string' }
              }
            },
            'heavy-runtime': {
              type: 'object',
              additionalProperties: false,
              required: ['maxRetries', 'quarantine', 'note'],
              properties: {
                maxRetries: { type: 'integer' },
                quarantine: { type: 'string' },
                note: { type: 'string' }
              }
            }
          }
        }
      }
    },
    diagnostics: {
      type: 'object',
      additionalProperties: false,
      required: ['expectedNegativeStderrIds', 'diagnosticsClasses'],
      properties: {
        expectedNegativeStderrIds: {
          type: 'array',
          items: { type: 'string' }
        },
        diagnosticsClasses: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    },
    summary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'tests',
        'unstable',
        'flaky',
        'slow',
        'environmentSensitive',
        'failed',
        'timedOut',
        'redo',
        'expectedNegativeStderr',
        'unexpectedStderr'
      ],
      properties: {
        tests: { type: 'integer' },
        unstable: { type: 'integer' },
        flaky: { type: 'integer' },
        slow: { type: 'integer' },
        environmentSensitive: { type: 'integer' },
        failed: { type: 'integer' },
        timedOut: { type: 'integer' },
        redo: { type: 'integer' },
        expectedNegativeStderr: { type: 'integer' },
        unexpectedStderr: { type: 'integer' }
      }
    },
    suiteCategories: {
      type: 'object',
      additionalProperties: false,
      required: ['hero', 'matrix', 'meta', 'soak', 'heavy-runtime'],
      properties: {
        hero: { type: 'integer' },
        matrix: { type: 'integer' },
        meta: { type: 'integer' },
        soak: { type: 'integer' },
        'heavy-runtime': { type: 'integer' }
      }
    },
    familyTrends: {
      type: 'array',
      items: TEST_STABILITY_FAMILY_SUMMARY_SCHEMA
    },
    families: {
      type: 'array',
      items: TEST_STABILITY_FAMILY_SUMMARY_SCHEMA
    },
    tests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'path',
          'lane',
          'family',
          'suiteCategory',
          'status',
          'durationMs',
          'timeoutBudgetMs',
          'stabilityClass',
          'diagnosticsClass',
          'outcomeClass',
          'historyWindow',
          'historyOutcomes',
          'historyEnvironments',
          'environmentFingerprint'
        ],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' },
          lane: { type: 'string' },
          family: { type: 'string' },
          suiteCategory: { type: 'string', enum: ['hero', 'matrix', 'meta', 'soak', 'heavy-runtime'] },
          status: { type: 'string' },
          durationMs: { type: 'number' },
          timeoutBudgetMs: { type: 'number' },
          stabilityClass: {
            type: 'string',
            enum: ['stable', 'slow', 'flaky', 'environment-sensitive']
          },
          diagnosticsClass: {
            type: 'string',
            enum: ['clean', 'expected-negative-stderr', 'unexpected-stderr']
          },
          outcomeClass: {
            type: 'string',
            enum: ['passed', 'failed', 'timed_out', 'skipped', 'redo']
          },
          historyWindow: { type: 'integer' },
          historyOutcomes: {
            type: 'array',
            items: { type: 'string' }
          },
          historyEnvironments: {
            type: 'array',
            items: { type: 'string' }
          },
          environmentFingerprint: { type: 'string' }
        }
      }
    }
  }
};

export const TEST_ARTIFACT_SCHEMA_DEFS = Object.freeze({
  testCoverage: TEST_COVERAGE_ARTIFACT_SCHEMA,
  testCoveragePolicyReport: TEST_COVERAGE_POLICY_REPORT_SCHEMA,
  testTimings: TEST_TIMINGS_ARTIFACT_SCHEMA,
  testProfile: TEST_PROFILE_ARTIFACT_SCHEMA,
  testStability: TEST_STABILITY_ARTIFACT_SCHEMA
});
