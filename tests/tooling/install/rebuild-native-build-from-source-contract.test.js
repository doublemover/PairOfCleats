#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inspectNativeBuildAdapter } from '../../../tools/setup/native-build-plan.js';

const root = process.cwd();
const source = fs.readFileSync(path.join(root, 'tools/setup/rebuild-native.js'), 'utf8');
assert.match(source, /env\.npm_config_build_from_source\s*=\s*'true';/,
  'source recovery must retain the explicit build request');
assert.match(source, /rebuildPatchedPerlFromSource[\s\S]*?node-gyp', 'bin', 'node-gyp\.js'\), 'rebuild'[\s\S]*?cwd:\s*resolveNodeModulesPath\(TREE_SITTER_PERL_PACKAGE\)/,
  'patched Perl must compile directly without the npm legacy-config warning');
assert.match(source, /return rebuildPatchedPerlFromSource\(options\)/,
  'serial fallback must retain patched Perl source ownership');
assert.match(source, /spawnResolvedSubprocess\(command, args,/,
  'async commands must retain the shared Windows shim, cancellation and tree owner');
assert.match(source, /runNativeCommand\('npm', args, options\)/,
  'exclusive npm commands must use that same subprocess owner');
assert.match(source, /rebuildSqliteNativeFromSourceAsync\(root,[\s\S]*?runNpmCommand\(args, \{ \.\.\.options, \.\.\.sqliteOptions \}\)/,
  'SQLite v13 must await its exclusive build and preserve the validated promotion/rollback owner');
assert.match(source, /await probeNativePackage\(request\.root, request\.pkgName,/,
  'isolated probes must still use the shared real activation/disposal owner');
assert.match(fs.readFileSync(path.join(root, 'src/shared/native-package-probe.js'), 'utf8'),
  /if \(pkgName === 'better-sqlite3'\) return probeSqliteNative\(root\);/,
  'SQLite verification must perform a database operation');
assert.match(source, /cwd:\s*resolveNodeModulesPath\(packageNameResult\.pkgName\),\s*buildFromSource/,
  'last-resort package install must retain its package directory/source request');

for (const name of ['tree-sitter', 'tree-sitter-swift']) {
  const adapter = inspectNativeBuildAdapter(root, name);
  assert.ok(adapter, 'reviewed patched binding must retain an admitted local adapter: ' + name);
  assert.equal(adapter.forceSource, true, 'a prebuild must not bypass native source patches');
  assert.deepEqual(adapter.outputs, [path.join(root, 'node_modules', ...name.split('/'), 'build')]);
}
// The locked Perl binding resolves node-addon-api 7.1.1, outside the reviewed
// helper hashes. Its existing serial fallback above still forces patched source.
assert.equal(inspectNativeBuildAdapter(root, '@ganezdragon/tree-sitter-perl'), null,
  'an unreviewed helper graph must retain the source-forced serial fallback');
assert.equal(inspectNativeBuildAdapter(root, 'better-sqlite3'), null, 'SQLite uses its exclusive transaction');
assert.equal(inspectNativeBuildAdapter(root, '@derekstride/tree-sitter-sql'), null,
  'grammar generation/npm fetching must remain on the serial fallback');
console.log('rebuild native build-from-source contract test passed');
