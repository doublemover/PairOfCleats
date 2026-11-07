import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';
import { initGitRepo } from '../../helpers/git-fixture.js';

const { dir } = await prepareIsolatedTestCacheDir('workspace-canonical-startup-isolation');
const checkout = process.cwd(), unrelated = path.join(dir, 'unrelated'); await fs.mkdir(unrelated);
await fs.writeFile(path.join(unrelated, '.pairofcleats.json'), '{ invalid unrelated runtime config');
const preload = '--import=' + pathToFileURL(path.join(checkout, 'tests/fixtures/workspace/startup-observation-preload.js')).href;
const repos = ['first project', 'second project', 'default project'].map(name => toRealPathSync(path.join(dir, name)));
for (const [index, repo] of repos.entries()) {
  await fs.mkdir(repo);
  initGitRepo(repo);
  await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ runtime: { nodeOptions: preload,
    ...(index < 2 ? { maxOldSpaceMb: index ? 768 : 512, uvThreadpoolSize: index ? 8 : 2 } : {}) } }));
}
const workspace = path.join(dir, 'workspace.jsonc');
await fs.writeFile(workspace, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: repos.map(root => ({ root })) }));
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify(repos), NODE_OPTIONS: null,
  UV_THREADPOOL_SIZE: null, PAIROFCLEATS_NODE_OPTIONS: null, PAIROFCLEATS_MAX_OLD_SPACE_MB: null, PAIROFCLEATS_UV_THREADPOOL_SIZE: null } });
for (const [route, explicit] of [[['workspace', 'build'], false], [['index', 'build'], false], [['workspace', 'build'], true]]) {
  const childEnv = explicit ? { ...env, NODE_OPTIONS: preload + ' --max-old-space-size=384 --trace-warnings', UV_THREADPOOL_SIZE: '3' } : env;
  const result = runNode([path.join(checkout, 'bin/pairofcleats.js'), ...route, '--workspace', workspace,
    '--concurrency', '2', '--mode', 'code', '--json'], 'canonical workspace target startup', unrelated, childEnv,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  await fs.writeFile(path.join(dir, route[0] + (explicit ? '-explicit' : '-config') + '-command.json'), JSON.stringify(result, null, 2));
  assert.equal(result.status, 0, result.stderr + result.stdout); JSON.parse(result.stdout);
  for (const [index, repo] of repos.entries()) {
    const observed = JSON.parse(await fs.readFile(path.join(repo, 'child-startup.json'), 'utf8'));
    assert.equal(observed.repo, repo); assert.equal(observed.cwd, repo); assert.deepEqual(observed.execArgv, []);
    if (index < 2 || explicit) {
      assert.equal(observed.uv, explicit ? '3' : index ? '8' : '2');
      assert.ok(Math.abs(observed.heap / 1024 / 1024 - (explicit ? 384 : index ? 768 : 512)) < 100);
    }
    assert.ok(observed.nodeOptions.includes(preload));
    assert.ok(!observed.nodeOptions.includes(index === 0 ? '768' : '512'), 'derived settings never leak between targets');
  }
}
assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.UV_THREADPOOL_SIZE, undefined);
console.log('Canonical workspace and index alias launch real isolated target startup from an invalid unrelated cwd.');
