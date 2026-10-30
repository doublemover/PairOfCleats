import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { runNode } from '../../helpers/run-node.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

const cases = ['stage1-code', 'stage2-prose', 'stage3-disabled', 'stage4-sqlite'];
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./build-cli-selected-outcome.test.js.cases.json', import.meta.url))), { schemaVersion: 1, cases });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/runtime/build-cli-selected-outcome/')[1];
assert.ok(cases.includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`build-cli-outcome-${selected}`);
const repo = path.join(dir, 'repo'); await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'one.js'), 'export const value = 1;\n');
await fs.writeFile(path.join(repo, 'README.md'), '# Selected source\nOne paragraph.\n');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'off',
  testConfig: createFastIndexingTestConfig({ threads: 1, indexing: { workerPool: { enabled: false }, embeddings: { enabled: false } },
    sqlite: { use: false } }), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const stats = path.join(getRepoCacheRoot(repo, loadUserConfig(repo)), 'preprocess.json'); await fs.mkdir(path.dirname(stats), { recursive: true });
const stale = JSON.stringify({ repo: 'another-repository', runtimeAttemptId: 'another-attempt', counts: { code: 987654321, prose: 987654321 } });
await fs.writeFile(stats, stale);
const preload = pathToFileURL(path.resolve('tests/fixtures/workspace/preprocess-statistics-write-failure.js')).href;
const run = (stage, sqlite = false) => runNode(['--import', preload, path.resolve('build_index.js'), '--repo', repo,
  '--mode', selected.endsWith('code') ? 'code' : 'prose', '--stage', stage, '--threads', '1', '--progress', 'off', '--json',
  sqlite ? '--sqlite' : '--no-sqlite'], 'actual selected build outcome', process.cwd(), env,
{ stdio: 'pipe', allowFailure: true, timeoutMs: 15000 });
if (selected === 'stage4-sqlite') { const seed = run('1'); assert.equal(seed.status, 0, seed.stderr); }
const stage = selected.slice(5, 6), child = run(stage, selected === 'stage4-sqlite');
await fs.writeFile(path.join(dir, 'cli-result.json'), JSON.stringify(child, null, 2));
assert.equal(child.status, 0, child.stderr);
const outcome = JSON.parse(child.stdout);
assert.equal(outcome.repo, toRealPathSync(repo)); assert.equal(outcome.counts, null);
assert.deepEqual(outcome.requestedStages, ['stage' + stage]);
assert.doesNotMatch(child.stdout + child.stderr, /987654321|Index built/);
assert.equal(await fs.readFile(stats, 'utf8'), stale, 'a real best-effort statistics write failure cannot lend stale counts');
if (stage === '3') assert.equal(outcome.status, 'skipped');
else {
  assert.ok(outcome.generations.length > 0);
  assert.ok(outcome.generations.every(generation => generation.buildId && generation.buildRoot));
  assert.ok(outcome.stages.every(row => ['passed', 'unknown'].includes(row.validation.status)));
}
console.log(JSON.stringify({ selected, dir, status: outcome.status, generations: outcome.generations }));
