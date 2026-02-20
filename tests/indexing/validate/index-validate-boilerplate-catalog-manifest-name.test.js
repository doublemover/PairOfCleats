#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { readJsonFile } from '../../../src/shared/artifact-io.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-validate-boilerplate-catalog-manifest-name');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: tempRoot });

const boilerplateCatalogPath = path.join(indexDir, 'boilerplate_catalog.json');
await writeJsonObjectFile(boilerplateCatalogPath, {
  fields: {
    schemaVersion: '1.0.0',
    generatedAt: new Date('2026-02-20T00:00:00.000Z').toISOString(),
    entries: [
      {
        ref: 'license:apache-2.0',
        count: 3,
        positions: { top: 3 },
        tags: ['license'],
        sampleFiles: ['src/foo.js', 'src/bar.js']
      }
    ]
  },
  atomic: true
});

const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
const manifest = readJsonFile(manifestPath) || {};
manifest.pieces.push({
  type: 'stats',
  name: 'boilerplate_catalog',
  format: 'json',
  path: 'boilerplate_catalog.json'
});
await writeJsonObjectFile(manifestPath, { fields: manifest, atomic: true });

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(
  !report.issues.some((issue) => issue.includes('unknown artifact name')),
  `expected boilerplate_catalog name to be accepted, got: ${report.issues.join('; ')}`
);

console.log('index-validate boilerplate catalog manifest name test passed');
