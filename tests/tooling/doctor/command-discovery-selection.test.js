import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { candidateNames } from '../../../src/index/tooling/binary-utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const root = await makeTempDir('command-discovery-selection-'), bad = path.join(root, 'bad'), good = path.join(root, 'good');
await fs.mkdir(bad); await fs.mkdir(good); await fs.writeFile(path.join(root, 'package.json'), '{"name":"inert-discovery-fixture"}');
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const name = 'poc-authored-discovery-fixture', filename = candidateNames(name)[0], rejected = path.join(bad, filename), selected = path.join(good, filename);
await fs.mkdir(rejected); await fs.writeFile(selected, 'inert fixture; launch is intercepted');
if (process.platform !== 'win32') await fs.chmod(selected, 0o755);
const restoreTrust = grantFixtureRepositoryExecution(root), launches = [], handshakes = [];
let kills = 0, releases = 0;
globalThis.__binaryDiscoverySpawn = (command, args) => {
  launches.push({ command, args }); return { exitCode: 0, stdout: 'fixture-tool 1.0\n', stderr: '' };
};
globalThis.__binaryDiscoveryClient = async options => {
  handshakes.push(options.cmd); let settled = false;
  return { initialize: async () => ({ capabilities: { documentSymbolProvider: true } }), shutdownAndExit: async () => {},
    kill: async () => { kills++; settled = true; return { exitObserved: true }; },
    waitForResourceSettlement: async () => ({ settled }), getTerminationEvidence: () => ({ settled }),
    releaseManagedInstallation: async () => { releases++; return true; }, getMetrics: () => ({ requests: 1 }) };
};
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/shared/subprocess/command-invocation.js')) return { format: 'module', shortCircuit: true,
    source: `export * from ${JSON.stringify(url + '?original-discovery-fixture')};
      export const spawnResolvedSubprocessSync = (...args) => globalThis.__binaryDiscoverySpawn(...args);` };
  if (url.endsWith('/integrations/tooling/lsp/managed-client.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createRetainedLspClient = options => globalThis.__binaryDiscoveryClient(options);' };
  return next(url, context);
} });
try {
  const { resolveToolingCommandProfile, probeLspInitializeHandshake, __resetToolingCommandProbeCacheForTests } =
    await import('../../../src/index/tooling/command-resolver.js');
  const envPath = [bad, good].join(path.delimiter);
  await withTemporaryEnv({ PATH: envPath, Path: envPath }, async () => {
    __resetToolingCommandProbeCacheForTests();
    const input = { providerId: 'authored-discovery', cmd: name, args: ['--version'], repoRoot: root,
      toolingConfig: { dir: path.join(root, 'tooling') } };
    const profile = resolveToolingCommandProfile(input);
    assert.equal(profile.resolved.cmd, selected); assert.equal(profile.probe.ok, true);
    assert.deepEqual(launches.map(value => value.command), [selected]);
    assert.ok(profile.probe.discovery.observations.some(value => value.path === rejected && value.reason === 'not-file'));
    const explicit = resolveToolingCommandProfile({ ...input, cmd: rejected });
    assert.equal(explicit.resolved.cmd, rejected); assert.equal(explicit.probe.ok, false);
    assert.equal(explicit.probe.validationFailure.reasonCode, 'command-discovery-ineligible');
    assert.equal(launches.length, 1, 'an explicit unusable path cannot be replaced by the valid PATH installation');
    const handshake = await probeLspInitializeHandshake({ cmd: name, cwd: root, providerId: 'authored-discovery', toolingConfig: input.toolingConfig });
    assert.equal(handshake.ok, true); assert.deepEqual(handshakes, [selected]); assert.equal(kills, 1); assert.equal(releases, 1);
    const invalidHandshake = await probeLspInitializeHandshake({ cmd: rejected, cwd: root, providerId: 'authored-discovery', toolingConfig: input.toolingConfig });
    assert.equal(invalidHandshake.ok, false); assert.equal(invalidHandshake.errorCode, 'COMMAND_DISCOVERY_INELIGIBLE');
    assert.equal(handshakes.length, 1);
    await fs.rmdir(rejected); await fs.writeFile(rejected, 'new eligible candidate');
    if (process.platform !== 'win32') await fs.chmod(rejected, 0o755);
    const replacement = resolveToolingCommandProfile(input);
    assert.equal(replacement.resolved.cmd, rejected); assert.equal(replacement.probe.ok, true);
    assert.equal(launches.at(-1).command, rejected, 'a fresh profile cannot reuse stale rejected-candidate eligibility');
  });
} finally {
  hook.deregister(); restoreTrust(); delete globalThis.__binaryDiscoverySpawn; delete globalThis.__binaryDiscoveryClient;
  await rmDirRecursive(root);
}
console.log('Actual profile/handshake select the eligible later command, preserve explicit failures and reobserve changed candidates.');
