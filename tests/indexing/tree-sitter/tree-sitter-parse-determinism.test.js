#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildTreeSitterChunks,
  initTreeSitterWasm,
  preloadTreeSitterLanguages,
  resetTreeSitterParser,
  resetTreeSitterStats,
  shutdownTreeSitterWorkerPool
} from '../../../src/lang/tree-sitter.js';
import { getTreeSitterWorkerPool } from '../../../src/lang/tree-sitter/worker.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const timeout = setTimeout(() => {
  console.error('tree-sitter parse determinism test timed out');
  process.exit(1);
}, 20000);

const root = process.cwd();
const fixturePath = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');
const text = await fs.readFile(fixturePath, 'utf8');

const log = () => {};

try {
  resetTreeSitterStats();
  resetTreeSitterParser({ hard: true });

  const ok = await initTreeSitterWasm({ log });
  if (!ok) {
    console.log('tree-sitter wasm unavailable; skipping parse determinism test.');
    process.exit(0);
  }

  const languageId = 'javascript';
  const ext = '.js';
  const maxLoadedLanguages = 2;

  await preloadTreeSitterLanguages([languageId], { log, parallel: false, maxLoadedLanguages });

  const options = {
    log,
    treeSitter: {
      enabled: true,
      useQueries: true,
      chunkCache: false,
      maxLoadedLanguages
    }
  };

  const first = buildTreeSitterChunks({ text, languageId, ext, options });
  assert.ok(Array.isArray(first) && first.length > 0, 'expected tree-sitter chunks');

  const second = buildTreeSitterChunks({ text, languageId, ext, options });
  assert.deepStrictEqual(second, first, 'expected deterministic chunks across runs (main thread)');

  const pool = await getTreeSitterWorkerPool(
    { enabled: true, maxWorkers: 1, idleTimeoutMs: 5000, taskTimeoutMs: 60000 },
    { log }
  );

  if (!pool) {
    console.log('tree-sitter worker pool unavailable; skipping worker determinism check.');
    console.log('tree-sitter parse determinism test passed');
  } else {
    const workerResult = await pool.run(
      {
        text,
        languageId,
        ext,
        treeSitter: {
          enabled: true,
          useQueries: true,
          chunkCache: false,
          maxLoadedLanguages
        }
      },
      { name: 'parseTreeSitter' }
    );

    assert.deepStrictEqual(workerResult, first, 'expected worker chunks to match main thread output');
    console.log('tree-sitter parse determinism test passed');
  }
} finally {
  clearTimeout(timeout);
  await shutdownTreeSitterWorkerPool();
}
