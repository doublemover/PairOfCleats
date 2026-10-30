import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveTrustedTuiCommand } from '../../tools/tui/operator/command.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { grantFixtureRepositoryExecution } from '../helpers/execution-authority.js';
import { applyTestEnv } from '../helpers/test-env.js';

// UNVALIDATED: actual operator selection/authority only; no launcher dispatch.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['relative-path', 'relative-command', 'authority', 'name-order', 'missing'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`operator-command-cwd-${selected}`);
const bin = path.join(dir, 'bin'); await fs.mkdir(bin);
const suffix = process.platform === 'win32' ? '.cmd' : '';
const command = path.join(bin, 'fixture-operator' + suffix), alternative = path.join(bin, 'fixture-alternative' + suffix);
for (const filename of [command, alternative]) {
  await fs.writeFile(filename, 'inert selection fixture, never launched');
  if (process.platform !== 'win32') await fs.chmod(filename, 0o755);
}
const restore = grantFixtureRepositoryExecution(dir);
try {
  const env = { ...process.env, PATH: 'bin' };
  const input = { names: ['fixture-operator'], repoRoot: dir, toolRoot: process.cwd(), env, prefix: 'FIXTURE_COMMAND' };
  if (selected === 'relative-command') input.names = ['./bin/' + path.basename(command)];
  if (selected === 'authority') env.PAIROFCLEATS_TRUSTED_REPOS = '[]';
  if (selected === 'name-order') input.names = ['fixture-alternative', 'fixture-operator'];
  if (selected === 'missing') input.names = ['absent-owned-fixture'];
  if (selected === 'authority' || selected === 'missing') {
    await assert.rejects(resolveTrustedTuiCommand(input), { code: selected === 'authority' ? 'FIXTURE_COMMAND_UNTRUSTED' : 'FIXTURE_COMMAND_MISSING' });
  } else {
    const result = await resolveTrustedTuiCommand(input);
    assert.equal(result.path, selected === 'name-order' ? alternative : command);
    assert.equal(result.name, input.names[0]); assert.equal(path.isAbsolute(result.path), true);
    assert.notEqual(path.resolve('bin', path.basename(result.path)), result.path, 'fixture must distinguish process cwd from selected repository cwd');
  }
} finally {
  restore(); assert.ok(path.resolve(dir).startsWith(path.resolve(path.dirname(dir)) + path.sep));
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Operator command working directory: ${selected}`);
