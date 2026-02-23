#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { resolveIndexStats } from '../../../src/retrieval/cli/auto-sqlite.js';

const root = process.cwd();
const indexDir = path.join(root, '.testCache', 'retrieval-auto-sqlite-resolve-index-stats-compressed-jsonl');
await fs.rm(indexDir, { recursive: true, force: true });
await fs.mkdir(indexDir, { recursive: true });

const rows = [
  '{"id":"c1","file":"a.js","start":0,"end":1}',
  '{"id":"c2","file":"b.js","start":0,"end":1}',
  '{"id":"c3","file":"c.js","start":0,"end":1}'
].join('\n') + '\n';
await fs.writeFile(path.join(indexDir, 'chunk_meta.jsonl.gz'), gzipSync(Buffer.from(rows, 'utf8')));

const stats = resolveIndexStats(indexDir);
assert.equal(stats.missing, false, 'expected index stats to mark existing index as non-missing');
assert.equal(stats.chunkCount, 3, 'expected compressed jsonl chunk_meta to produce chunk count');
assert.ok(
  Number.isFinite(stats.artifactBytes) && stats.artifactBytes > 0,
  `expected artifact bytes to be populated, got ${stats.artifactBytes}`
);

console.log('retrieval auto-sqlite resolveIndexStats compressed jsonl test passed');
