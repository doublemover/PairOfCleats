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
  'expected buildNpmEnv to force npm_config_build_from_source when requested'
);

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
  /runNpmCommand\(args,\s*\{\s*[\s\S]*cwd:\s*resolveNodeModulesPath\(packageNameResult\.pkgName\),\s*[\s\S]*buildFromSource\s*[\s\S]*\}\)/,
  'expected install-script path to pass buildFromSource into npm command helper'
);

console.log('rebuild native build-from-source contract test passed');
