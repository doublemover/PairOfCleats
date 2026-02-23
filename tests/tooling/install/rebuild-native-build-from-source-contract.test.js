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

const buildFromSourceCallMatches = source.match(/buildNpmEnv\(\{\s*buildFromSource\s*\}\)/g) || [];
assert.ok(
  buildFromSourceCallMatches.length >= 2,
  'expected rebuild and install-script paths to pass buildFromSource into buildNpmEnv'
);

console.log('rebuild native build-from-source contract test passed');
