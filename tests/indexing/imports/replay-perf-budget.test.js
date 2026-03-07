#!/usr/bin/env node
import assert from 'node:assert/strict';
import { aggregateImportResolutionGraphPayloads } from '../../../src/index/build/import-resolution.js';

const makeWarning = (index) => {
  const id = index % 7;
  if (id === 0) {
    return {
      importer: `src/feature${index % 13}.ts`,
      specifier: `./missing-${index % 11}.ts`,
      reasonCode: 'IMP_U_MISSING_FILE_RELATIVE',
      failureCause: 'missing_file',
      disposition: 'actionable',
      resolverStage: 'filesystem_probe',
      resolutionState: 'unresolved'
    };
  }
  if (id === 1) {
    return {
      importer: `tests/fixtures/f${index % 9}.spec.ts`,
      specifier: `./fixture-${index % 5}.ts`,
      reasonCode: 'IMP_U_FIXTURE_REFERENCE',
      failureCause: 'parser_artifact',
      disposition: 'suppress_live',
      resolverStage: 'classify',
      resolutionState: 'unresolved'
    };
  }
  if (id === 2) {
    return {
      importer: `build/defs${index % 5}.bzl`,
      specifier: `//pkg:target-${index % 6}.bzl`,
      reasonCode: 'IMP_U_RESOLVER_GAP',
      failureCause: 'resolver_gap',
      disposition: 'suppress_gate',
      resolverStage: 'language_resolver',
      resolutionState: 'unresolved'
    };
  }
  return {
    importer: `src/mod${index % 17}.js`,
    specifier: `pkg-${index % 15}`,
    reasonCode: 'IMP_U_MISSING_DEPENDENCY_PACKAGE',
    failureCause: 'missing_dependency',
    disposition: 'actionable',
    resolverStage: 'language_resolver',
    resolutionState: 'unresolved'
  };
};

const buildSyntheticReports = ({ reportCount = 320, warningsPerReport = 180 } = {}) => {
  const reports = [];
  for (let reportIndex = 0; reportIndex < reportCount; reportIndex += 1) {
    const warnings = [];
    for (let warningIndex = 0; warningIndex < warningsPerReport; warningIndex += 1) {
      warnings.push(makeWarning(reportIndex * warningsPerReport + warningIndex));
    }
    reports.push({
      reportPath: `.benchCache/replay-${reportIndex}/import_resolution_graph.json`,
      payload: {
        generatedAt: new Date(1700000000000 + reportIndex).toISOString(),
        stats: {
          unresolved: warnings.length,
          unresolvedActionable: warnings.filter((entry) => entry.disposition === 'actionable').length,
          unresolvedByFailureCause: {
            missing_file: warnings.filter((entry) => entry.failureCause === 'missing_file').length,
            missing_dependency: warnings.filter((entry) => entry.failureCause === 'missing_dependency').length,
            parser_artifact: warnings.filter((entry) => entry.failureCause === 'parser_artifact').length,
            resolver_gap: warnings.filter((entry) => entry.failureCause === 'resolver_gap').length
          },
          unresolvedByResolverStage: {
            filesystem_probe: warnings.filter((entry) => entry.resolverStage === 'filesystem_probe').length,
            language_resolver: warnings.filter((entry) => entry.resolverStage === 'language_resolver').length,
            classify: warnings.filter((entry) => entry.resolverStage === 'classify').length
          },
          unresolvedByReasonCode: {
            IMP_U_MISSING_FILE_RELATIVE: warnings.filter((entry) => entry.reasonCode === 'IMP_U_MISSING_FILE_RELATIVE').length,
            IMP_U_MISSING_DEPENDENCY_PACKAGE: warnings.filter((entry) => entry.reasonCode === 'IMP_U_MISSING_DEPENDENCY_PACKAGE').length,
            IMP_U_FIXTURE_REFERENCE: warnings.filter((entry) => entry.reasonCode === 'IMP_U_FIXTURE_REFERENCE').length,
            IMP_U_RESOLVER_GAP: warnings.filter((entry) => entry.reasonCode === 'IMP_U_RESOLVER_GAP').length
          },
          resolverPipelineStages: {
            normalize: {
              attempts: warnings.length,
              hits: warnings.length,
              misses: 0,
              elapsedMs: 10 + (reportIndex % 3),
              budgetExhausted: 0,
              degraded: 0
            },
            language_resolver: {
              attempts: warnings.length,
              hits: Math.floor(warnings.length * 0.6),
              misses: Math.ceil(warnings.length * 0.4),
              elapsedMs: 15 + (reportIndex % 7),
              budgetExhausted: reportIndex % 4 === 0 ? 1 : 0,
              degraded: reportIndex % 5 === 0 ? 2 : 0
            }
          },
          resolverBudgetPolicy: {
            adaptiveEnabled: true,
            adaptiveProfile: reportIndex % 2 === 0 ? 'capacity-headroom' : 'normal'
          }
        },
        warnings
      }
    });
  }
  return reports;
};

const reports = buildSyntheticReports();
const startedA = Date.now();
const aggregatedA = aggregateImportResolutionGraphPayloads(reports);
const elapsedA = Date.now() - startedA;

const startedB = Date.now();
const aggregatedB = aggregateImportResolutionGraphPayloads(reports);
const elapsedB = Date.now() - startedB;

assert.deepEqual(aggregatedB, aggregatedA, 'replay aggregation should be deterministic across repeated runs');
assert.equal(aggregatedA.invalidReports.length, 0, 'expected no invalid synthetic reports');
assert.equal(aggregatedA.totals.reportCount, reports.length, 'expected report count parity');
assert.equal(aggregatedA.totals.unresolved > 0, true, 'expected unresolved totals from replay');
assert.equal(aggregatedA.totals.actionable > 0, true, 'expected actionable totals from replay');
assert.equal(
  Number(aggregatedA?.resolverPipelineStagePercentiles?.language_resolver?.p95) > 0,
  true,
  'expected resolver pipeline stage percentile aggregation'
);

const maxAllowedElapsedMs = 8000;
assert.equal(
  elapsedA <= maxAllowedElapsedMs,
  true,
  `expected replay aggregation to stay within ${maxAllowedElapsedMs}ms budget (first run took ${elapsedA}ms)`
);
assert.equal(
  elapsedB <= maxAllowedElapsedMs,
  true,
  `expected replay aggregation to stay within ${maxAllowedElapsedMs}ms budget (second run took ${elapsedB}ms)`
);

console.log(
  `import-resolution replay perf budget test passed (first=${elapsedA}ms, second=${elapsedB}ms, reports=${reports.length})`
);
