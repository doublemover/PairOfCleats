// UNVALIDATED inventory regression; native activation belongs to bootstrap and
// the existing Lua parser/chunking fixtures, not this metadata-only check.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import semver from 'semver';
import { NATIVE_GRAMMAR_MODULES, listNativeTreeSitterGrammarModuleNames } from '../../../src/lang/tree-sitter/native-runtime.js';

const read = async file => JSON.parse(await fs.readFile(path.join(process.cwd(), file), 'utf8'));
const manifest = await read('package.json'), lock = await read('package-lock.json');
const inventory = await read('docs/tooling/dependency-ownership.json');
assert.equal(inventory.schemaVersion, 1);
assert.equal(new Set(inventory.retiredRoots.map(entry => entry.name)).size, 5);
const root = lock.packages[''];
for (const entry of inventory.retiredRoots) {
  for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(Object.hasOwn(manifest[kind] || {}, entry.name), false, `${entry.name}: retired manifest root`);
    assert.equal(Object.hasOwn(root[kind] || {}, entry.name), false, `${entry.name}: retired lock root`);
  }
  assert.equal(Object.keys(manifest.allowScripts || {}).some(key => key === entry.name || key.startsWith(`${entry.name}@`)), false,
    `${entry.name}: no stale install-script permission`);
  assert.ok(entry.reason && entry.owner, 'every retirement retains positive ownership evidence');
}
const lua = NATIVE_GRAMMAR_MODULES.lua.moduleName;
assert.equal(lua, '@tree-sitter-grammars/tree-sitter-lua');
assert.equal(manifest.dependencies[lua], lock.packages[`node_modules/${lua}`].version);
const native = listNativeTreeSitterGrammarModuleNames();
assert.equal(native.includes(lua), true); assert.equal(native.includes('tree-sitter-lua'), false);
assert.equal(native.filter(name => name.endsWith('tree-sitter-lua')).length, 1, 'one selected Lua package feeds native bootstrap');
const lancedb = lock.packages['node_modules/@lancedb/lancedb'];
const arrow = lock.packages['node_modules/apache-arrow'];
assert.ok(manifest.dependencies['apache-arrow']);
assert.ok(semver.satisfies(arrow.version, lancedb.peerDependencies['apache-arrow']), 'preserve the actual LanceDB peer provision');
for (const owner of ['@es-joy/jsdoccomment', 'eslint']) {
  assert.ok(lock.packages[`node_modules/${owner}`].dependencies.esquery, `${owner} retains its real query consumer`);
}
assert.ok(lock.packages['node_modules/esquery']);
const nanUsers = Object.entries(lock.packages).filter(([, pkg]) => pkg.dependencies?.nan);
assert.ok(nanUsers.some(([name]) => name === 'node_modules/re2'));
assert.ok(lock.packages['node_modules/nan'], 'removing the obsolete Lua edge cannot manually remove a shared NAN requirement');
console.log('Retired dependency roots remain absent; actual CLI/native/peer/transitive ownership is preserved.');
