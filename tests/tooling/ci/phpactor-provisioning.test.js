import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { provisionCiPhpactor } from '../../../tools/ci/provision-phpactor.js';
import { PHPACTOR_POSIX_SHIM } from '../../../tools/tooling/approved-artifacts.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

const { dir } = await prepareIsolatedTestCacheDir('ci-phpactor-provisioning');
// Explicit inert release and child adapter; no PHP/POSIX vendor program runs.
const phar = Buffer.from('explicit simulated publisher archive');
const release = { version: '1.0.0', url: 'https://fixture.invalid/explicit-phpactor.phar',
  sha256: createHash('sha256').update(phar).digest('hex') };
for (const mode of ['success', 'sdk-mismatch', 'sdk-bytes', 'missing-posix', 'install-failure', 'wrong-bytes',
  'wrong-shim', 'wrong-version', 'truncated', 'outside-runner', 'unsupported-platform']) {
  const root = path.join(dir, mode), temporary = path.join(root, 'runner');
  await fs.mkdir(path.join(root, '.diagnostics'), { recursive: true }); await fs.mkdir(temporary);
  const sdkCommand = path.join(temporary, 'explicit-php-fixture');
  const sdkBytes = Buffer.from('explicit simulated PHP SDK'); await fs.writeFile(sdkCommand, sdkBytes);
  const sdk = { source: '1'.repeat(40), version: '8.5.12', command: sdkCommand,
    binarySha256: mode === 'sdk-bytes' ? '0'.repeat(64) : createHash('sha256').update(sdkBytes).digest('hex') };
  await fs.writeFile(path.join(root, '.diagnostics/php-sdk.json'), JSON.stringify(sdk));
  const envFile = path.join(temporary, 'environment'), pathFile = path.join(temporary, 'path');
  await fs.writeFile(envFile, 'ORIGINAL=retained\n'); await fs.writeFile(pathFile, 'retained\n');
  const env = { CI: 'true', GITHUB_SHA: sdk.source, RUNNER_TEMP: temporary,
    GITHUB_ENV: mode === 'outside-runner' ? path.join(root, 'outside') : envFile, GITHUB_PATH: pathFile };
  let installs = 0, command;
  const run = async (selected, args, options) => {
    for (const key of ['COMPOSER_HOME', 'COMPOSER_CACHE_DIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'TMP', 'TEMP', 'TMPDIR']) {
      assert.ok(isPathWithinRoot(options.env[key], temporary));
    }
    const result = { exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 1 };
    if (selected === 'php') {
      result.stdout = JSON.stringify({ version: mode === 'sdk-mismatch' ? '0.0.0' : sdk.version,
        binary: sdk.command, extensions: ['mbstring', 'openssl', 'tokenizer', 'phar', ...(mode === 'missing-posix' ? [] : ['posix'])] });
    } else if (selected === process.execPath) {
      installs++;
      assert.ok(args[0].endsWith('install-phpactor-phar.js'));
      assert.equal(args[args.indexOf('--sha256') + 1], release.sha256);
      assert.equal(args[args.indexOf('--url') + 1], release.url);
      assert.equal(args[args.indexOf('--retries') + 1], '0');
      if (mode === 'install-failure') return { ...result, exitCode: 1, stderr: 'controlled download refusal' };
      const bin = path.join(args[args.indexOf('--tooling-root') + 1], 'bin'); command = path.join(bin, 'phpactor');
      await fs.writeFile(path.join(bin, 'phpactor.phar'), mode === 'wrong-bytes' ? 'foreign bytes' : phar);
      await fs.writeFile(command, mode === 'wrong-shim' ? 'foreign launcher' : PHPACTOR_POSIX_SHIM);
    } else {
      assert.equal(selected, command); assert.deepEqual(args, ['--version']);
      result.stdout = `Phpactor ${mode === 'wrong-version' ? '0.0.0' : release.version}\n`;
      if (mode === 'truncated') result.outputCapture = { stdout: { truncated: true } };
    }
    return result;
  };
  const options = { root, env, run, release, platform: mode === 'unsupported-platform' ? 'win32' : 'linux' };
  if (mode === 'success') {
    const receipt = await provisionCiPhpactor(options);
    assert.equal(receipt.pharSha256, release.sha256); assert.equal(receipt.evidence, 'explicit-simulated-release');
    assert.equal(receipt.managedProductInstallQualified, false); assert.equal(receipt.runtimeHandshakeQualified, false);
    assert.equal(installs, 1); assert.ok((await fs.readFile(envFile, 'utf8')).startsWith('ORIGINAL=retained\n'));
    assert.equal(await fs.readFile(pathFile, 'utf8'), `retained\n${path.dirname(command)}\n`);
  } else {
    await assert.rejects(provisionCiPhpactor(options));
    assert.equal(await fs.readFile(envFile, 'utf8'), 'ORIGINAL=retained\n'); assert.equal(await fs.readFile(pathFile, 'utf8'), 'retained\n');
    assert.equal(installs, ['sdk-mismatch', 'sdk-bytes', 'missing-posix', 'outside-runner', 'unsupported-platform'].includes(mode) ? 0 : 1);
    await assert.rejects(fs.stat(path.join(root, '.diagnostics/phpactor-provisioning.json')), { code: 'ENOENT' });
  }
}
console.log('CI PHPactor provisioning binds SDK, original PHAR/shim bytes and complete version evidence; Windows remains unsupported.');
