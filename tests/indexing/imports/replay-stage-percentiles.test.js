#!/usr/bin/env node
import assert from 'node:assert/strict';
import { aggregateImportResolutionGraphPayloads } from '../../../src/index/build/import-resolution.js';

const makeReport = (elapsedMs, reportIndex) => ({
  reportPath: `repo-${reportIndex}/import_resolution_graph.json`,
  payload: {
    generatedAt: new Date(1700000000000 + reportIndex).toISOString(),
    stats: {
      unresolved: 1,
      unresolvedActionable: 1,
      resolverPipelineStages: {
        language_resolver: {
          attempts: 1,
          hits: 1,
          misses: 0,
          elapsedMs,
          budgetExhausted: 0,
          degraded: 0
        }
      }
    },
    warnings: [
      {
        importer: 'src/main.js',
        specifier: './missing.js',
        reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
        failureCause: 'missing_file',
        disposition: 'actionable',
        resolverStage: 'filesystem_probe',
        resolutionState: 'unresolved'
      }
    ]
  }
});

const aggregated = aggregateImportResolutionGraphPayloads([
  makeReport(10, 0),
  makeReport(20, 1),
  makeReport(30, 2),
  makeReport(40, 3)
]);

assert.deepEqual(
  aggregated?.resolverPipelineStagePercentiles?.language_resolver,
  {
    samples: 4,
    max: 40,
    p50: 25,
    p95: 38.5,
    p99: 39.7
  },
  'expected deterministic stage elapsed percentiles'
);

console.log('import-resolution replay stage percentiles test passed');
