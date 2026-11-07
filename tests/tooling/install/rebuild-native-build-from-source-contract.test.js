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
assert.match(source, /const result = await runNativeSetupCommand\(command, args,/,
  'async commands must reach the current original-settlement projection');
assert.match(source, /return checkCompletedInputs\(result\);/,
  'completed command evidence must remain bound to the original captured setup inputs');
assert.match(fs.readFileSync(path.join(root, 'tools/setup/native-command-result.js'), 'utf8'), /spawn = spawnResolvedSubprocess/,
  'the extracted command projection retains the shared Windows shim, cancellation and tree owner');
assert.match(source, /runNativeCommand\('npm', args, options\)/,
  'exclusive npm commands must use that same subprocess owner');
assert.match(source, /rebuildSqliteNativeFromSource\(root,[\s\S]*?runNpmCommand\(args, \{ \.\.\.options, \.\.\.sqliteOptions \}\)/,
  'SQLite v13 must await its exclusive build and preserve the validated promotion/rollback owner');
assert.match(source, /await probeNativePackage\(root, pkgName, \{ grammarRoutes, signal,[\s\S]*?runLoggedProbe\(command, args, options, observeOutput\)/,
  'actual probe commands must use the shared real activation/disposal owner and original log/cancellation capability');
assert.match(fs.readFileSync(path.join(root, 'src/shared/native-package-probe.js'), 'utf8'),
  /if \(pkgName === 'better-sqlite3'\) return probeSqliteNative\(root, null, options\);/,
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
assert.match(source, /process\.platform === 'win32' && packageNameResult\.pkgName === 'node-pty'[\s\S]*?return rebuildWindowsProcessBindingFromSource\(options\)/,
  'Windows metadata patches cannot be bypassed by an upstream prebuilt binding');
assert.match(source, /rebuildWindowsProcessBindingFromSource[\s\S]*?node-gyp', 'bin', 'node-gyp\.js'\), 'rebuild'[\s\S]*?cwd:\s*resolveNodeModulesPath\('node-pty'\)/,
  'the Windows process binding uses the direct bounded compiler owner without npm legacy flags');

console.log('rebuild native build-from-source contract test passed');
