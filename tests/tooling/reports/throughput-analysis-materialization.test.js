import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  materializeBenchAnalysis, resolveBenchAnalysis
} from '../../../tools/reports/show-throughput/analysis.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: real build-state reconstruction and actual materializer CLI.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['same-analysis', 'key-order', 'changed-source', 'missing-source', 'malformed-source', 'read-provenance',
  'native-provenance', 'cli-idempotence', 'cli-refresh-failure'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'throughput-analysis-'));
const buildRoot = path.join(root, 'build'); await fs.mkdir(buildRoot);
const statePath = path.join(buildRoot, 'build_state.json');
const writeState = async symbols => fs.writeFile(statePath, JSON.stringify({
  counts: { code: { files: 3, chunks: 7 } },
  orderingLedger: { stages: { 'stage2:code': { artifacts: {
    repo_map: { count: symbols }, file_relations: { count: 2 }, graph_relations: { count: 1 }
  } } } }
}));
const payload = { generatedAt: '2026-03-21T00:00:00.000Z', repo: { root: path.join(root, 'repo') },
  summary: { buildMs: { index: 1000 }, queryWallMsPerQuery: 1 },
  artifacts: { repo: { buildRoot }, throughput: { code: { files: 3, chunks: 7, tokens: 11, bytes: 20, totalMs: 1000 } } } };
const sentinel = '2001-01-01T00:00:00.000Z';
const cliPath = path.resolve('tools/reports/materialize-throughput.js');
try {
  await writeState(5);
  const first = materializeBenchAnalysis({ payload });
  assert.equal(first.changed, true);
  assert.equal(first.analysis.totals.symbols, 5);
  assert.equal(first.provenance.category, 'fallback');
  payload.artifacts.analysis.generatedAt = sentinel;
  if (selected === 'key-order') payload.artifacts.analysis = Object.fromEntries(Object.entries(payload.artifacts.analysis).reverse());
  const before = JSON.stringify(payload);
  if (selected === 'same-analysis' || selected === 'key-order') {
    const result = materializeBenchAnalysis({ payload });
    assert.equal(result.changed, false, 'invocation time is not a content refresh');
    assert.equal(result.analysis.generatedAt, sentinel);
    assert.equal(JSON.stringify(payload), before);
  } else if (selected === 'changed-source') {
    await writeState(9);
    const result = materializeBenchAnalysis({ payload });
    assert.equal(result.changed, true);
    assert.equal(result.analysis.totals.symbols, 9, 'explicit refresh actually reconstructs changed inputs');
    assert.notEqual(result.analysis.generatedAt, sentinel);
    assert.equal(result.provenance.source, 'fallback-build-state');
  } else if (selected === 'missing-source' || selected === 'malformed-source') {
    if (selected === 'missing-source') await fs.unlink(statePath);
    else await fs.writeFile(statePath, '{broken');
    const result = materializeBenchAnalysis({ payload });
    assert.equal(result.changed, false);
    assert.equal(result.refresh.state, 'source-unavailable');
    assert.equal(result.provenance.category, 'fallback');
    assert.equal(result.provenance.source, 'fallback-build-state');
    assert.equal(JSON.stringify(payload), before, 'unavailable refresh preserves prior evidence');
  } else if (selected === 'read-provenance' || selected === 'native-provenance') {
    if (selected === 'native-provenance') delete payload.artifacts.materialization;
    const stored = JSON.stringify(payload);
    await writeState(99);
    const read = resolveBenchAnalysis({ payload });
    assert.equal(read.provenance.category, selected === 'native-provenance' ? 'native' : 'fallback');
    assert.equal(read.provenance.source, selected === 'native-provenance' ? 'native-analysis' : 'fallback-build-state');
    assert.equal(read.analysis.totals.symbols, 5, 'default read retains stored evidence');
    assert.equal(read.analysis.generatedAt, sentinel);
    assert.equal(JSON.stringify(payload), stored);
  } else {
    const results = path.join(root, 'results');
    const folder = path.join(results, 'javascript'); await fs.mkdir(folder, { recursive: true });
    const reportPath = path.join(folder, 'fixture.json');
    await fs.writeFile(reportPath, JSON.stringify(payload));
    if (selected === 'cli-refresh-failure') await fs.unlink(statePath);
    const runCli = () => spawnSync(process.execPath, [cliPath, '--root', results], {
      cwd: root, env: process.env, windowsHide: true, encoding: 'utf8', timeout: 10000
    });
    const firstRun = runCli();
    assert.equal(firstRun.error, undefined);
    if (selected === 'cli-refresh-failure') {
      assert.equal(firstRun.status, 1);
      assert.match(firstRun.stderr, /Refresh failures: 1/);
      assert.match(firstRun.stderr, /analysis-reconstruction-unavailable/);
      const retained = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      assert.deepEqual(retained.artifacts.analysis, payload.artifacts.analysis);
      assert.equal(retained.artifacts.materialization.sections.analysis.category, 'fallback');
    } else {
      assert.equal(firstRun.status, 0, firstRun.stderr);
      const previousBytes = await fs.readFile(reportPath);
      const previousStat = await fs.stat(reportPath, { bigint: true });
      const secondRun = runCli();
      assert.equal(secondRun.error, undefined);
      assert.equal(secondRun.status, 0, secondRun.stderr);
      assert.match(secondRun.stderr, /files written: 0/);
      assert.deepEqual(await fs.readFile(reportPath), previousBytes);
      const afterStat = await fs.stat(reportPath, { bigint: true });
      assert.equal(afterStat.mtimeNs, previousStat.mtimeNs);
      assert.equal(afterStat.ino, previousStat.ino);
    }
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`throughput analysis materialization ${selected} passed`);
