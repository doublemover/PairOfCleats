#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { clearTypeScriptModuleCache, loadTypeScript, loadTypeScriptModule } from '../../src/index/tooling/typescript/load.js';

const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'ts-loader-'));
const tsRoot = path.join(tmpRoot, 'node_modules', 'typescript');
const tsLibDir = path.join(tsRoot, 'lib');
await fsPromises.mkdir(tsLibDir, { recursive: true });

await fsPromises.writeFile(path.join(tsRoot, 'package.json'), JSON.stringify({ name: 'typescript', version: '0.0.0-test' }), 'utf8');
await fsPromises.writeFile(path.join(tsRoot, 'index.js'), 'module.exports = require("./lib/typescript.js");\n', 'utf8');
await fsPromises.writeFile(
  path.join(tsLibDir, 'typescript.js'),
  'module.exports = { version: "0.0.0-test", marker: "repo" };\n',
  'utf8'
);

const asyncLoaded = await loadTypeScript({ typescript: { resolveOrder: ['repo'] } }, tmpRoot);
assert.equal(asyncLoaded?.marker, 'repo');

clearTypeScriptModuleCache(tmpRoot);
const syncLoaded = loadTypeScriptModule(tmpRoot);
assert.equal(syncLoaded?.marker, 'repo');

const syncLoadedCached = loadTypeScriptModule(tmpRoot);
assert.equal(syncLoadedCached, syncLoaded, 'sync loader should cache per root key');

const disabled = await loadTypeScript({ typescript: { enabled: false } }, tmpRoot);
assert.equal(disabled, null);

await fsPromises.rm(tmpRoot, { recursive: true, force: true });

console.log('typescript loader parity test passed');
