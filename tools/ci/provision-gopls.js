#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { GOPLS_PACKAGE, GOPLS_VERSION } from '../tooling/gopls-recipe.js';

/** CI owns this fresh runner-temporary SDK build. It does not promote the
 * application's deliberately unqualified managed-install allocation forecast.
 * Runtime startup/shutdown qualification remains a separate required step. */
export const provisionCiGopls = async ({ root = process.cwd(), env = process.env,
  run = spawnResolvedSubprocess } = {}) => {
  assert.equal(env.CI, 'true', 'gopls CI provisioning requires an explicit CI launch');
  for (const key of ['RUNNER_TEMP', 'GITHUB_ENV', 'GITHUB_PATH']) {
    assert.ok(path.isAbsolute(env[key] || '') && !/[\r\n]/u.test(env[key]), `${key}: absolute runner path required`);
  }
  for (const key of ['GITHUB_ENV', 'GITHUB_PATH']) assert.ok(isPathWithinRoot(env[key], env.RUNNER_TEMP), `${key}: outside runner temporary namespace`);
  const sdk = JSON.parse(await fs.readFile(path.join(root, '.diagnostics/go-sdk.json'), 'utf8'));
  assert.match(sdk.GOVERSION, /^go\d+\.\d+\.\d+$/u);
  assert.ok(path.isAbsolute(sdk.GOROOT || '') && !/[\r\n]/u.test(sdk.GOROOT));
  const work = await fs.mkdtemp(path.join(env.RUNNER_TEMP, 'poc-ci-gopls-'));
  const routes = Object.fromEntries(['GOBIN', 'GOPATH', 'GOMODCACHE', 'GOCACHE', 'GOTMPDIR']
    .map(key => [key, path.join(work, key.toLowerCase())]));
  for (const directory of Object.values(routes)) await fs.mkdir(directory);
  const launchEnv = { ...env, ...routes, GOROOT: sdk.GOROOT, GOTOOLCHAIN: 'local', GOWORK: 'off', GOFLAGS: '' };
  const invoke = async (command, args, timeoutMs = 4000) => {
    const result = await run(command, args, { cwd: work, env: launchEnv, stdio: ['ignore', 'pipe', 'pipe'],
      timeoutMs, maxOutputBytes: 1024 * 1024, outputMode: 'string', rejectOnNonZeroExit: false,
      killTree: true, cleanupOnParentExit: true });
    assert.equal(result.exitCode, 0, JSON.stringify({ command, args, ...result }));
    assert.ok(!result.signal && !result.error, 'CI tool setup did not settle successfully');
    assert.ok(!Object.values(result.outputCapture || {}).some(value => value.truncated || value.encodingLoss || value.droppedBytes), 'CI tool setup output was incomplete');
    return result;
  };
  const selected = await invoke('go', ['env', '-json', 'GOVERSION', 'GOROOT']);
  assert.equal(selected.stderr, '');
  assert.deepEqual(JSON.parse(selected.stdout), { GOVERSION: sdk.GOVERSION, GOROOT: sdk.GOROOT });
  const built = await invoke('go', ['install', GOPLS_PACKAGE], 300000);
  const command = path.join(routes.GOBIN, process.platform === 'win32' ? 'gopls.exe' : 'gopls');
  const stat = await fs.lstat(command);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'CI build must publish its actual regular executable');
  const version = await invoke(command, ['version']);
  assert.equal(version.stderr, '');
  assert.equal(version.stdout.trim(), `golang.org/x/tools/gopls v${GOPLS_VERSION}`);
  const metadata = await invoke('go', ['version', '-m', command]);
  assert.equal(metadata.stderr, '');
  assert.ok(metadata.stdout.includes(`\tpath\tgolang.org/x/tools/gopls\n`));
  assert.ok(metadata.stdout.includes(`\tmod\tgolang.org/x/tools/gopls\tv${GOPLS_VERSION}\t`));
  assert.ok(metadata.stdout.split(/\r?\n/u)[0].endsWith(`: ${sdk.GOVERSION}`));
  const receipt = { schemaVersion: 1, source: env.GITHUB_SHA || null, node: process.version,
    platform: process.platform, arch: process.arch, package: GOPLS_PACKAGE, sdk, command, routes,
    binarySha256: createHash('sha256').update(await fs.readFile(command)).digest('hex'),
    build: { durationMs: built.durationMs, stdout: built.stdout, stderr: built.stderr },
    metadata: metadata.stdout, qualification: 'ci-owned-build-and-executable-identity',
    managedProductInstallQualified: false, runtimeHandshakeQualified: false };
  await fs.writeFile(path.join(root, '.diagnostics/gopls-provisioning.json'), JSON.stringify(receipt, null, 2) + '\n');
  await fs.appendFile(env.GITHUB_ENV, Object.entries(routes).map(([key, value]) => `${key}=${value}\n`).join(''));
  await fs.appendFile(env.GITHUB_PATH, routes.GOBIN + '\n');
  return receipt;
};

if (isDirectExecution(import.meta.url)) {
  await requireBootstrap();
  const receipt = await provisionCiGopls();
  console.log(JSON.stringify({ package: receipt.package, command: receipt.command, binarySha256: receipt.binarySha256 }));
}
