#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { INDEX_SIGNATURE_TTL_MS, buildIndexSignature, loadIndexWithCache } from '../../../src/retrieval/index-cache.js';
import { getIndexSignature } from '../../../src/retrieval/cli-index.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const cases = [
  {
    name: 'loadIndexWithCache reuses entries until signature or generation changes',
    async run() {
      const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-index-cache-'));
      try {
        const indexDir = path.join(tempRoot, 'index');
        await fs.mkdir(indexDir, { recursive: true });
        const writeMeta = async (value) => {
          await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(value));
        };

        const cache = new Map();
        let loads = 0;
        const loader = () => ({ loaded: ++loads });

        await writeMeta([{ id: 1 }]);
        const first = await loadIndexWithCache(cache, indexDir, { modelIdDefault: 'm', fileChargramN: 3 }, loader);
        const second = await loadIndexWithCache(cache, indexDir, { modelIdDefault: 'm', fileChargramN: 3 }, loader);
        assert.equal(loads, 1);
        assert.equal(first.loaded, second.loaded);

        const chunkMetaModeCache = new Map();
        let chunkMetaModeLoads = 0;
        const chunkMetaModeLoader = () => ({ loaded: ++chunkMetaModeLoads });
        await loadIndexWithCache(
          chunkMetaModeCache,
          indexDir,
          { modelIdDefault: 'm', fileChargramN: 3, includeChunkMetaCold: false },
          chunkMetaModeLoader
        );
        await loadIndexWithCache(
          chunkMetaModeCache,
          indexDir,
          { modelIdDefault: 'm', fileChargramN: 3, includeChunkMetaCold: false },
          chunkMetaModeLoader
        );
        await loadIndexWithCache(
          chunkMetaModeCache,
          indexDir,
          { modelIdDefault: 'm', fileChargramN: 3, includeChunkMetaCold: true },
          chunkMetaModeLoader
        );
        assert.equal(chunkMetaModeLoads, 2);

        const generationScopedCache = new Map();
        let generationScopedLoads = 0;
        const generationScopedLoader = () => ({ loaded: ++generationScopedLoads });
        await loadIndexWithCache(
          generationScopedCache,
          indexDir,
          {
            modelIdDefault: 'm',
            fileChargramN: 3,
            generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' }
          },
          generationScopedLoader
        );
        await loadIndexWithCache(
          generationScopedCache,
          indexDir,
          {
            modelIdDefault: 'm',
            fileChargramN: 3,
            generationTag: { mode: 'code', buildId: 'build-a', buildGenerationKey: 'gen-a' }
          },
          generationScopedLoader
        );
        await loadIndexWithCache(
          generationScopedCache,
          indexDir,
          {
            modelIdDefault: 'm',
            fileChargramN: 3,
            generationTag: { mode: 'code', buildId: 'build-b', buildGenerationKey: 'gen-b' }
          },
          generationScopedLoader
        );
        assert.equal(generationScopedLoads, 2);

        await writeMeta([{ id: 2 }]);
        const originalNow = Date.now;
        let now = originalNow();
        try {
          Date.now = () => now;
          now += INDEX_SIGNATURE_TTL_MS + 1;
          const third = await loadIndexWithCache(cache, indexDir, { modelIdDefault: 'm', fileChargramN: 3 }, loader);
          assert.equal(loads, 2);
          assert.notEqual(third.loaded, first.loaded);
        } finally {
          Date.now = originalNow;
        }
      } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'index signature cache evicts oldest entries beyond the 256-entry cap',
    async run() {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-index-signature-cache-'));
      const dirs = [];
      try {
        for (let index = 0; index < 257; index += 1) {
          const dir = path.join(root, `idx-${index}`);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(
            path.join(dir, 'index_state.json'),
            JSON.stringify({ buildId: `build-${index}`, mode: 'code', artifactSurfaceVersion: '1' }),
            'utf8'
          );
          dirs.push(dir);
        }

        for (const dir of dirs) {
          await buildIndexSignature(dir);
        }

        const originalReadFile = fs.readFile;
        let readCount = 0;
        fs.readFile = async (...args) => {
          readCount += 1;
          return originalReadFile(...args);
        };
        try {
          await buildIndexSignature(dirs[0]);
        } finally {
          fs.readFile = originalReadFile;
        }
        assert.ok(readCount > 0);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'cli index signatures include sharded chunk meta manifests and part hashes',
    async run() {
      const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-chunk-meta-sig-'));
      try {
        const codeDir = path.join(rootDir, 'index-code');
        const partsDir = path.join(codeDir, 'chunk_meta.parts');
        await fs.mkdir(partsDir, { recursive: true });

        await fs.writeFile(
          path.join(partsDir, 'chunk_meta.part-0000.jsonl'),
          `${JSON.stringify({ id: 0, file: 'src/a.js', start: 0, end: 1 })}\n`
        );
        await fs.writeFile(path.join(codeDir, 'chunk_meta.meta.json'), JSON.stringify({
          schemaVersion: '0.0.1',
          artifact: 'chunk_meta',
          format: 'jsonl-sharded',
          generatedAt: new Date().toISOString(),
          compression: 'none',
          totalRecords: 1,
          totalBytes: 1,
          maxPartRecords: 1,
          maxPartBytes: 1,
          targetMaxBytes: 1,
          parts: [{ path: 'chunk_meta.parts/chunk_meta.part-0000.jsonl', records: 1, bytes: 1 }]
        }, null, 2));

        const signature = await getIndexSignature({
          useSqlite: false,
          backendLabel: 'memory',
          sqliteCodePath: null,
          sqliteProsePath: null,
          runRecords: false,
          runExtractedProse: false,
          includeExtractedProse: false,
          root: rootDir,
          userConfig: {}
        });

        assert.equal(signature.modes?.code?.includes('chunk_meta.meta.json:'), true);
        assert.equal(signature.modes?.code?.includes('|parts:'), true);
      } finally {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('index cache contract matrix test passed');
