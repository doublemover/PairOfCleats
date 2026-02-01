#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-validate-unknown-piece');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });
await fs.writeFile(path.join(indexDir, 'mystery.json'), JSON.stringify({ ok: true }));

const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
manifest.pieces.push({ type: 'misc', name: 'mystery_artifact', format: 'json', path: 'mystery.json' });
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

assert.ok(!report.ok, 'expected unknown piece to fail strict validation');
assert.ok(
  report.issues.some((issue) => issue.includes('unknown artifact name')),
  `expected unknown artifact name issue, got: ${report.issues.join('; ')}`
);

console.log('index-validate unknown piece test passed');
