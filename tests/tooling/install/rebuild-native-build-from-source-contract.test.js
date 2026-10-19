#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'tools', 'setup', 'rebuild-native.js');
const source = fs.readFileSync(sourcePath, 'utf8');

assert.match(
  source,
  /const\s+buildNpmEnv\s*=\s*\(\s*\{\s*buildFromSource\s*=\s*false\s*\}\s*=\s*\{\}\s*\)\s*=>/,
  'expected buildNpmEnv to accept buildFromSource'
);
assert.match(
  source,
  /env\.npm_config_build_from_source\s*=\s*'true';/,
  'other source-recovery paths still pass their explicit build request'
);

assert.match(source,
  /const\s+rebuildPatchedPerlFromSource\s*=\s*\(\)\s*=>[\s\S]*?node-gyp', 'bin', 'node-gyp\.js'\), 'rebuild'[\s\S]*?cwd:\s*resolveNodeModulesPath\(TREE_SITTER_PERL_PACKAGE\)/,
  'patched Perl scanner must compile from source without npm 11 unknown-config warnings');
assert.match(source,
  /packageNameResult\.pkgName === TREE_SITTER_PERL_PACKAGE && buildFromSource\)[\s\S]*?return rebuildPatchedPerlFromSource\(\);/,
  'Perl source rebuild must use the direct node-gyp owner');

assert.match(
  source,
  /const\s+runNpmCommand\s*=\s*\(\s*args,\s*\{\s*cwd\s*=\s*root,\s*buildFromSource\s*=\s*false\s*\}\s*=\s*\{\}\s*\)\s*=>/,
  'expected npm subprocess execution to flow through a shared local helper'
);
assert.match(
  source,
  /const\s+normalizePackageNameResult\s*=\s*\(\s*pkgName\s*\)\s*=>/,
  'expected package name validation to flow through a shared local helper'
);
assert.match(
  source,
  /spawnResolvedSubprocessSync\(\s*'npm',\s*args,/,
  'expected npm subprocess execution to use shared Windows command-shim resolution'
);
assert.match(
  source,
  /runNpmCommand\(args,\s*\{\s*buildFromSource\s*\}\)/,
  'expected rebuild path to pass buildFromSource into npm command helper'
);
assert.match(
  source,
  /pkgName === 'better-sqlite3' && buildFromSource[\s\S]*?>= 13\)[\s\S]*?rebuildSqliteNativeFromSource\(root, runNpmCommand\)/,
  'SQLite v13 source recovery must use its explicit build-release policy'
);
assert.match(
  source,
  /await probeNativePackage\(root, pkgName,/,
  'verification must use the shared native activation owner'
);
assert.match(
  fs.readFileSync(path.join(root, 'src/shared/native-package-probe.js'), 'utf8'),
  /if \(pkgName === 'better-sqlite3'\) return probeSqliteNative\(root\);/,
  'SQLite verify and repair must probe the database rather than just importing the module'
);
assert.match(
  source,
  /runNpmCommand\(args,\s*\{\s*[\s\S]*cwd:\s*resolveNodeModulesPath\(packageNameResult\.pkgName\),\s*[\s\S]*buildFromSource\s*[\s\S]*\}\)/,
  'expected install-script path to pass buildFromSource into npm command helper'
);

console.log('rebuild native build-from-source contract test passed');
