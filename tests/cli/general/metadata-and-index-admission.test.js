import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
const cases = ['version-absent', 'version-present', 'help-group', 'help-actions', 'help-json', 'invalid'];
assert.deepEqual(JSON.parse(await fs.readFile(new URL('./metadata-and-index-admission.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('cli/general/metadata-and-index-admission/')[1];
assert.ok(cases.includes(selected), 'run an independently bounded metadata/admission case');
const root = process.cwd();
const target = await fs.mkdtemp(path.join(os.tmpdir(), 'metadata-cli-'));
try {
  const config = path.join(target, '.pairofcleats.json');
  const original = '{"quality":"fast"}\n';
  const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(target, 'cache'),
    extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const run = args => runNode([path.join(root, 'bin/pairofcleats.js'), ...args], 'CLI metadata admission', root, env,
    { stdio: 'pipe', allowFailure: true });
  const present = selected !== 'version-absent';
  if (present) await fs.writeFile(config, original);
  if (selected.startsWith('version-')) {
    if (present) await fs.writeFile(config, original); else await fs.rm(config, { force: true });
    for (const flag of ['-v', '--version']) {
      const result = run(['config', 'reset', '--force', '--repo', target, flag]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout + result.stderr, /\d+\.\d+\.\d+/);
      assert.equal(await fs.readFile(config, 'utf8').catch(() => null), present ? original : null);
      assert.deepEqual((await fs.readdir(target)).sort(), present ? ['.pairofcleats.json'] : []);
    }
  }
  const helpCases = { 'help-group': [['index', '--help'], ['index', '-h'], ['index', 'help'], ['help', 'index']],
    'help-actions': [['index', 'build', '--help'], ['index', 'watch', '--help']] };
  for (const args of helpCases[selected] || []) {
    const result = run([...args, '--repo', target]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /usage|index|build/i);
  }
  if (selected === 'help-json') {
    const helpJson = run(['help', 'index', '--repo=' + target, '--json']);
    assert.equal(helpJson.status, 0, helpJson.stderr);
    const helpPayload = JSON.parse(helpJson.stdout);
    assert.equal(helpPayload.topic, 'index');
    assert.ok(helpPayload.commands.length > 0);
    const invalidHelp = run(['help', 'index', '--poc-unknown-option']);
    assert.equal(invalidHelp.status, 1);
    assert.match(invalidHelp.stderr, /Unknown flag: --poc-unknown-option/);
  }
  if (selected === 'invalid') {
    for (const args of [['index', 'status'], ['index', 'bulid'], ['index', 'build', '--stage', 'stage5']]) {
      const result = run([...args, '--repo', target]);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, /Unknown index command|stage must/);
    }
  }
  assert.deepEqual((await fs.readdir(target)).sort(), present ? ['.pairofcleats.json'] : []);
  if (present) assert.equal(await fs.readFile(config, 'utf8'), original);
} finally {
  const owned = path.resolve(target);
  assert.equal(path.relative(path.resolve(os.tmpdir()), path.dirname(owned)), '');
  assert.ok(path.basename(owned).startsWith('metadata-cli-'));
  await fs.rm(owned, { recursive: true, force: true });
}
console.log('Metadata and invalid index requests leave target configuration and jobs untouched.');
