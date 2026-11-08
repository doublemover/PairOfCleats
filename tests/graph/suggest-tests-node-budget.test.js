import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';
import { validateSuggestTests } from '../../src/contracts/validators/analysis.js';
import { graphRelationsFromEdges } from './helpers/graph-fixtures.js';
import { createBaseIndex } from '../indexing/validate/helpers.js';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';

const graphRelations = graphRelationsFromEdges({ importEdges: [['unrelated.test.js', ['app.js']]] });
const base = { graphRelations, changed: ['app.js'], tests: ['unrelated.test.js'], indexCompatKey: 'node-budget' };
const violations = [];
const check = (label, report, { maxNodes, omitted, visited, suggestions }) => {
  assert.equal(validateSuggestTests(report).ok, true, label);
  if (report.fidelity.graph.visitedNodes !== visited || report.fidelity.graph.visitedNodes > maxNodes) violations.push(`${label}: visited ${report.fidelity.graph.visitedNodes}`);
  const capped = (report.truncation || []).some(row => row.cap === 'maxNodes');
  if (capped !== omitted) violations.push(`${label}: omission ${capped}`);
  if (report.suggestions.length !== suggestions) violations.push(`${label}: suggestions ${report.suggestions.length}`);
  if (omitted && !report.fidelity.reasonCodes.includes('traversal_capped')) violations.push(`${label}: missing partial reason`);
  if (!omitted && report.fidelity.reasonCodes.includes('traversal_capped')) violations.push(`${label}: false partial reason`);
  for (const suggestion of report.suggestions) {
    if (suggestion.fidelity.source === 'graph') assert.equal(suggestion.fidelity.state, omitted ? 'partial' : 'complete', label);
  }
};
for (const maxNodes of [0, 1, 2]) {
  check(`neighbor cap ${maxNodes}`, buildSuggestTestsReport({ ...base, caps: { maxNodes } }),
    { maxNodes, omitted: maxNodes < 2, visited: maxNodes, suggestions: maxNodes === 2 ? 1 : 0 });
}
const seeds = ['a.test.js', 'b.test.js', 'c.test.js'];
for (const maxNodes of [0, 1, 3]) {
  const report = buildSuggestTestsReport({ ...base, changed: seeds, tests: seeds, caps: { maxNodes } });
  check(`seed cap ${maxNodes}`, report, { maxNodes, omitted: maxNodes < 3, visited: maxNodes, suggestions: maxNodes });
  if (!report.suggestions.every(row => seeds.slice(0, maxNodes).includes(row.testPath))) violations.push(`seed cap ${maxNodes}: omitted seeds contribute`);
}
const maxSeeds = buildSuggestTestsReport({ ...base, changed: seeds, tests: seeds, caps: { maxNodes: 3, maxSeeds: 1 } });
assert.equal(maxSeeds.fidelity.graph.visitedNodes, 1);
assert.ok(maxSeeds.truncation.some(row => row.cap === 'maxSeeds'));
assert.ok(!maxSeeds.truncation.some(row => row.cap === 'maxNodes'), 'independent seed cap does not imply a node omission');
const fallback = buildSuggestTestsReport({ ...base, tests: ['app.test.js'], caps: { maxNodes: 1 } });
assert.equal(fallback.fidelity.source, 'heuristic');
assert.equal(fallback.fidelity.state, 'fallback');
assert.ok(fallback.fidelity.reasonCodes.includes('traversal_capped'));
assert.equal(fallback.suggestions[0].fidelity.source, 'heuristic', 'a path fallback must not claim an unvisited graph witness');
console.log(JSON.stringify({ nodeBudgetViolations: violations }));
assert.deepEqual(violations, []);

const root = await fs.realpath(await makeTempDir('poc-suggest-tests-node-budget-'));
const env = applyTestEnv({ syncProcess: true, cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
try {
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  await fs.writeFile(path.join(repo, 'app.js'), 'export const app = true;');
  await fs.writeFile(path.join(repo, 'unrelated.test.js'), 'import { app } from "./app.js";');
  const cache = getRepoCacheRoot(repo, {}), buildId = 'node-budget', buildRoot = path.join(cache, 'builds', buildId);
  const fixture = await createBaseIndex({ rootDir: buildRoot, semantic: true,
    manifestOverrides: { compatibilityKey: 'node-budget-v1' },
    chunkMeta: [{ id: 0, file: 'app.js', start: 0, end: 1 }],
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId, mode: 'code', compatibilityKey: 'node-budget-v1' } });
  await fs.writeFile(path.join(fixture.indexDir, 'graph_relations.json'), JSON.stringify(graphRelations));
  fixture.manifest.pieces.push({ name: 'graph_relations', path: 'graph_relations.json', format: 'json' });
  await fs.writeFile(path.join(fixture.indexDir, 'pieces/manifest.json'), JSON.stringify(fixture.manifest));
  await fs.rename(fixture.indexDir, path.join(buildRoot, 'index-code'));
  await fs.writeFile(path.join(cache, 'builds/current.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    buildId, buildRoot: `builds/${buildId}`, buildRoots: { code: `builds/${buildId}` } }));
  for (const maxNodes of [0, 1, 2]) {
    const result = await spawnSubprocess(process.execPath, [path.resolve('bin/pairofcleats.js'), 'suggest-tests',
      '--repo', repo, '--changed', 'app.js', '--max', '5', '--maxNodes', String(maxNodes), '--json'],
    { env, cwd: root, timeoutMs: 7000, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(result.exitCode, 0, result.stderr);
    check(`CLI cap ${maxNodes}`, JSON.parse(result.stdout),
      { maxNodes, omitted: maxNodes < 2, visited: maxNodes, suggestions: maxNodes === 2 ? 1 : 0 });
  }
  assert.deepEqual(violations, []);
} finally { await rmDirRecursive(root); }
console.log('Suggest-tests bounds seeds and neighbors before admission, including actual CLI zero/one/exact caps.');
