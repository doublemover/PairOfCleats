#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildCodeMap } from '../../../src/map/build-map.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-map-temp-cleanup-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
const indexDir = path.join(tempRoot, 'index');
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(indexDir, { recursive: true });
await fsPromises.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fsPromises.writeFile(path.join(repoRoot, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
await fsPromises.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
  pieces: [
    {
      name: 'repo_map',
      path: 'repo_map.json',
      format: 'json'
    }
  ]
}, null, 2));
await fsPromises.writeFile(path.join(indexDir, 'repo_map.json'), JSON.stringify([
  {
    file: 'src/a.js',
    name: 'alpha',
    kind: 'function',
    signature: 'alpha()',
    startLine: 1,
    endLine: 1,
    exported: true
  }
], null, 2));

const forcedTempDir = path.join(tempRoot, 'forced-map-temp-dir');
const originalMkdtemp = fsPromises.mkdtemp;
fsPromises.mkdtemp = async () => {
  await fsPromises.mkdir(forcedTempDir, { recursive: true });
  return forcedTempDir;
};

try {
  await assert.rejects(
    () => buildCodeMap({
      repoRoot,
      indexDir,
      options: {
        maxNodeBytes: 1
      }
    }),
    /Map build guardrail hit for nodes/i
  );
} finally {
  fsPromises.mkdtemp = originalMkdtemp;
}

assert.equal(fs.existsSync(forcedTempDir), false, 'expected temp directory cleanup after failure');
await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('map build temp cleanup on failure test passed');
