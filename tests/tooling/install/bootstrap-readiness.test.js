#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BOOTSTRAP_RECEIPT, inspectBootstrapReadiness, recordBootstrapReadiness } from '../../../src/shared/bootstrap-readiness.js';

// Intentionally dependency-free: this diagnostic must run in an unbootstrapped
// checkout and tests executable gates without starting a real benchmark/index.
const sourceRoot = process.cwd(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-bootstrap-readiness-'));
const write = (relative, text) => {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const required = ['better-sqlite3', 'tree-sitter', 'tree-sitter-javascript'];
const inputs = ['.nvmrc', 'tools/setup/apply-patches.js', 'tools/setup/rebuild-native.js',
  'tools/setup/rebuild-native-sqlite.js', 'tools/setup/readiness.js', 'src/shared/native-package-probe.js',
  'src/shared/bootstrap-readiness.js', 'src/lang/tree-sitter/native-runtime.js',
  'tools/setup/rebuild-native-exit.js'];
const entries = ['bin/pairofcleats.js', 'tests/run.js', 'tools/bench/bench-runner.js', 'tools/bench/micro/hash.js'];
const execute = entry => spawnSync(process.execPath, [path.join(root, entry)], {
  cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 65536
});
try {
  write('package.json', JSON.stringify({ type: 'module', dependencies: Object.fromEntries(required.map(name => [name, '1.0.0'])) }));
  write('package-lock.json', '{}');
  for (const relative of inputs) write(relative, fs.readFileSync(path.join(sourceRoot, relative), 'utf8'));
  for (const entry of entries) write(entry, fs.readFileSync(path.join(sourceRoot, entry), 'utf8'));
  for (const entry of entries) {
    const result = execute(entry);
    assert.equal(result.status, 1, entry);
    assert.match(result.stderr, /BOOTSTRAP REQUIRED/);
    assert.match(result.stderr, /npm run bootstrap/);
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/, 'gate precedes dependency-heavy module linking');
    assert.equal(result.stdout, '', 'no benchmark/test/normal workload has started');
  }
  assert.equal(fs.existsSync(path.join(root, BOOTSTRAP_RECEIPT)), false, 'entry gates never bootstrap automatically');
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(root, entries[0]), path.join(root, 'linked-cli'));
    const result = execute('linked-cli');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BOOTSTRAP REQUIRED/, 'linked executable cannot bypass readiness');
  }
  write(BOOTSTRAP_RECEIPT, '{}');
  assert.equal((await inspectBootstrapReadiness({ root })).ready, false, 'marker existence is not readiness');
  for (const name of required) write(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', main: 'index.cjs' }));
  const sqlite = 'module.exports = class { prepare(){return {get(){return {ok:1}}}} close(){} };';
  const parser = 'module.exports = class { setLanguage(){} parse(){return {rootNode:{}}} };';
  write('node_modules/better-sqlite3/index.cjs', sqlite);
  write('node_modules/tree-sitter/index.cjs', parser);
  write('node_modules/tree-sitter-javascript/index.cjs', 'module.exports = {};');
  write('node_modules/tree-sitter/fixture.node', 'binary evidence');
  const record = () => recordBootstrapReadiness(root, required);
  record();
  assert.equal((await inspectBootstrapReadiness({ root })).ready, true);
  for (const entry of entries) {
    const text = fs.readFileSync(path.join(root, entry), 'utf8');
    const end = text.indexOf('await guardBootstrapEntry(import.meta.url);') + 'await guardBootstrapEntry(import.meta.url);'.length;
    assert.ok(end > 50, `real entry gate must exist: ${entry}`);
    write(entry, text.slice(0, end) + '\nconsole.log("prepared workload admitted");\n');
    const result = execute(entry);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /prepared workload admitted/);
  }
  write('node_modules/better-sqlite3/index.cjs', 'module.exports = class { constructor(){throw Error("binding unusable")} };');
  assert.match((await inspectBootstrapReadiness({ root })).reason, /binding unusable/, 'actual lazy native activation is checked');
  write('node_modules/better-sqlite3/index.cjs', sqlite);
  write('node_modules/tree-sitter/index.cjs', 'module.exports = class { setLanguage(){} parse(){return null} };');
  assert.match((await inspectBootstrapReadiness({ root })).reason, /tree-sitter/, 'importable but unusable parser is rejected');
  write('node_modules/tree-sitter/index.cjs', parser);
  write('node_modules/tree-sitter/fixture.node', 'changed binary evidence');
  assert.match((await inspectBootstrapReadiness({ root })).reason, /artifact changed/);
  record();
  fs.unlinkSync(path.join(root, 'node_modules/tree-sitter/fixture.node'));
  assert.equal((await inspectBootstrapReadiness({ root })).ready, false, 'missing native artifacts reject the receipt');
  record();
  write('patches/fixture+1.0.0.patch', 'changed required patch');
  assert.match((await inspectBootstrapReadiness({ root })).reason, /patches have changed/);
  fs.unlinkSync(path.join(root, 'patches/fixture+1.0.0.patch'));
  record();
  const receipt = JSON.parse(fs.readFileSync(path.join(root, BOOTSTRAP_RECEIPT), 'utf8'));
  receipt.runtime.abi = 'stale'; write(BOOTSTRAP_RECEIPT, JSON.stringify(receipt));
  assert.match((await inspectBootstrapReadiness({ root })).reason, /native ABI/);
  console.log('Bootstrap readiness: absent, incomplete, stale, native activation and CLI/test/bench admission passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
