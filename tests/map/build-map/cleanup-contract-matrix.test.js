#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildCodeMap } from '../../../src/map/build-map.js';
import { createSpillSorter } from '../../../src/map/build-map/io.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const cases = [
  {
    name: 'spill cleanup retries transient rm failures',
    async run() {
      const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-map-spill-cleanup-'));
      const sorter = createSpillSorter({
        label: 'spill',
        compare: (left, right) => left.id - right.id,
        maxInMemory: 1,
        tempDir: tempRoot
      });

      await sorter.push({ id: 2 });
      await sorter.push({ id: 1 });
      const finalized = await sorter.finalize();
      assert.equal(finalized.spilled, true);
      assert.ok(Array.isArray(finalized.runs) && finalized.runs.length >= 2);

      const originalRm = fsPromises.rm;
      const attemptsByPath = new Map();
      fsPromises.rm = async (targetPath, options) => {
        const key = String(targetPath);
        const attempts = (attemptsByPath.get(key) || 0) + 1;
        attemptsByPath.set(key, attempts);
        if (attempts === 1) {
          const error = new Error('transient descriptor pressure');
          error.code = 'EMFILE';
          throw error;
        }
        return originalRm(targetPath, options);
      };

      try {
        await sorter.cleanup();
      } finally {
        fsPromises.rm = originalRm;
      }

      for (const runPath of finalized.runs) {
        assert.equal(fs.existsSync(runPath), false, `expected spill run cleanup: ${runPath}`);
        assert.ok((attemptsByPath.get(String(runPath)) || 0) >= 2);
      }

      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  },
  {
    name: 'forced temp directories are cleaned up after build failures',
    async run() {
      const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-map-temp-cleanup-'));
      applyTestEnv({ cacheRoot: tempRoot });

      const repoRoot = path.join(tempRoot, 'repo');
      const indexDir = path.join(tempRoot, 'index');
      await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
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

      assert.equal(fs.existsSync(forcedTempDir), false);
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('build-map cleanup contract matrix test passed');
