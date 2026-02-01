#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-validate-name-collision');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });

const repoMap = [
  { file: 'src/a.js', name: 'dup', kind: 'Function' },
  { file: 'src/a.js', name: 'dup', kind: 'Function' }
];
await fs.writeFile(path.join(indexDir, 'repo_map.json'), JSON.stringify(repoMap, null, 2));

const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.pieces.push({ type: 'chunks', name: 'repo_map', format: 'json', path: 'repo_map.json' });
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(!report.ok, 'expected file::name collision to fail');
assert.ok(
  report.issues.some((issue) => issue.includes('ERR_ID_COLLISION')),
  `expected collision issue, got: ${report.issues.join('; ')}`
);

console.log('index-validate file name collision test passed');

