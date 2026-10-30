import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { resolveToolingCommandSelection, resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: same actual discovery/policy owner as production preflight.
// Every subprocess entry throws if called; no inert executable is launched.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['explicit', 'arguments', 'missing', 'directory', 'untrusted', 'cancelled', 'path', 'fresh'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`command-selection-${selected}`);
const command = path.join(dir, process.platform === 'win32' ? 'inert-selection.exe' : 'inert-selection');
await fs.writeFile(command, 'inert fixture bytes; never executable machine code');
if (process.platform !== 'win32') await fs.chmod(command, 0o755);
const restoreAuthority = grantFixtureRepositoryExecution(dir);
const beforePath = process.env.PATH, beforeTrust = process.env.PAIROFCLEATS_TRUSTED_REPOS;
const original = new Map(['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'].map(name => [name, childProcess[name]]));
let launches = 0;
for (const name of original.keys()) childProcess[name] = () => { launches++; throw new Error('Read-only selection attempted a child.'); };
syncBuiltinESMExports();
try {
  const input = { providerId: 'inert-selection', cmd: command, args: ['--stdio'], repoRoot: dir, toolingConfig: {} };
  if (selected === 'missing') input.cmd = path.join(dir, 'absent.exe');
  if (selected === 'directory') { input.cmd = path.join(dir, 'directory.exe'); await fs.mkdir(input.cmd); }
  if (selected === 'untrusted') process.env.PAIROFCLEATS_TRUSTED_REPOS = '[]';
  if (selected === 'cancelled') { const abort = new AbortController(); abort.abort(); input.signal = abort.signal; }
  if (selected === 'path') { process.env.PATH = dir; input.cmd = path.basename(command); }
  if (selected === 'cancelled') assert.throws(() => resolveToolingCommandSelection(input), { name: 'AbortError' });
  else {
    const receipt = resolveToolingCommandSelection(input);
    assert.ok(Object.isFrozen(receipt)); assert.ok(Object.isFrozen(receipt.resolved));
    assert.ok(Object.isFrozen(receipt.resolved.args));
    if (['missing', 'directory', 'untrusted'].includes(selected)) {
      assert.equal(receipt.resolved.mode, 'blocked'); assert.equal(receipt.probe.ok, false);
      assert.deepEqual(resolveToolingCommandProfile(input), receipt, 'blocked live preflight uses identical selection/policy evidence');
      if (selected === 'untrusted') assert.equal(receipt.resolved.reason, 'untrusted-repository-command');
    } else {
      assert.equal(receipt.resolved.cmd, command); assert.equal(receipt.probe.ok, null, 'selection eligibility cannot become runtime qualification');
      assert.deepEqual(receipt.probe.attempted, []); assert.equal(receipt.probe.discovery.selected.eligible, true);
      if (selected === 'arguments') {
        input.args.push('--late'); assert.deepEqual(receipt.resolved.args, ['--stdio']);
        assert.throws(() => receipt.resolved.args.push('--replacement'), TypeError);
      }
      if (selected === 'fresh') {
        const identity = receipt.probe.discovery.selected.identity;
        await fs.writeFile(command, 'replacement inert fixture bytes with a different extent');
        assert.notEqual(resolveToolingCommandSelection(input).probe.discovery.selected.identity.size, identity.size);
      }
    }
  }
  assert.equal(launches, 0);
} finally {
  for (const [name, value] of original) childProcess[name] = value;
  syncBuiltinESMExports();
  if (beforePath === undefined) delete process.env.PATH; else process.env.PATH = beforePath;
  if (beforeTrust === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS; else process.env.PAIROFCLEATS_TRUSTED_REPOS = beforeTrust;
  restoreAuthority();
  assert.ok(path.resolve(dir).startsWith(path.resolve(path.dirname(dir)) + path.sep));
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Read-only command selection: ${selected}`);
