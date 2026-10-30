import assert from 'node:assert/strict';
import { buildCrossFileCoverage, resolveCrossFileFidelity } from '../../src/index/cross-file-fidelity.js';
import { createGraphRelationsShell } from '../../src/shared/artifact-io/graph.js';
import { materializeGraphRelationsPayload } from '../../src/index/build/artifacts/helpers.js';
import { buildArchitectureReport } from '../../src/graph/architecture.js';
import { buildImpactAnalysis } from '../../src/graph/impact.js';
import { buildGraphIndex } from '../../src/graph/store.js';
import { aggregateRiskInputCoverage } from '../../src/index/risk-interprocedural/input-coverage.js';
import { validateArtifact } from '../../src/contracts/artifact-schemas.js';

const zeros = { callSignals: 0, callDetailSignals: 0, chunkUsageSignals: 0, fileUsageSignals: 0 };
const category = { visited: 0, unresolved: 0, unsupported: 0, self: 0, dropped: 0 };
const receipt = buildCrossFileCoverage({ fidelity: resolveCrossFileFidelity('comprehensive'),
  budgetStats: { input: zeros, retained: zeros, dropped: zeros }, propagationStats: { fingerprint: 'source-pinned',
    admission: { calls: category, callDetails: category, usages: category,
      parameterSamplesDropped: 0, parameterTypesDropped: 0, inferenceLiteEnabled: false } } });
const graph = { version: 2, generatedAt: '2026-10-22T00:00:00.000Z', upstreamCoverage: receipt,
  callGraph: { nodes: [{ id: 'owner', file: 'owner.js', out: [], in: [] }], nodeCount: 1, edgeCount: 0 },
  usageGraph: { nodes: [], nodeCount: 0, edgeCount: 0 }, importGraph: { nodes: [], nodeCount: 0, edgeCount: 0 } };
assert.equal(validateArtifact('graph_relations', graph).ok, true);
assert.deepEqual(materializeGraphRelationsPayload(graph).upstreamCoverage, receipt);
assert.deepEqual(createGraphRelationsShell({ generatedAt: graph.generatedAt, extensions: { upstreamCoverage: receipt } }).upstreamCoverage, receipt,
  'sharded loading retains the same upstream receipt as plain graph loading');
const malformed = structuredClone(graph); malformed.upstreamCoverage.policy.mode = 'unlimited';
assert.equal(validateArtifact('graph_relations', malformed).ok, false, 'strict artifact policy identity stays typed');
const rules = [{ id: 'no-call', type: 'forbiddenCall', from: { anyOf: ['**'] }, to: { anyOf: ['**'] } }];
const indexSignature = 'upstream-absence-fixture-v1';
assert.throws(() => buildArchitectureReport({ graphRelations: graph, rules }), /requires indexSignature/);
for (const input of [graph, { ...graph, upstreamCoverage: null }]) {
  const architecture = buildArchitectureReport({ graphRelations: input, rules, indexSignature });
  assert.equal(architecture.violations.length, 0);
  assert.equal(architecture.summary.complete, false, 'zero observed violations cannot establish a clean verdict');
  assert.ok(architecture.warnings.some(warning => warning.code === 'UPSTREAM_RELATION_COVERAGE_INCOMPLETE'));
  const index = buildGraphIndex({ graphRelations: input });
  const impact = buildImpactAnalysis({ seed: { type: 'chunk', chunkUid: 'owner' }, graphIndex: index, indexSignature });
  assert.ok(impact.warnings.some(warning => warning.code === 'UPSTREAM_RELATION_COVERAGE_INCOMPLETE'));
  assert.notEqual(impact.upstreamCoverage.analysis.status, 'complete');
}
const risk = aggregateRiskInputCoverage([{ inputCoverage: { status: 'complete', reasons: [], losses: {} } }], null, receipt);
assert.equal(risk.status, 'partial', 'complete local signal analysis cannot hide unknown relational coverage');
assert.ok(risk.reasons.includes('cross-file-analysis:unknown'));
assert.deepEqual(risk.upstreamCoverage, receipt);
console.log('Graph, architecture, impact and risk preserve unknown upstream coverage rather than inventing clean absence.');
