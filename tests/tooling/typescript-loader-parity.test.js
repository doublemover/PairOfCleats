#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { clearTypeScriptModuleCache, loadTypeScript, loadTypeScriptModule } from '../../src/index/tooling/typescript/load.js';

const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ts-loader-'));
const tsRoot = path.join(tmpRoot, 'node_modules', 'typescript');
const tsLibDir = path.join(tsRoot, 'lib');
await fsPromises.mkdir(tsLibDir, { recursive: true });

await fsPromises.writeFile(path.join(tsRoot, 'package.json'), JSON.stringify({ name: 'typescript', version: '0.0.0-test', main: './lib/typescript.js' }), 'utf8');
await fsPromises.writeFile(path.join(tsRoot, 'index.js'), 'module.exports = require("./lib/typescript.js");\n', 'utf8');
await fsPromises.writeFile(
  path.join(tsLibDir, 'typescript.js'),
  `module.exports = { ...require(${JSON.stringify(createRequire(import.meta.url).resolve('typescript'))}), marker: "repo" };\n`,
  'utf8'
);

const priorTrusted = process.env.PAIROFCLEATS_TRUSTED_REPOS;
try {
  delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  assert.equal(await loadTypeScript({ typescript: { resolveOrder: ['repo'] } }, tmpRoot), null,
    'untrusted repository compiler is never executed');
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([tmpRoot]);
  const asyncLoaded = await loadTypeScript({ typescript: { resolveOrder: ['repo'] } }, tmpRoot);
  assert.equal(asyncLoaded?.marker, 'repo');

  clearTypeScriptModuleCache(tmpRoot);
  const syncLoaded = loadTypeScriptModule(tmpRoot);
  assert.equal(syncLoaded?.marker, 'repo');

  const syncLoadedCached = loadTypeScriptModule(tmpRoot);
  assert.equal(syncLoadedCached, syncLoaded, 'sync loader should cache per root key');

  const disabled = await loadTypeScript({ typescript: { enabled: false } }, tmpRoot);
  assert.equal(disabled, null);

} finally {
  if (priorTrusted === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  else process.env.PAIROFCLEATS_TRUSTED_REPOS = priorTrusted;
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
}

console.log('typescript loader parity test passed');
