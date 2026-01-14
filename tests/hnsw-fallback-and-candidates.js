#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadHnswIndex, rankHnswIndex } from '../src/shared/hnsw.js';

{
  // loadHnswIndex should fall back to .bak when the primary exists but is unreadable.
  const tmp = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-hnsw-fallback-'));
  const primary = path.join(tmp, 'dense_vectors_hnsw.bin');
  const bak = `${primary}.bak`;
  await fsPromises.writeFile(primary, 'corrupt');
  await fsPromises.writeFile(bak, 'ok');

  const readAttempts = [];
  class FakeHNSW {
    constructor(space, dims) {
      this.space = space;
      this.dims = dims;
      this.ef = 0;
    }
    readIndexSync(p) {
      readAttempts.push(p);
      if (p === primary) {
        throw new Error('corrupt index');
      }
      return true;
    }
    setEf(ef) {
      this.ef = ef;
    }
  }

  const index = loadHnswIndex({
    indexPath: primary,
    dims: 2,
    config: { enabled: true, efSearch: 17, space: 'cosine' },
    lib: { HierarchicalNSW: FakeHNSW }
  });

  assert.ok(index, 'expected fallback index to load');
  assert.deepEqual(readAttempts, [primary, bak], 'expected to try primary then .bak');
  assert.equal(index.ef, 17, 'expected efSearch to be applied on loaded index');
  assert.equal(fs.existsSync(bak), true, 'expected .bak to be preserved when used as fallback');
}

{
  // rankHnswIndex should treat an empty candidateSet as "no candidates".
  const calls = [];
  const fakeIndex = {
    searchKnn: (vec, limit, filter) => {
      calls.push({ vec, limit, filter });
      return { neighbors: [1], distances: [0.25] };
    }
  };

  const empty = rankHnswIndex({ index: fakeIndex, space: 'cosine' }, new Float32Array([1, 0]), 5, new Set());
  assert.deepEqual(empty, [], 'expected empty candidate set to yield no results');
  assert.equal(calls.length, 0, 'expected searchKnn to be skipped for empty candidate set');

  const nonEmpty = rankHnswIndex({ index: fakeIndex, space: 'cosine' }, new Float32Array([1, 0]), 5, new Set([1]));
  assert.equal(calls.length, 1, 'expected searchKnn to be invoked');
  assert.equal(Array.isArray(calls[0].vec), true, 'expected query embedding to be coerced to an Array');
  assert.equal(typeof calls[0].filter, 'function', 'expected candidate filter to be passed to searchKnn');
  assert.equal(nonEmpty.length, 1, 'expected a single neighbor');
}

console.log('hnsw fallback + candidate-set semantics test passed');
