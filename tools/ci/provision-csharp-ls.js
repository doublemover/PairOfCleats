#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { isPathWithinRoot } from '../../src/shared/file-paths.js';
import { isDirectExecution } from '../../src/shared/direct-execution.js';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { hashManagedToolFile } from '../../src/shared/managed-tool-file.js';
import { bindManagedDotnetEnvironment } from '../tooling/dotnet-environment.js';
import { CSHARP_LS_VERSION } from '../tooling/csharp-ls-recipe.js';
import { DOTNET_SDK_VERSION } from '../tooling/managed-dotnet-sdk.js';

/** A fresh CI-owned NuGet tool install is distinct from the application's
 * unqualified product allocation forecast and from real LSP qualification. */
export const provisionCiCsharpLs = async ({ root = process.cwd(), env = process.env,
  run = spawnResolvedSubprocess } = {}) => {
  assert.equal(env.CI, 'true', 'Csharp CI provisioning requires an explicit CI launch');
  assert.match(env.GITHUB_SHA || '', /^[a-f0-9]{40}$/u);
  for (const key of ['RUNNER_TEMP', 'GITHUB_ENV', 'GITHUB_PATH']) {
    assert.ok(path.isAbsolute(env[key] || '') && !/[\r\n]/u.test(env[key]), `${key}: absolute runner path required`);
  }
  for (const key of ['GITHUB_ENV', 'GITHUB_PATH']) assert.ok(isPathWithinRoot(env[key], env.RUNNER_TEMP));
  const sdk = JSON.parse(await fs.readFile(path.join(root, '.diagnostics/dotnet-sdk.json'), 'utf8'));
  assert.equal(sdk.source, env.GITHUB_SHA);
  assert.equal(sdk.sdkVersion, DOTNET_SDK_VERSION);
  assert.ok(path.isAbsolute(sdk.root || '') && isPathWithinRoot(sdk.root, env.RUNNER_TEMP));
  const executable = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
  assert.equal(sdk.command, path.join(sdk.root, executable));
  assert.ok((await fs.lstat(sdk.command)).isFile());
  assert.equal(hashManagedToolFile(sdk.command), sdk.binarySha256);
  const work = await fs.mkdtemp(path.join(env.RUNNER_TEMP, 'poc-ci-csharp-'));
  const toolingRoot = path.join(work, 'tooling'), tools = path.join(toolingRoot, 'dotnet');
  const routes = { DOTNET_CLI_HOME: path.join(work, 'home'), NUGET_PACKAGES: path.join(work, 'nuget'),
    NUGET_HTTP_CACHE_PATH: path.join(work, 'http-cache'), TMP: path.join(work, 'tmp'),
    TEMP: path.join(work, 'tmp'), TMPDIR: path.join(work, 'tmp') };
  for (const directory of new Set([tools, ...Object.values(routes)])) await fs.mkdir(directory, { recursive: true });
  const launchEnv = bindManagedDotnetEnvironment({ ...env, ...routes }, sdk.root, sdk.command);
  const nugetConfig = path.join(work, 'NuGet.Config');
  await fs.writeFile(nugetConfig, '<configuration><packageSources><clear/><add key="nuget.org" value="https://api.nuget.org/v3/index.json"/></packageSources></configuration>\n');
  const invoke = async (command, args, timeoutMs = 4000) => {
    const result = await run(command, args, { cwd: work, env: launchEnv, stdio: ['ignore', 'pipe', 'pipe'],
      timeoutMs, maxOutputBytes: 1024 * 1024, outputMode: 'string', rejectOnNonZeroExit: false,
      killTree: true, cleanupOnParentExit: true });
    assert.equal(result.exitCode, 0, JSON.stringify({ command, args, ...result }));
    assert.ok(!result.signal && !result.error, 'CI tool setup did not settle successfully');
    assert.ok(!Object.values(result.outputCapture || {}).some(value => value.truncated || value.encodingLoss || value.droppedBytes),
      'CI tool setup output was incomplete');
    return result;
  };
  const selected = await invoke(sdk.command, ['--version']);
  assert.equal(selected.stderr, ''); assert.equal(selected.stdout.trim(), DOTNET_SDK_VERSION);
  const installed = await invoke(sdk.command, ['tool', 'install', '--tool-path', tools, 'csharp-ls',
    '--version', CSHARP_LS_VERSION, '--configfile', nugetConfig], 120000);
  assert.equal(installed.stderr, '');
  assert.ok(!/\b(?:warning|error)\s+[A-Z]+\d+/iu.test(installed.stdout), 'CI tool install emitted a package diagnostic');
  const command = path.join(tools, process.platform === 'win32' ? 'csharp-ls.exe' : 'csharp-ls');
  const stat = await fs.lstat(command);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'CI install must publish its actual regular executable');
  const listing = await invoke(sdk.command, ['tool', 'list', '--tool-path', tools]);
  assert.equal(listing.stderr, '');
  const packages = listing.stdout.split(/\r?\n/u).map(line => line.trim().split(/\s+/u));
  assert.ok(packages.some(fields => fields.length === 3 && fields[0] === 'csharp-ls'
    && fields[1] === CSHARP_LS_VERSION && fields[2] === 'csharp-ls'), 'Installed NuGet tool identity differs');
  const version = await invoke(command, ['--version']);
  assert.equal(version.stderr, '');
  assert.ok(version.stdout.trim().startsWith(`csharp-ls, ${CSHARP_LS_VERSION} `));
  const receipt = { schemaVersion: 1, source: env.GITHUB_SHA, node: process.version, platform: process.platform,
    arch: process.arch, sdk, toolingRoot, command, version: CSHARP_LS_VERSION, routes,
    binarySha256: hashManagedToolFile(command),
    installation: { durationMs: installed.durationMs, stdout: installed.stdout, stderr: installed.stderr },
    packageListing: listing.stdout, qualification: 'ci-owned-install-and-executable-identity',
    managedProductInstallQualified: false, runtimeHandshakeQualified: false };
  await fs.writeFile(path.join(root, '.diagnostics/csharp-ls-provisioning.json'), JSON.stringify(receipt, null, 2) + '\n');
  await fs.appendFile(env.GITHUB_ENV, Object.entries(routes).map(([key, value]) => `${key}=${value}\n`).join(''));
  await fs.appendFile(env.GITHUB_PATH, tools + '\n');
  return receipt;
};

if (isDirectExecution(import.meta.url)) {
  await requireBootstrap();
  const receipt = await provisionCiCsharpLs();
  console.log(JSON.stringify({ version: receipt.version, command: receipt.command, binarySha256: receipt.binarySha256 }));
}
