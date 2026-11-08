#!/usr/bin/env node
// Authored consumer regression; real vendor installation/platform qualification
// remains separate. Every executable below is an explicitly trusted fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { identifyAstGrepVersion, resolveAstGrepManagedRecipe, verifyManagedAstGrep } from '../../../tools/tooling/managed-ast-grep.js';
import { getToolingRegistry, selectInstallPlan } from '../../../tools/tooling/utils.js';
import { installPinnedManagedTool, validatePinnedInstallDescriptor } from '../../../tools/tooling/managed-install.js';
import { detectToolOwned } from '../../../tools/tooling/owned-detect.js';
import { resolveBinary } from '../../../src/experimental/structural/binaries.js';

assert.equal(identifyAstGrepVersion('ast-grep 0.51.0\n'), '0.51.0');
for (const output of ['sg from util-linux 2.41.0', '0.51.0', 'ast-grep 0.51.0\nextra output']) assert.equal(identifyAstGrepVersion(output), null);
for (const [platform, arches] of [['win32', ['x64', 'arm64', 'ia32']], ['darwin', ['x64', 'arm64']], ['linux', ['x64', 'arm64']]]) {
  for (const arch of arches) {
    const recipe = resolveAstGrepManagedRecipe({ platform, arch, libc: 'glibc' });
    const descriptor = validatePinnedInstallDescriptor(recipe.managedDescriptor, { ...recipe, platform, arch });
    assert.equal(descriptor.version, '0.51.0');
    assert.match(descriptor.archive.url, /\/0\.51\.0\/app-[a-z0-9_-]+\.zip$/);
    assert.ok(descriptor.storageEstimate.writes[0].requiredBytes > descriptor.archive.bytes + 1024 * 1024 * 1024);
  }
}
assert.equal(resolveAstGrepManagedRecipe({ platform: 'linux', arch: 'x64', libc: 'musl' }), null);
assert.equal(resolveAstGrepManagedRecipe({ platform: 'linux', arch: 'x64', libc: 'unknown' }), null);
assert.equal(resolveAstGrepManagedRecipe({ platform: 'freebsd', arch: 'x64' }), null);

const temporary = await makeTempDir('poc-ast-grep-managed-');
try {
  const repo = path.join(temporary, 'repo');
  const toolingRoot = path.join(temporary, 'tools');
  await fs.mkdir(repo);
  const trustedFixtureCommand = process.platform === 'win32' ? 'trusted-ast-grep-fixture.cmd' : 'trusted-ast-grep-fixture';
  const input = 'console.log("pairofcleats-managed-probe")';
  const fixtureBody = `if(process.argv.includes('--version')) console.log('ast-grep 0.51.0');
else { let input=''; for await(const chunk of process.stdin) input+=chunk; console.log(JSON.stringify([{text:input}])); }\n`;
  const archive = Buffer.from('explicit trusted fixture archive, never a vendor binary');
  const recipe = resolveAstGrepManagedRecipe({ platform: process.platform, arch: process.arch, libc: 'glibc' });
  assert.ok(recipe, 'fixture platform must have a declared native archive');
  const descriptor = { ...recipe.managedDescriptor, recipeId: 'trusted-fixture-archive', command: trustedFixtureCommand,
    requiredFiles: [trustedFixtureCommand, 'fixture.mjs'], executables: [trustedFixtureCommand],
    archive: { url: 'https://fixture.example.test/ast-grep-0.51.0.zip', type: 'zip', bytes: archive.length,
      sha256: createHash('sha256').update(archive).digest('hex') },
    storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 1024 * 1024 }] } };
  let downloads = 0;
  const dependencies = {
    approvedOrigins: ['https://fixture.example.test'],
    download: async ({ url }) => { downloads++; return { sourceUrl: url, body: archive }; },
    extract: async (_archive, destination) => {
      await fs.mkdir(destination, { recursive: true });
      await fs.writeFile(path.join(destination, 'fixture.mjs'), fixtureBody);
      await fs.writeFile(path.join(destination, trustedFixtureCommand), process.platform === 'win32'
        ? `@echo off\r\n"${process.execPath}" "%~dp0fixture.mjs" %*\r\n`
        : `#!${process.execPath}\n${fixtureBody}`, { mode: 0o755 });
    },
    verify: verifyManagedAstGrep
  };
  const env = applyTestEnv({ syncProcess: false, testConfig: { tooling: { dir: toolingRoot } },
    extraEnv: { PAIROFCLEATS_HOME: path.join(temporary, 'home'), PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo]), PAIROFCLEATS_TRUSTED_CONFIG: null } });
  await withTemporaryEnv(env, async () => {
    const first = await installPinnedManagedTool({ toolingRoot, descriptor, ...dependencies });
    assert.equal(first.ok, true);
    assert.equal(first.verification.level, 'pinned-executable-and-local-structural-match');
    assert.equal((await installPinnedManagedTool({ toolingRoot, descriptor, ...dependencies })).reused, true);
    assert.equal(downloads, 1, 'verified generation reuse never reacquires an archive');
    const tool = getToolingRegistry(toolingRoot, repo).find(entry => entry.id === 'ast-grep');
    assert.equal(tool.managedInstallation.command, first.command);
    assert.equal(selectInstallPlan(tool, 'cache', false).plan.managedDescriptor.recipeId, 'ast-grep-official-native-archive');
    const observed = await detectToolOwned(tool);
    assert.equal(observed.found, true);
    assert.equal(observed.path, first.command);
    assert.equal(observed.probe.identity.version, '0.51.0');
    const consumer = resolveBinary('ast-grep', { repoRoot: repo });
    assert.equal(consumer.command, first.command, 'structural consumer resolves the managed executable without PATH edits');
    assert.equal(consumer.requiresOwnedExecution, true);
    const cli = runNode(['tools/tooling/install.js', '--repo', repo, '--tools', 'ast-grep', '--no-fallback', '--json'],
      'reuse explicitly trusted managed ast-grep fixture', process.cwd(), env, { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
    assert.equal(cli.status, 0, cli.stderr);
    const payload = JSON.parse(cli.stdout);
    assert.equal(payload.results[0].status, 'already-installed');
    assert.equal(payload.results[0].path, first.command);
    assert.equal(payload.actions.length, 0, 'existing compatible executable is reused before the archive mutation branch');
    assert.equal(downloads, 1);
    let calls = 0;
    const rejected = await verifyManagedAstGrep({ command: first.command, root: first.root, toolingRoot, descriptor, resourceId: 'fixture-version' }, { probe: async () => {
      calls++; return { ok: true, stdout: 'ast-grep 0.39.0' };
    } });
    assert.equal(rejected.ok, false);
    assert.equal(calls, 1, 'a wrong pinned version never reaches capability execution');
    const malformed = await verifyManagedAstGrep({ command: first.command, root: first.root, toolingRoot, descriptor, resourceId: 'fixture-match' }, { probe: async (_command, args, options) => {
      if (args[0] === '--version') return { ok: true, stdout: 'ast-grep 0.51.0' };
      assert.equal(options.input, input);
      return { ok: true, stdout: '[]' };
    } });
    assert.equal(malformed.ok, false, 'empty matches cannot qualify the selected parser');
    const spoof = await detectToolOwned(tool, {}, { spawn: async () => ({ exitCode: 0, stdout: 'sg from util-linux 2.41.0', stderr: '' }) });
    assert.equal(spoof.found, false, 'exit-zero unrelated commands are not accepted by the installer detector');
  });
} finally { await rmDirRecursive(temporary); }
console.log('Pinned ast-grep archives bind installer, retained detection and structural consumer; vendor execution remains unqualified.');
