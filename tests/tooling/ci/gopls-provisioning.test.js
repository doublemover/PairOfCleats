import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { provisionCiGopls } from '../../../tools/ci/provision-gopls.js';
import { GOPLS_PACKAGE, GOPLS_VERSION } from '../../../tools/tooling/gopls-recipe.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { isPathWithinRoot } from '../../../src/shared/file-paths.js';

const { dir } = await prepareIsolatedTestCacheDir('ci-gopls-provisioning');
for (const mode of ['success', 'sdk-mismatch', 'build-failure', 'wrong-package', 'wrong-version', 'truncated', 'outside-runner']) {
  const root = path.join(dir, mode), temporary = path.join(root, 'runner');
  await fs.mkdir(path.join(root, '.diagnostics'), { recursive: true });
  await fs.mkdir(temporary);
  const sdk = { GOVERSION: 'go1.27.3', GOROOT: path.join(root, 'sdk') };
  await fs.writeFile(path.join(root, '.diagnostics/go-sdk.json'), JSON.stringify(sdk));
  const envFile = path.join(temporary, 'environment'), pathFile = path.join(temporary, 'path');
  await fs.writeFile(envFile, 'ORIGINAL=retained\n'); await fs.writeFile(pathFile, 'retained\n');
  const env = { CI: 'true', RUNNER_TEMP: temporary, GITHUB_ENV: mode === 'outside-runner' ? path.join(root, 'outside') : envFile, GITHUB_PATH: pathFile };
  let builds = 0;
  const binary = Buffer.from('explicit simulated compiler output');
  const run = async (command, args, options) => {
    assert.equal(options.env.GOTOOLCHAIN, 'local'); assert.equal(options.env.GOWORK, 'off');
    assert.equal(options.env.GOROOT, sdk.GOROOT);
    for (const key of ['GOBIN', 'GOPATH', 'GOMODCACHE', 'GOCACHE', 'GOTMPDIR']) assert.ok(isPathWithinRoot(options.env[key], temporary));
    const result = { exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 1 };
    if (args[0] === 'env') result.stdout = JSON.stringify({ ...sdk, ...(mode === 'sdk-mismatch' ? { GOVERSION: 'go0.0.0' } : {}) });
    else if (args[0] === 'install') {
      builds++; assert.equal(command, 'go'); assert.deepEqual(args, ['install', GOPLS_PACKAGE]);
      if (mode === 'build-failure') return { ...result, exitCode: 1, stderr: 'controlled native build refusal' };
      await fs.writeFile(path.join(options.env.GOBIN, process.platform === 'win32' ? 'gopls.exe' : 'gopls'), binary);
    } else if (args[0] === 'version' && args[1] === '-m') {
      result.stdout = `${args[2]}: ${sdk.GOVERSION}\n\tpath\tgolang.org/x/tools/${mode === 'wrong-package' ? 'foreign' : 'gopls'}\n\tmod\tgolang.org/x/tools/gopls\tv${GOPLS_VERSION}\th1:fixture\n`;
    } else {
      assert.deepEqual(args, ['version']);
      result.stdout = `golang.org/x/tools/gopls v${mode === 'wrong-version' ? '0.0.0' : GOPLS_VERSION}\n`;
      if (mode === 'truncated') result.outputCapture = { stdout: { truncated: true } };
    }
    return result;
  };
  if (mode === 'success') {
    const receipt = await provisionCiGopls({ root, env, run });
    assert.equal(receipt.binarySha256, createHash('sha256').update(binary).digest('hex'));
    assert.equal(receipt.routes.GOBIN, path.join(receipt.toolingRoot, 'bin'));
    assert.equal(path.dirname(receipt.command), receipt.routes.GOBIN);
    assert.equal(receipt.managedProductInstallQualified, false); assert.equal(receipt.runtimeHandshakeQualified, false);
    assert.equal(builds, 1);
    assert.ok((await fs.readFile(envFile, 'utf8')).startsWith('ORIGINAL=retained\n'));
    for (const [key, value] of Object.entries(receipt.routes)) assert.ok((await fs.readFile(envFile, 'utf8')).includes(`${key}=${value}\n`));
    assert.equal(await fs.readFile(pathFile, 'utf8'), `retained\n${receipt.routes.GOBIN}\n`);
  } else {
    await assert.rejects(provisionCiGopls({ root, env, run }));
    assert.equal(await fs.readFile(envFile, 'utf8'), 'ORIGINAL=retained\n');
    assert.equal(await fs.readFile(pathFile, 'utf8'), 'retained\n');
    assert.equal(builds, ['sdk-mismatch', 'outside-runner'].includes(mode) ? 0 : 1);
    await assert.rejects(fs.stat(path.join(root, '.diagnostics/gopls-provisioning.json')), { code: 'ENOENT' });
  }
}
console.log('CI gopls setup binds SDK, package and executable identity before publishing runner-local paths.');
