#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createVectorOnlyCleanupWriteContext,
  hasTokenPostingsArtifacts,
  readArtifactCleanupActions
} from './helpers/vector-only-cleanup-fixture.js';

const { outDir, runWrite } = await createVectorOnlyCleanupWriteContext('phase18-vector-only-allowlist-safety');

await runWrite({ profileId: 'default' });
const unknownFileName = 'token_postings.custom.keep';
const unknownDirName = 'token_postings.custom.dir';
const unknownSentinelName = 'sentinel.txt';
const unknownFilePath = path.join(outDir, unknownFileName);
const unknownDirPath = path.join(outDir, unknownDirName);
const unknownSentinelPath = path.join(unknownDirPath, unknownSentinelName);
await fs.mkdir(unknownDirPath, { recursive: true });
await fs.writeFile(unknownFilePath, 'keep-me\n', 'utf8');
await fs.writeFile(unknownSentinelPath, 'keep-dir\n', 'utf8');
assert.equal(fsSync.existsSync(unknownFilePath), true, 'expected unknown sparse-like file before cleanup');
assert.equal(fsSync.existsSync(unknownSentinelPath), true, 'expected unknown sparse-like dir before cleanup');

await runWrite({ profileId: 'vector_only' });
assert.equal(fsSync.existsSync(unknownFilePath), true, 'vector_only cleanup should not delete unknown file');
assert.equal(fsSync.existsSync(unknownSentinelPath), true, 'vector_only cleanup should not delete unknown directory');
assert.equal(
  hasTokenPostingsArtifacts(outDir),
  false,
  'known sparse artifact should be removed'
);
assert.equal(fsSync.existsSync(path.join(outDir, 'token_postings.shards')), false, 'known sparse shard dir should be removed');

const actions = await readArtifactCleanupActions(outDir);
assert.equal(
  actions.some((entry) => String(entry?.path || '').includes(unknownFileName)),
  false,
  'cleanup report should not include unknown file'
);
assert.equal(
  actions.some((entry) => String(entry?.path || '').includes(unknownDirName)),
  false,
  'cleanup report should not include unknown directory'
);

console.log('vector-only cleanup allowlist safety test passed');
