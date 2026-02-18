#!/usr/bin/env node
import { applyTestEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeSnapshot } from '../../src/index/snapshots/registry.js';
import { loadDiffInputs, writeDiffInputs, writeDiffsManifest } from '../../src/index/diffs/registry.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'phase14-no-path-leak');
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const absoluteBuildRoot = path.resolve(tempRoot, 'abs-build-root');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoCacheRoot, { recursive: true });

await assert.rejects(
  () => writeSnapshot(repoCacheRoot, 'snap-20260212-leak', {
    version: 1,
    snapshotId: 'snap-20260212-leak',
    createdAt: '2026-02-12T00:00:00.000Z',
    kind: 'pointer',
    tags: [],
    pointer: {
      buildRootsByMode: {
        code: absoluteBuildRoot
      },
      buildIdByMode: {
        code: 'build-abc'
      }
    }
  }),
  (err) => err?.code === 'INVALID_REQUEST',
  'snapshot registry should reject absolute persisted paths'
);

await assert.rejects(
  () => writeDiffsManifest(repoCacheRoot, {
    version: 1,
    updatedAt: '2026-02-12T00:00:00.000Z',
    diffs: {
      diff_test: {
        id: 'diff_test',
        createdAt: '2026-02-12T00:00:00.000Z',
        from: { ref: 'snap:snap-old' },
        to: { ref: 'snap:snap-new' },
        modes: ['code'],
        summaryPath: '../escape.json'
      }
    }
  }),
  (err) => err?.code === 'INVALID_REQUEST',
  'diff manifest should reject traversal paths'
);

await assert.rejects(
  () => writeDiffInputs(repoCacheRoot, 'diff_test', {
    id: 'diff_test',
    createdAt: '2026-02-12T00:00:00.000Z',
    from: { ref: `path:${absoluteBuildRoot}` },
    to: { ref: 'snap:snap-target' },
    modes: ['code'],
    allowMismatch: true,
    identityHash: 'abc123'
  }),
  (err) => err?.code === 'INVALID_REQUEST',
  'path refs should be blocked unless persistUnsafe is enabled'
);

await writeDiffInputs(repoCacheRoot, 'diff_test', {
  id: 'diff_test',
  createdAt: '2026-02-12T00:00:00.000Z',
  from: { ref: `path:${absoluteBuildRoot}` },
  to: { ref: 'snap:snap-target' },
  modes: ['code'],
  allowMismatch: true,
  identityHash: 'abc123'
}, { persistUnsafe: true });

const persisted = loadDiffInputs(repoCacheRoot, 'diff_test');
assert.equal(persisted.from.ref, 'path:<redacted>');
assert.ok(typeof persisted.from.pathHash === 'string' && persisted.from.pathHash.length > 0);

const rawInputs = await fs.readFile(path.join(repoCacheRoot, 'diffs', 'diff_test', 'inputs.json'), 'utf8');
assert.ok(!rawInputs.includes(absoluteBuildRoot), 'persisted inputs.json must not leak absolute path');

console.log('no path leak test passed');

