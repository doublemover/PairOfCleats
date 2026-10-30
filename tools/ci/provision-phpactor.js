#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { hashManagedToolFile } from '../../src/shared/managed-tool-file.js';
import { PHPACTOR_APPROVED_RELEASE, PHPACTOR_POSIX_SHIM } from '../tooling/approved-artifacts.js';

/** CI's fresh bounded PHAR/shim install does not qualify the product install
 * allocation forecast. Windows retains the stock PHAR's POSIX limitation. */
export const provisionCiPhpactor = async ({ root = process.cwd(), env = process.env,
  run = spawnResolvedSubprocess, platform = process.platform, release = PHPACTOR_APPROVED_RELEASE } = {}) => {
  assert.ok(['linux', 'darwin'].includes(platform), 'Stock PHPactor CI qualification requires POSIX');
  assert.equal(env.CI, 'true'); assert.match(env.GITHUB_SHA || '', /^[a-f0-9]{40}$/u);
  for (const key of ['RUNNER_TEMP', 'GITHUB_ENV', 'GITHUB_PATH']) {
    assert.ok(path.isAbsolute(env[key] || '') && !/[\r\n]/u.test(env[key]), `${key}: absolute runner path required`);
  }
  for (const key of ['GITHUB_ENV', 'GITHUB_PATH']) assert.ok(isPathWithinRoot(env[key], env.RUNNER_TEMP));
  const sdk = JSON.parse(await fs.readFile(path.join(root, '.diagnostics/php-sdk.json'), 'utf8'));
  assert.equal(sdk.source, env.GITHUB_SHA); assert.match(sdk.version || '', /^\d+\.\d+\.\d+$/u);
  assert.ok(path.isAbsolute(sdk.command || ''));
  assert.equal(hashManagedToolFile(sdk.command), sdk.binarySha256);
  const work = await fs.mkdtemp(path.join(env.RUNNER_TEMP, 'poc-ci-phpactor-'));
  const toolingRoot = path.join(work, 'tooling'), bin = path.join(toolingRoot, 'bin');
  const routes = { COMPOSER_HOME: path.join(work, 'composer'), COMPOSER_CACHE_DIR: path.join(work, 'composer-cache'),
    XDG_CACHE_HOME: path.join(work, 'cache'), XDG_CONFIG_HOME: path.join(work, 'config'),
    TMP: path.join(work, 'tmp'), TEMP: path.join(work, 'tmp'), TMPDIR: path.join(work, 'tmp') };
  for (const directory of new Set([bin, ...Object.values(routes)])) await fs.mkdir(directory, { recursive: true });
  const launchEnv = { ...env, ...routes };
  const invoke = async (command, args, timeoutMs = 4000) => {
    const result = await run(command, args, { cwd: work, env: launchEnv, stdio: ['ignore', 'pipe', 'pipe'],
      timeoutMs, maxOutputBytes: 1024 * 1024, outputMode: 'string', rejectOnNonZeroExit: false,
      killTree: true, cleanupOnParentExit: true });
    assert.equal(result.exitCode, 0, JSON.stringify({ command, args, ...result }));
    assert.ok(!result.signal && !result.error);
    assert.ok(!Object.values(result.outputCapture || {}).some(value => value.truncated || value.encodingLoss || value.droppedBytes));
    assert.equal(result.stderr, '');
    return result;
  };
  const selected = await invoke('php', ['-r', 'echo json_encode(["version"=>PHP_VERSION,"binary"=>PHP_BINARY,"extensions"=>get_loaded_extensions()]);']);
  const observed = JSON.parse(selected.stdout);
  assert.equal(observed.version, sdk.version); assert.equal(await fs.realpath(observed.binary), sdk.command);
  for (const extension of ['posix', 'mbstring', 'openssl', 'tokenizer', 'phar']) {
    assert.ok(observed.extensions.some(name => name.toLowerCase() === extension));
  }
  const installer = fileURLToPath(new URL('../tooling/install-phpactor-phar.js', import.meta.url));
  const installed = await invoke(process.execPath, [installer, '--scope', 'cache', '--tooling-root', toolingRoot,
    '--url', release.url, '--sha256', release.sha256, '--timeout-ms', '30000', '--retries', '0'], 35000);
  const command = path.join(bin, 'phpactor'), phar = path.join(bin, 'phpactor.phar');
  assert.equal(hashManagedToolFile(phar, 32 * 1024 * 1024), release.sha256);
  assert.equal(await fs.readFile(command, 'utf8'), PHPACTOR_POSIX_SHIM);
  const version = await invoke(command, ['--version']);
  const prefix = `Phpactor ${release.version}`, observedVersion = version.stdout.trim();
  assert.ok(observedVersion === prefix || observedVersion.startsWith(prefix + ' '));
  const receipt = { schemaVersion: 1, source: env.GITHUB_SHA, node: process.version, platform, arch: process.arch,
    sdk, toolingRoot, command, version: release.version, routes, pharSha256: release.sha256,
    binarySha256: createHash('sha256').update(PHPACTOR_POSIX_SHIM).digest('hex'),
    installation: { durationMs: installed.durationMs, stdout: installed.stdout },
    evidence: release === PHPACTOR_APPROVED_RELEASE ? 'publisher-approved-archive' : 'explicit-simulated-release',
    qualification: 'ci-owned-install-and-executable-identity', managedProductInstallQualified: false, runtimeHandshakeQualified: false };
  await fs.writeFile(path.join(root, '.diagnostics/phpactor-provisioning.json'), JSON.stringify(receipt, null, 2) + '\n');
  await fs.appendFile(env.GITHUB_ENV, Object.entries(routes).map(([key, value]) => `${key}=${value}\n`).join(''));
  await fs.appendFile(env.GITHUB_PATH, bin + '\n');
  return receipt;
};

if (isDirectExecution(import.meta.url)) {
  await requireBootstrap();
  const receipt = await provisionCiPhpactor();
  console.log(JSON.stringify({ version: receipt.version, command: receipt.command, pharSha256: receipt.pharSha256 }));
}
