#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';
import { updatePiecesManifest } from '../../helpers/pieces-manifest.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-validate-unknown-artifact');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });
await fs.writeFile(path.join(indexDir, 'mystery.json'), JSON.stringify({ ok: true }));

await updatePiecesManifest(indexDir, (manifest) => {
  manifest.pieces.push({ type: 'misc', name: 'mystery_artifact', format: 'json', path: 'mystery.json' });
});

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(!report.ok, 'expected unknown artifact to fail strict validation');
assert.ok(
  report.issues.some((issue) => issue.includes('unknown artifact name')),
  `expected unknown artifact issue, got: ${report.issues.join('; ')}`
);

console.log('index-validate unknown artifact test passed');

