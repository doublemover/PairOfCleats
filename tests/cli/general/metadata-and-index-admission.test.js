import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
const root = process.cwd();
const target = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-cli-'));
try {
  const config = path.join(target, '.pairofcleats.json');
  const original = '{"quality":"fast"}\n';
  const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(target, 'cache'),
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const run = args => runNode([path.join(root, 'bin/pairofcleats.js'), ...args], 'CLI metadata admission', root, env,
    { stdio: 'pipe', allowFailure: true });
  for (const present of [false, true]) {
    if (present) await fs.writeFile(config, original); else await fs.rm(config, { force: true });
    for (const flag of ['-v', '--version']) {
      const result = run(['config', 'reset', '--force', '--repo', target, flag]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout + result.stderr, /\d+\.\d+\.\d+/);
      assert.equal(await fs.readFile(config, 'utf8').catch(() => null), present ? original : null);
      assert.deepEqual((await fs.readdir(target)).sort(), present ? ['.pairofcleats.json'] : []);
    }
  }
  for (const args of [['index', '--help'], ['index', '-h'], ['index', 'help'], ['help', 'index'], ['index', 'build', '--help'], ['index', 'watch', '--help']]) {
    const result = run([...args, '--repo', target]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /usage|index|build/i);
  }
  for (const args of [['index', 'status'], ['index', 'bulid'], ['index', 'build', '--stage', 'stage5']]) {
    const result = run([...args, '--repo', target]);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Unknown index command|stage must/);
  }
  assert.deepEqual((await fs.readdir(target)).sort(), ['.pairofcleats.json']);
} finally { await fs.rm(target, { recursive: true, force: true }); }
console.log('Metadata and invalid index requests leave target configuration and jobs untouched.');
