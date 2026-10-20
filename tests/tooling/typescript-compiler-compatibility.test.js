import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { assertTypeScriptCompatibility, getTypeScriptCompatibility, MIN_TYPESCRIPT_VERSION } from '../../src/index/tooling/typescript/compatibility.js';
import { loadTypeScript, loadTypeScriptModule, getTypeScriptLoadReceipt, clearTypeScriptModuleCache } from '../../src/index/tooling/typescript/load.js';
import { createVirtualCompilerHost } from '../../src/index/tooling/typescript/host.js';
import { preflightTypeScriptSource } from '../../src/index/tooling/typescript/resolution.js';
import { runToolingDoctor } from '../../src/index/tooling/doctor.js';
import { registerDefaultToolingProviders } from '../../src/index/tooling/providers/index.js';
import { applyTestEnv } from '../helpers/test-env.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ts-compatibility-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
const priorTrust = process.env.PAIROFCLEATS_TRUSTED_REPOS;
const require = createRequire(import.meta.url), compilerFile = require.resolve('typescript');
const rejection = error => error?.code === 'ERR_SEMANTIC_DEPENDENCY_UNSEALED' && error.reason === 'typescript_incompatible'
  && error.message.includes(MIN_TYPESCRIPT_VERSION) && error.message.includes('resolveOrder');
const putCompiler = async (location, overrides = '') => {
  await fs.mkdir(path.join(location, 'lib'), { recursive: true });
  await fs.writeFile(path.join(location, 'package.json'), JSON.stringify({ name: 'typescript', main: './lib/typescript.js' }));
  await fs.writeFile(path.join(location, 'lib/typescript.js'), `module.exports = { ...require(${JSON.stringify(compilerFile)})${overrides} };`);
};
registerDefaultToolingProviders();
try {
  assert.equal(getTypeScriptCompatibility(ts).ok, true);
  for (const broken of [null, { ...ts, version: '4.8.4' }, { ...ts, version: '5.6.3' },
    { ...ts, version: 'unknown' }, { ...ts, JSDocParsingMode: undefined },
    { ...ts, getDefaultResolutionModeForFileWorker: undefined }, { ...ts, forEachDynamicImportOrRequireCall: undefined }]) {
    assert.throws(() => assertTypeScriptCompatibility(broken), rejection);
    assert.throws(() => createVirtualCompilerHost(broken, {}, new Map()), rejection);
    assert.throws(() => preflightTypeScriptSource(broken, {}, 'main.ts', {}), rejection);
  }
  for (const [index, overrides] of [', version: "4.8.4"', ', JSDocParsingMode: undefined', ''].entries()) {
    const repo = path.join(root, `repo-${index}`), location = path.join(repo, 'node_modules/typescript');
    await putCompiler(location, overrides);
    process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]);
    const config = { typescript: { enabled: true, useTsconfig: false } };
    const pinned = { typescript: { ...config.typescript, resolveOrder: ['repo'] } };
    const report = await runToolingDoctor({ repoRoot: repo, buildRoot: repo, toolingConfig: config, strict: false },
      ['typescript'], { log: () => {}, probeHandshake: false });
    const provider = report.providers.find(entry => entry.id === 'typescript');
    if (overrides) {
      assert.equal(provider.status, 'error');
      assert.ok(provider.checks.some(check => check.name === 'typescript-compatibility' && check.status === 'error'));
      assert.match(provider.checks.find(check => check.name === 'typescript-compatibility').message, /lib[/\\]typescript\.js/);
      await assert.rejects(loadTypeScript(config, repo), rejection, 'default order cannot silently bypass an incompatible repo compiler');
      await assert.rejects(loadTypeScript(pinned, repo), rejection, 'explicit repo selection must not fall back');
      assert.throws(() => loadTypeScriptModule(repo), rejection);
    } else {
      assert.ok(provider.checks.some(check => check.name === 'typescript-version' && check.status === 'ok'));
      const compiler = await loadTypeScript(pinned, repo), receipt = getTypeScriptLoadReceipt(compiler);
      assert.equal(compiler.version, ts.version);
      assert.ok(receipt.filename.endsWith(path.join('lib', 'typescript.js')));
      assert.match(receipt.hash, /^[a-f0-9]{64}$/);
      assert.equal(loadTypeScriptModule(repo), compiler);
    }
    clearTypeScriptModuleCache(repo);
  }
  const repo = path.join(root, 'missing'), tooling = path.join(root, 'tooling');
  await fs.mkdir(repo);
  await putCompiler(path.join(tooling, 'node/node_modules/typescript'), ', version: "4.8.4"');
  await assert.rejects(loadTypeScript({ dir: tooling, typescript: { resolveOrder: ['cache'] } }, repo), rejection);
  const missing = await runToolingDoctor({ repoRoot: repo, buildRoot: repo,
    toolingConfig: { typescript: { resolveOrder: ['repo'], useTsconfig: false } }, strict: false },
  ['typescript'], { log: () => {}, probeHandshake: false });
  const provider = missing.providers.find(entry => entry.id === 'typescript');
  assert.ok(provider.checks.some(check => check.name === 'typescript' && /not found/.test(check.message)));
  assert.ok(!provider.checks.some(check => check.name === 'typescript-compatibility'));
} finally {
  clearTypeScriptModuleCache();
  if (priorTrust === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  else process.env.PAIROFCLEATS_TRUSTED_REPOS = priorTrust;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('TypeScript doctor, trusted loaders and compiler host/preflight share version/capability admission and preserve missing-tool/source identity distinctions.');
