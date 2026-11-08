import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { getToolingRegistry, detectTool } from '../../../tools/tooling/utils.js';
import { applyToolchainDaemonPolicyEnv } from '../../../src/shared/toolchain-env.js';
import { __resetToolingCommandProbeCacheForTests, resolveToolingCommandProfile } from '../../../src/index/tooling/command-resolver.js';

const { dir } = await prepareIsolatedTestCacheDir('ruby-cache-environment');
const toolingRoot = path.join(dir, 'selected-tooling'), bin = path.join(toolingRoot, 'bin');
const repo = path.join(dir, 'explicit-fixture-repo');
await fs.mkdir(bin, { recursive: true }); await fs.mkdir(repo);
const gems = path.join(toolingRoot, 'gems');
const privateToken = 'synthetic-private-probe-environment-value';
const fixture = path.join(bin, 'explicit-gem-launcher-fixture.cjs');
await fs.writeFile(fixture, `const path=require('node:path');
const roots=String(process.env.GEM_PATH||'').split(path.delimiter);
if(!roots.includes(${JSON.stringify(gems)})){console.error('fixture missing selected gem search root');process.exit(28);}
if(process.env.GEM_HOME!==${JSON.stringify(gems)}){console.error('fixture rejects deliberately incompatible user gem home');process.exit(29);}
console.log('explicit gem launcher fixture 1.0.0');\n`);
for (const name of ['solargraph', 'ruby-lsp']) {
  if (process.platform === 'win32') {
    const quote = value => `"${value.replace(/%/g, '%%')}"`;
    await fs.writeFile(path.join(bin, `${name}.cmd`), `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${quote(process.execPath)} ${quote(fixture)} %*\r\n`);
  } else {
    const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;
    await fs.writeFile(path.join(bin, name), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`, { mode: 0o755 });
  }
}
const environment = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'fixture-cache'), extraEnv: {
  GEM_HOME: undefined, GEM_PATH: undefined, FIXTURE_PROBE_SECRET: privateToken,
  PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo])
} });
await withTemporaryEnv(environment, async () => {
  const caller = { PATH: path.dirname(process.execPath) };
  const command = path.join(bin, process.platform === 'win32' ? 'solargraph.cmd' : 'solargraph');
  const prepared = applyToolchainDaemonPolicyEnv(caller, { toolingRoot, command, providerId: 'solargraph' });
  assert.equal(prepared.GEM_HOME, gems, 'a cached gem launcher must select its installed gem home');
  assert.equal(prepared.GEM_PATH, gems + path.delimiter, 'an absent explicit search path retains RubyGems defaults');
  assert.deepEqual(caller, { PATH: path.dirname(process.execPath) }, 'caller environment is immutable');
  const user = { ...caller, GEM_HOME: path.join(dir, 'user-home'), GEM_PATH: path.join(dir, 'user-search') };
  const selected = applyToolchainDaemonPolicyEnv(user, { toolingRoot, command, providerId: 'solargraph' });
  assert.equal(selected.GEM_HOME, user.GEM_HOME);
  assert.deepEqual(selected.GEM_PATH.split(path.delimiter), [gems, user.GEM_PATH]);
  for (const external of ['solargraph', path.join(dir, 'external-bin', path.basename(command)), path.join(bin, 'unrelated')]) {
    const untouched = applyToolchainDaemonPolicyEnv(user, { toolingRoot, command: external, providerId: 'solargraph' });
    assert.equal(untouched.GEM_HOME, user.GEM_HOME); assert.equal(untouched.GEM_PATH, user.GEM_PATH);
  }
  for (const id of ['solargraph', 'ruby-lsp']) {
    const tool = getToolingRegistry(toolingRoot, repo).find(entry => entry.id === id);
    const detected = detectTool(tool);
    assert.equal(detected.found, true, JSON.stringify(detected));
    assert.equal(path.dirname(detected.path), bin, 'the explicitly selected fixture command supplies the positive');
    const profile = resolveToolingCommandProfile({ providerId: id, cmd: detected.path, args: [], repoRoot: repo,
      toolingConfig: { dir: toolingRoot } });
    assert.equal(profile.probe.ok, true, JSON.stringify(profile));
  }
  __resetToolingCommandProbeCacheForTests();
  const profile = () => resolveToolingCommandProfile({ providerId: 'solargraph', cmd: command, args: [], repoRoot: repo,
    toolingConfig: { dir: toolingRoot, cache: { dir: path.join(dir, 'probe-cache') } } });
  assert.equal(profile().probe.ok, true);
  assert.equal(profile().probe.cached, true);
  __resetToolingCommandProbeCacheForTests();
  assert.equal(profile().probe.cacheSource, 'persistent', 'the positive is actually persisted before changing the environment');
  await withTemporaryEnv({ GEM_HOME: path.join(dir, 'deliberately-incompatible-user-home') }, () => {
    assert.equal(profile().probe.ok, false, 'a prior warm success cannot certify a different launcher environment');
    __resetToolingCommandProbeCacheForTests();
    assert.equal(profile().probe.ok, false, 'persisted success is also scoped to the effective launcher environment');
  });
  __resetToolingCommandProbeCacheForTests();
  assert.equal(profile().probe.cacheSource, 'persistent', 'the compatible environment retains its independent persisted positive');
  for (const name of await fs.readdir(path.join(dir, 'probe-cache/command-probes'))) {
    const bytes = await fs.readFile(path.join(dir, 'probe-cache/command-probes', name), 'utf8');
    assert.equal(bytes.includes(privateToken), false, 'cache context must not persist raw environment secrets');
  }
});
console.log('Simulated cached Ruby launchers bind their selected gem root, retain caller pins and leave external commands unchanged');
