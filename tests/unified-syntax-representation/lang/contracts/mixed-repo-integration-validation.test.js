#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const fixtureGovernancePath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-fixture-governance.json');
const benchmarkPolicyPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-benchmark-policy.json');

const fixtureGovernance = JSON.parse(fs.readFileSync(fixtureGovernancePath, 'utf8'));
const benchmarkPolicy = JSON.parse(fs.readFileSync(benchmarkPolicyPath, 'utf8'));

const fixtureRows = Array.isArray(fixtureGovernance.rows) ? fixtureGovernance.rows : [];
const benchmarkRows = Array.isArray(benchmarkPolicy.rows) ? benchmarkPolicy.rows : [];

const integrationRows = fixtureRows.filter((row) => String(row.fixtureId || '').startsWith('usr::integration::'));
assert.equal(integrationRows.length >= 2, true, 'fixture-governance must define at least two blocking usr::integration fixtures for mixed-repo coverage');

const crossLanguageFramework = integrationRows.find((row) => row.fixtureId === 'usr::integration::cross-language-framework-001');
assert.equal(Boolean(crossLanguageFramework), true, 'fixture-governance must define usr::integration::cross-language-framework-001');
for (const family of ['integration', 'semantic-flow', 'framework-overlay', 'route-semantics', 'template-binding', 'style-scope']) {
  assert.equal((crossLanguageFramework.families || []).includes(family), true, `cross-language/framework fixture must include family: ${family}`);
}

const routeTemplateApiData = integrationRows.find((row) => row.fixtureId === 'usr::integration::route-template-api-data-001');
assert.equal(Boolean(routeTemplateApiData), true, 'fixture-governance must define usr::integration::route-template-api-data-001');
for (const family of ['integration', 'semantic-flow', 'route-semantics', 'template-binding', 'api-boundary', 'data-boundary']) {
  assert.equal((routeTemplateApiData.families || []).includes(family), true, `route/template/api/data fixture must include family: ${family}`);
}

for (const row of integrationRows) {
  assert.equal(row.profileType, 'cross-cutting', `integration fixture profileType must be cross-cutting: ${row.fixtureId}`);
  assert.equal(row.profileId, 'usr', `integration fixture profileId must be usr: ${row.fixtureId}`);
  assert.equal(row.blocking, true, `integration fixture must be blocking: ${row.fixtureId}`);
  assert.equal(row.goldenRequired, true, `integration fixture must require golden outputs: ${row.fixtureId}`);
  assert.equal(Array.isArray(row.roadmapTags) && row.roadmapTags.includes('phase-14'), true, `integration fixture must include phase-14 roadmap tag: ${row.fixtureId}`);
}

const mixedRepoBenchmark = benchmarkRows.find((row) => row.datasetClass === 'mixed-repo');
assert.equal(Boolean(mixedRepoBenchmark), true, 'benchmark-policy must include mixed-repo dataset class row');
assert.equal(mixedRepoBenchmark.laneId, 'ci-long', 'mixed-repo benchmark must run on ci-long lane');
assert.equal(mixedRepoBenchmark.measureRuns >= 7, true, 'mixed-repo benchmark must measure at least 7 runs');
assert.equal(mixedRepoBenchmark.warmupRuns >= 1, true, 'mixed-repo benchmark must include warmup runs');
assert.equal(mixedRepoBenchmark.percentileTargets.p50DurationMs < mixedRepoBenchmark.percentileTargets.p95DurationMs, true, 'mixed-repo benchmark percentile targets must be monotonic (p50 < p95)');
assert.equal(mixedRepoBenchmark.percentileTargets.p95DurationMs < mixedRepoBenchmark.percentileTargets.p99DurationMs, true, 'mixed-repo benchmark percentile targets must be monotonic (p95 < p99)');

console.log('usr mixed-repo integration validation checks passed');
