import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSemanticCacheFixture } from '../../helpers/semantic-cache-fixture.js';
import { createArtifactSemanticStore } from '../../../src/semantic/artifact-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';

const fixture = await createSemanticCacheFixture();
try {
  for (const [file, nodeCount, large] of [['small.js', 2, false], ['large.js', 1024, true]]) {
    const current = await fixture.createFile({ file, nodeCount });
    const root = path.join(fixture.buildRoot, fixture.storage.relativePath);
    const pieces = current.partition.members.semantic_records;
    const piece = large ? pieces.find(candidate => candidate.bytes > 64 * 1024) : pieces[0];
    assert.ok(piece, 'exercise the real large-piece streaming path as well as the small snapshot');
    const filename = await fs.realpath(path.join(root, piece.path));
    const original = await fs.readFile(filename);
    const expected = [];
    for (const member of pieces) {
      const bytes = await fs.readFile(path.join(root, member.path), 'utf8');
      expected.push(...bytes.trim().split('\n').map(line => JSON.parse(line)));
    }
    const changed = original.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    changed.at(-1).span[0] = 1;
    const replacement = Buffer.from(changed.map(canonicalSemanticJson).join('\n') + '\n');
    assert.equal(replacement.length, original.length, 'the injected valid row preserves every byte-size bound');
    const store = createArtifactSemanticStore({ root, repoRoot: fixture.repoRoot,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, generation: fixture.generation,
      partitions: current.factsRef.partitions });
    const collect = async () => {
      const rows = [];
      for await (const row of store.iterateRows(current.partition.partitionId, 'semantic_records')) rows.push(row);
      return rows;
    };
    assert.deepEqual(await collect(), expected);
    const open = fs.open, active = new Set();
    let mutations = 0;
    fs.open = async (...args) => {
      const handle = await open(...args), close = handle.close.bind(handle);
      active.add(handle);
      handle.close = async () => {
        try {
          const result = await close();
          if (String(args[0]) === filename && !mutations) {
            mutations += 1;
            await fs.writeFile(filename, replacement);
          }
          return result;
        } finally { active.delete(handle); }
      };
      return handle;
    };
    try {
      assert.deepEqual(await collect(), expected,
        'streamed rows must come from the exact bytes verified before the owned hash handle closes');
      assert.equal(mutations, 1, 'the real close-to-reopen mutation must run');
      assert.equal(active.size, 0, 'verification and decoding leave no owned handle');
      await assert.rejects(collect(), error => error.code === 'ERR_SEMANTIC_INTEGRITY',
        'the next request must freshly hash and reject the changed bytes');
      assert.equal(active.size, 0);
      if (large) {
        await fs.writeFile(filename, original);
        const iterator = store.iterateRows(current.partition.partitionId, 'semantic_records');
        assert.equal((await iterator.next()).done, false);
        assert.equal(active.size, 2, 'large iteration retains just its one verified file pair');
        await fs.writeFile(filename, replacement);
        await assert.rejects(async () => { for await (const _row of iterator) {} },
          error => error.code === 'ERR_SEMANTIC_INTEGRITY', 'in-place changes invalidate the retained large piece');
        assert.equal(active.size, 0);
        await fs.writeFile(filename, original);
        const controller = new AbortController();
        const cancelled = store.iterateRows(current.partition.partitionId, 'semantic_records', { signal: controller.signal });
        assert.equal((await cancelled.next()).done, false);
        controller.abort();
        await assert.rejects(async () => { for await (const _row of cancelled) {} }, { code: 'ABORT_ERR' });
        assert.equal(active.size, 0, 'cancellation disposes the same verified large-piece pair');
      }
    } finally {
      fs.open = open;
      await Promise.allSettled([...active].map(handle => handle.close()));
      await fs.writeFile(filename, original);
    }
  }
  console.log('Verified semantic piece bytes survive close-to-reopen mutation; subsequent reads reject it');
} finally { await fixture.cleanup(); }
