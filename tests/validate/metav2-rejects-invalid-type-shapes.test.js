#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../src/index/validate.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'metav2-invalid-type-shapes');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const chunkMeta = [
  {
    id: 0,
    file: 'src/a.js',
    start: 0,
    end: 1,
    metaV2: {
      chunkId: 'c1',
      file: 'src/a.js',
      types: {
        inferred: {
          params: [{ type: 'BadShape' }]
        },
        tooling: {
          returns: [{ source: 'tooling' }]
        }
      }
    }
  }
];

const { repoRoot, indexRoot } = await createBaseIndex({ rootDir: tempRoot, chunkMeta });

const report = await validateIndexArtifacts({
  root: repoRoot,
  indexRoot,
  modes: ['code'],
  userConfig: defaultUserConfig,
  strict: true,
  sqliteEnabled: false,
  lmdbEnabled: false
});

assert.ok(!report.ok, 'expected metaV2 type shape validation to fail');
assert.ok(
  report.issues.some((issue) => issue.includes('metaV2.types')),
  `expected metaV2.types issue, got: ${report.issues.join('; ')}`
);

console.log('metaV2 invalid type shapes test passed');
