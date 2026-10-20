import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { initGitRepo } from '../../helpers/git-fixture.js';
import { runNode } from '../../helpers/run-node.js';
import { verifyInstallerRequirementProbe } from '../../../tools/tooling/install-requirements.js';

const root = process.cwd();
const { dir } = await prepareIsolatedTestCacheDir('gopls-sdk-version-contract');
const repo = path.join(dir, 'repo'), binaries = path.join(dir, 'binaries'), tooling = path.join(dir, 'tooling');
await fs.mkdir(repo); await fs.mkdir(binaries); initGitRepo(repo);
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ tooling: { dir: tooling } }));
const versionFile = path.join(dir, 'selected-version.txt'), installMarker = path.join(dir, 'unexpected-install');
const script = path.join(binaries, 'go-fixture.cjs');
const goOs = process.platform === 'win32' ? 'windows' : process.platform;
const goArch = { x64: 'amd64', arm64: 'arm64' }[process.arch] || process.arch;
await fs.writeFile(script, `const fs=require('node:fs');
if(process.argv[2]==='version'){process.stdout.write('go version '+fs.readFileSync(${JSON.stringify(versionFile)},'utf8').trim()+' ${goOs}/${goArch}\\n');}
else {fs.writeFileSync(${JSON.stringify(installMarker)},'unexpected install');process.exit(13);}\n`);
if (process.platform === 'win32') {
  const quote = value => `"${value.replace(/%/g, '%%')}"`;
  await fs.writeFile(path.join(binaries, 'go.cmd'), `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${quote(process.execPath)} ${quote(script)} %*\r\n`);
} else {
  const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;
  await fs.writeFile(path.join(binaries, 'go'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`, { mode: 0o755 });
}
const fixturePath = [binaries, path.dirname(process.execPath)].join(path.delimiter);
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(dir, 'cache'), extraEnv: {
  PATH: fixturePath, Path: fixturePath, GOROOT: undefined, GOTOOLCHAIN: 'local', GOENV: 'off', GOWORK: 'off',
  PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo])
} });
const plan = (overrides = {}, dryRun = true) => {
  const result = runNode([path.join(root, 'tools/tooling/install.js'), '--repo', repo, '--tools', 'gopls',
    '--scope', 'cache', ...(dryRun ? ['--dry-run'] : []), '--json'], 'explicit gopls SDK fixture plan', root, { ...env, ...overrides },
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  return { status: result.status, payload: JSON.parse(result.stdout) };
};
await fs.writeFile(versionFile, 'go1.26.4');
const unsupported = plan();
assert.deepEqual(unsupported.payload.actions, [], 'do not plan a gopls build with an SDK below its declared module minimum');
assert.equal(unsupported.status, 0, 'dry-run keeps its existing planned exit contract');
assert.equal(unsupported.payload.readiness.state, 'planned');
assert.equal(unsupported.payload.readiness.ready, false);
assert.equal(unsupported.payload.results[0].status, 'missing-requirement');
assert.ok(unsupported.payload.results[0].requirementChecks.some(check => check.reason === 'unsupported_go_sdk_version'));
assert.equal(unsupported.payload.results[0].prerequisite, undefined, 'a recognized selected SDK is not silently replaced');
await assert.rejects(fs.access(path.join(tooling, 'sdk/go/current.json')), { code: 'ENOENT' });
const blocked = plan({}, false);
assert.equal(blocked.status, 1, 'an actual incompatible requested installation must fail before executing an installer');
assert.equal(blocked.payload.readiness.state, 'blocked');
assert.deepEqual(blocked.payload.actions, []);
await fs.writeFile(versionFile, 'go1.27.3');
const supported = plan();
assert.equal(supported.status, 0);
assert.equal(supported.payload.actions.length, 1);
assert.deepEqual(supported.payload.actions[0].args, ['install', 'golang.org/x/tools/gopls@v0.24.0']);
assert.equal(supported.payload.actions[0].minimumGoVersion, 'go1.27.0');
const pinnedMissing = plan({ GOROOT: path.join(dir, 'explicit-sdk-not-installed') }, false);
assert.equal(pinnedMissing.status, 1);
assert.deepEqual(pinnedMissing.payload.actions, [], 'an unavailable explicit GOROOT cannot fall through to a different SDK');
assert.equal(pinnedMissing.payload.results[0].status, 'missing-requirement');
assert.equal(pinnedMissing.payload.results[0].prerequisite, undefined);
await assert.rejects(fs.access(installMarker), { code: 'ENOENT' }, 'dry plans never execute the fixture installer');
for (const [version, ok] of [['go1.26.10', false], ['go1.27.0', true], ['go1.27.3', true], ['go1.28.0', true],
  ['go1.27rc1', false], ['devel go1.28-test 2026-10-04', false]]) {
  const result = verifyInstallerRequirementProbe('go', { ok: true, stdout: `go version ${version} linux/amd64` },
    { minimumGoVersion: 'go1.27.0' });
  assert.equal(result.ok, ok, version);
}
console.log('Gopls installation plans declare compatible SDK/version requirements and preserve explicit selection without executing installers');
