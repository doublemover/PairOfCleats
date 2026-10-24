import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getToolingRegistry } from '../../../tools/tooling/utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';

const { dir } = await prepareIsolatedTestCacheDir('phpactor-platform-contract');
const tool = getToolingRegistry(path.join(dir, 'tooling'), dir).find(entry => entry.id === 'phpactor');
assert.deepEqual(tool.install.platforms, ['linux', 'darwin'], 'the publisher requires ext-posix and documents native Windows as unsupported');
if (process.platform === 'win32') {
  const repo = path.join(dir, 'repo'), bin = path.join(dir, 'bin');
  await fs.mkdir(repo); await fs.mkdir(bin);
  const marker = path.join(dir, 'php-invoked');
  await fs.writeFile(path.join(bin, 'php.cmd'), `@echo off\r\necho invoked>>"${marker}"\r\nexit /b 1\r\n`);
  const env = applyTestEnv({ syncProcess: false, extraEnv: { PATH: bin, Path: bin,
    PAIROFCLEATS_HOME: path.join(dir, 'resources'), PAIROFCLEATS_TOOLING_DIR: path.join(dir, 'tooling'),
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]) } });
  for (const dryRun of [false, true]) {
    const result = runNode(['tools/tooling/install.js', '--root', repo, '--tools', 'phpactor', '--no-fallback',
      '--json', ...(dryRun ? ['--dry-run'] : [])], 'native Windows PHPactor platform declaration', process.cwd(), env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
    assert.equal(result.status, 1, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.actions, [], 'an unsupported stock install cannot run or download');
    if (dryRun) {
      assert.equal(payload.preview.execution, 'none');
      assert.equal(payload.preview.entries[0].blockers.some(blocker => blocker.reason === 'unsupported_platform'), true);
    } else {
      assert.equal(payload.results[0].reason, 'unsupported_platform');
      assert.equal(payload.results[0].status, 'missing-requirement');
      assert.match(payload.results[0].error, /POSIX.*Linux.*macOS.*WSL/);
    }
    assert.equal(payload.readiness.ready, false);
    assert.equal(payload.readiness.state, dryRun ? 'planned' : 'blocked');
  }
  await assert.rejects(fs.access(marker), { code: 'ENOENT' }, 'a missing POSIX platform is decided before invoking any PHP command');
}
console.log('Stock PHPactor installation declares its actual POSIX platform requirement; portable download and custom commands retain separate owners.');
