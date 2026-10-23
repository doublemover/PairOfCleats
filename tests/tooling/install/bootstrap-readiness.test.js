#!/usr/bin/env node
import { runNode as runNodeFixture } from '../../helpers/run-node.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { BOOTSTRAP_RECEIPT, inspectBootstrapReadiness, recordBootstrapReadiness } from '../../../src/shared/bootstrap-readiness.js';

// Intentionally dependency-free: this diagnostic must run in an unbootstrapped
// checkout and tests executable gates without starting a real benchmark/index.
const sourceRoot = process.cwd(), root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-bootstrap-readiness-'));
const write = (relative, text) => {
  const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const required = ['better-sqlite3', 'tree-sitter', 'tree-sitter-javascript'];
const inputs = ['.nvmrc', 'tools/setup/checkout-diagnose.js', 'tools/setup/preflight.js', 'src/shared/direct-execution.js', 'tools/setup/apply-patches.js', 'tools/setup/rebuild-native.js',
  'tools/setup/rebuild-native-sqlite.js', 'tools/setup/readiness.js', 'src/shared/native-package-probe.js',
  'tools/setup/bootstrap-tasks.js', 'tools/setup/native-build-plan.js',
  'tools/setup/windows-capability.js',
  'src/shared/bootstrap-readiness.js', 'src/lang/tree-sitter/native-runtime.js',
  'src/lang/tree-sitter/native-grammar-binding.js',
  'tools/setup/rebuild-native-exit.js'];
const entries = ['bin/pairofcleats.js', 'tests/run.js', 'tools/bench/bench-runner.js', 'tools/bench/micro/hash.js'];
entries.push('tools/analysis/graph-evidence.js');
// Every guarded cache-path consumer must reject an incomplete checkout before
// linking even its lightweight repository helpers.
entries.push('tools/ci/run-suite.js');
entries.push('tools/build/embeddings.js');
for (const directory of ['tools/bench/index', 'tools/bench/sqlite']) {
  for (const name of fs.readdirSync(path.join(sourceRoot, directory)).sort()) {
    if (!name.endsWith('.js')) continue;
    const entry = `${directory}/${name}`;
    if (fs.readFileSync(path.join(sourceRoot, entry), 'utf8').includes('await guardBootstrapEntry(import.meta.url);')) {
      entries.push(entry);
    }
  }
}
const execute = (entry, args = entry === 'bin/pairofcleats.js' ? ['search', 'fixture'] : []) => runNodeFixture([path.join(root, entry), ...args], 'Node process fixture', process.cwd(), process.env, { stdio: 'pipe', encoding: 'buffer', allowFailure: true, spawnOptions: {
  cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 65536
} });
try {
  write('package.json', JSON.stringify({ type: 'module', version: '1.2.3', dependencies: Object.fromEntries(required.map(name => [name, '1.0.0'])) }));
  write('package-lock.json', '{}');
  for (const relative of inputs) write(relative, fs.readFileSync(path.join(sourceRoot, relative), 'utf8'));
  for (const entry of entries) write(entry, fs.readFileSync(path.join(sourceRoot, entry), 'utf8'));
  const information = execute('bin/pairofcleats.js', ['--version']);
  assert.equal(information.status, 0);
  assert.equal(information.stderr.trim(), '1.2.3', 'dependency-free information remains available without admitting a workload');
  assert.equal(information.stdout, '');
  // Exercise the actual imported qualification API against this unprepared
  // installation. Only its inert dependencies point to the prepared checkout;
  // the copied bootstrap owner keeps this fixture's real installation root.
  const qualification = fs.readFileSync(path.join(sourceRoot, 'tools/ci/qualify-lsp-runtime.js'), 'utf8')
    .replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g, (match, quote, specifier) =>
      specifier === '../../src/shared/bootstrap-readiness.js' ? match
        : `from ${quote}${pathToFileURL(path.resolve(sourceRoot, 'tools/ci', specifier)).href}${quote}`);
  write('tools/ci/qualify-lsp-runtime.js', qualification);
  write('invoke-qualification.js', `import {qualifyInstalledLspRuntime} from './tools/ci/qualify-lsp-runtime.js';
    await qualifyInstalledLspRuntime({providerId:'must-not-reach-recipe-admission'});`);
  const library = execute('invoke-qualification.js');
  assert.equal(library.status, 1);
  assert.match(library.stderr, /BOOTSTRAP REQUIRED/, 'imported qualification must enforce readiness before workload admission');
  assert.doesNotMatch(library.stderr, /Unknown internal LSP qualification recipe|ERR_MODULE_NOT_FOUND/);
  assert.equal(library.stdout, '');
  for (const entry of entries) {
    const result = execute(entry);
    assert.equal(result.status, 1, entry);
    assert.match(result.stderr, /BOOTSTRAP REQUIRED/);
    assert.match(result.stderr, /npm run bootstrap:ci/);
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
  const parser = 'module.exports = class { setLanguage(){} reset(){} parse(){return {rootNode:{}}} };';
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
  const preflight = fs.readFileSync(path.join(root, 'tools/setup/preflight.js'), 'utf8');
  write('tools/setup/preflight.js', `${preflight}\n// changed prerequisite policy\n`);
  assert.equal((await inspectBootstrapReadiness({ root })).ready, false, 'changed prerequisite policy invalidates setup evidence');
  write('tools/setup/preflight.js', preflight);
  record();
  const capability = fs.readFileSync(path.join(root, 'tools/setup/windows-capability.js'), 'utf8');
  write('tools/setup/windows-capability.js', `${capability}\n// changed selected compiler capability policy\n`);
  assert.equal((await inspectBootstrapReadiness({ root })).ready, false,
    'changing the actual Windows capability owner invalidates prior bootstrap evidence');
  write('tools/setup/windows-capability.js', capability);
  record();
  const directExecution = fs.readFileSync(path.join(root, 'src/shared/direct-execution.js'), 'utf8');
  write('src/shared/direct-execution.js', `${directExecution}\n// changed entry detection policy\n`);
  assert.equal((await inspectBootstrapReadiness({ root })).ready, false, 'changed entry detection invalidates setup evidence');
  write('src/shared/direct-execution.js', directExecution);
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
  const staleAbi = await inspectBootstrapReadiness({ root });
  assert.equal(staleAbi.ready, false);
  assert.ok(staleAbi.mismatches.some(row => row.field === 'runtime.abi' && row.observed === 'stale'
    && row.expected === process.versions.modules), 'the exact structured ABI mismatch rejects admission');
  console.log('Bootstrap readiness: absent, incomplete, stale, native activation and CLI/test/bench admission passed');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
