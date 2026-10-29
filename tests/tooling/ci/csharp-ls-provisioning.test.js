import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { provisionCiCsharpLs } from '../../../tools/ci/provision-csharp-ls.js';
import { CSHARP_LS_VERSION } from '../../../tools/tooling/csharp-ls-recipe.js';
import { DOTNET_SDK_VERSION } from '../../../tools/tooling/managed-dotnet-sdk.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

const { dir } = await prepareIsolatedTestCacheDir('ci-csharp-ls-provisioning');
const binary = Buffer.from('explicit simulated tool executable');
for (const mode of ['success', 'sdk-mismatch', 'sdk-bytes', 'install-failure', 'wrong-package', 'wrong-version',
  'truncated', 'outside-runner', 'package-warning']) {
  const root = path.join(dir, mode), temporary = path.join(root, 'runner'), sdkRoot = path.join(temporary, 'sdk');
  await fs.mkdir(path.join(root, '.diagnostics'), { recursive: true });
  await fs.mkdir(sdkRoot, { recursive: true });
  const sdkCommand = path.join(sdkRoot, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
  const sdkBytes = Buffer.from('explicit simulated SDK host'); await fs.writeFile(sdkCommand, sdkBytes);
  const sdk = { source: '1'.repeat(40), sdkVersion: DOTNET_SDK_VERSION, root: sdkRoot, command: sdkCommand,
    binarySha256: mode === 'sdk-bytes' ? '0'.repeat(64) : createHash('sha256').update(sdkBytes).digest('hex') };
  await fs.writeFile(path.join(root, '.diagnostics/dotnet-sdk.json'), JSON.stringify(sdk));
  const envFile = path.join(temporary, 'environment'), pathFile = path.join(temporary, 'path');
  await fs.writeFile(envFile, 'ORIGINAL=retained\n'); await fs.writeFile(pathFile, 'retained\n');
  const env = { CI: 'true', GITHUB_SHA: sdk.source, RUNNER_TEMP: temporary,
    GITHUB_ENV: mode === 'outside-runner' ? path.join(root, 'outside') : envFile, GITHUB_PATH: pathFile };
  let installs = 0, toolDirectory;
  const run = async (command, args, options) => {
    assert.equal(options.env.DOTNET_ROOT, sdk.root); assert.equal(options.env.DOTNET_HOST_PATH, sdk.command);
    for (const key of ['DOTNET_CLI_HOME', 'NUGET_PACKAGES', 'NUGET_HTTP_CACHE_PATH', 'TMP', 'TEMP', 'TMPDIR']) {
      assert.ok(isPathWithinRoot(options.env[key], temporary));
    }
    const result = { exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 1 };
    if (args[0] === 'tool' && args[1] === 'install') {
      installs++; assert.equal(command, sdk.command);
      toolDirectory = args[args.indexOf('--tool-path') + 1];
      assert.equal(args[args.indexOf('--version') + 1], CSHARP_LS_VERSION);
      const config = await fs.readFile(args[args.indexOf('--configfile') + 1], 'utf8');
      assert.ok(config.includes('<clear/>')); assert.ok(config.includes('https://api.nuget.org/v3/index.json'));
      if (mode === 'install-failure') return { ...result, exitCode: 1, stderr: 'controlled install refusal' };
      if (mode === 'package-warning') result.stdout = 'warning NU1902: controlled package advisory';
      await fs.writeFile(path.join(toolDirectory, process.platform === 'win32' ? 'csharp-ls.exe' : 'csharp-ls'), binary);
    } else if (args[0] === 'tool') {
      assert.equal(command, sdk.command); assert.equal(args[1], 'list');
      result.stdout = `${mode === 'wrong-package' ? 'foreign' : 'csharp-ls'} ${CSHARP_LS_VERSION} csharp-ls\n`;
    } else if (command === sdk.command) {
      result.stdout = mode === 'sdk-mismatch' ? '0.0.0\n' : `${DOTNET_SDK_VERSION}\n`;
    } else {
      assert.equal(command, path.join(toolDirectory, process.platform === 'win32' ? 'csharp-ls.exe' : 'csharp-ls'));
      result.stdout = `csharp-ls, ${mode === 'wrong-version' ? '0.0.0' : CSHARP_LS_VERSION} (explicit fixture)\n`;
      if (mode === 'truncated') result.outputCapture = { stdout: { truncated: true } };
    }
    return result;
  };
  if (mode === 'success') {
    const receipt = await provisionCiCsharpLs({ root, env, run });
    assert.equal(receipt.binarySha256, createHash('sha256').update(binary).digest('hex'));
    assert.equal(receipt.managedProductInstallQualified, false); assert.equal(receipt.runtimeHandshakeQualified, false);
    assert.equal(receipt.command, path.join(receipt.toolingRoot, 'dotnet', process.platform === 'win32' ? 'csharp-ls.exe' : 'csharp-ls'));
    assert.equal(installs, 1); assert.ok((await fs.readFile(envFile, 'utf8')).startsWith('ORIGINAL=retained\n'));
    assert.equal(await fs.readFile(pathFile, 'utf8'), `retained\n${path.dirname(receipt.command)}\n`);
  } else {
    await assert.rejects(provisionCiCsharpLs({ root, env, run }));
    assert.equal(await fs.readFile(envFile, 'utf8'), 'ORIGINAL=retained\n');
    assert.equal(await fs.readFile(pathFile, 'utf8'), 'retained\n');
    assert.equal(installs, ['sdk-mismatch', 'sdk-bytes', 'outside-runner'].includes(mode) ? 0 : 1);
    await assert.rejects(fs.stat(path.join(root, '.diagnostics/csharp-ls-provisioning.json')), { code: 'ENOENT' });
  }
}
console.log('CI Csharp setup verifies original SDK bytes, fresh NuGet/tool identity and complete output before publishing paths.');
