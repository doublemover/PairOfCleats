#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepoCacheRoot } from '../../src/shared/dict-utils.js';
import { createPointerSnapshot } from '../../src/index/snapshots/create.js';
import { computeIndexDiff, showDiff } from '../../src/index/diffs/compute.js';

process.env.PAIROFCLEATS_TESTING = '1';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'index-diff-service');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const userConfig = {
  cache: { root: cacheRoot },
  sqlite: { use: false },
  lmdb: { use: false }
};

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const sha1Value = (value) => crypto.createHash('sha1').update(String(value)).digest('hex');

const sha1File = async (filePath) => {
  const content = await fs.readFile(filePath);
  return crypto.createHash('sha1').update(content).digest('hex');
};

const writePiecesManifest = async (indexDir, files) => {
  const entries = [];
  for (const file of files) {
    const absolute = path.join(indexDir, file.path);
    const stat = await fs.stat(absolute);
    entries.push({
      type: file.type,
      name: file.name,
      format: 'json',
      path: file.path,
      bytes: Number(stat.size || 0),
      checksum: `sha1:${await sha1File(absolute)}`
    });
  }
  await writeJson(path.join(indexDir, 'pieces', 'manifest.json'), {
    version: 2,
    artifactSurfaceVersion: '0.2.0',
    pieces: entries
  });
};

const seedBuild = async ({
  repoCacheRoot,
  buildId,
  files,
  chunkSignature,
  configHash,
  toolVersion
}) => {
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(indexDir, { recursive: true });

  const fileMeta = files.map((entry, index) => ({
    id: index + 1,
    file: entry.file,
    hash: sha1Value(entry.content),
    size: entry.content.length,
    ext: 'js'
  }));
  await writeJson(path.join(indexDir, 'file_meta.json'), fileMeta);

  const chunkMeta = files.map((entry, index) => ({
    id: index,
    fileId: index + 1,
    file: entry.file,
    start: 0,
    end: entry.content.length,
    startLine: 1,
    endLine: 1,
    kind: 'function',
    name: entry.file,
    chunkId: entry.chunkId,
    metaV2: {
      chunkId: entry.chunkId,
      chunkUid: `ck:${buildId}:${entry.chunkId}`,
      signature: chunkSignature[entry.file],
      virtualPath: entry.file,
      file: entry.file
    }
  }));
  await writeJson(path.join(indexDir, 'chunk_meta.json'), chunkMeta);

  await writeJson(path.join(indexDir, 'index_state.json'), {
    generatedAt: new Date().toISOString(),
    mode: 'code',
    artifactSurfaceVersion: '0.2.0',
    buildId,
    configHash,
    tool: { version: toolVersion }
  });

  await writePiecesManifest(indexDir, [
    { type: 'meta', name: 'file_meta', path: 'file_meta.json' },
    { type: 'chunks', name: 'chunk_meta', path: 'chunk_meta.json' },
    { type: 'stats', name: 'index_state', path: 'index_state.json' }
  ]);

  await writeJson(path.join(buildRoot, 'build_state.json'), {
    schemaVersion: 1,
    buildId,
    configHash,
    tool: { version: toolVersion },
    validation: { ok: true, issueCount: 0, warningCount: 0, issues: [] }
  });
  return buildRoot;
};

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });

await seedBuild({
  repoCacheRoot,
  buildId: 'build-a',
  files: [
    { file: 'src/a.js', content: 'export const a = 1;', chunkId: 'chunk-a' }
  ],
  chunkSignature: { 'src/a.js': 'sig-a' },
  configHash: 'cfg-shared',
  toolVersion: '1.0.0'
});
await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
  buildId: 'build-a',
  buildRoot: 'builds/build-a',
  buildRoots: { code: 'builds/build-a' }
});
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: 'snap-20260212000000-diffa'
});

await seedBuild({
  repoCacheRoot,
  buildId: 'build-b',
  files: [
    { file: 'src/a.js', content: 'export const a = 2;', chunkId: 'chunk-a' },
    { file: 'src/b.js', content: 'export const b = 1;', chunkId: 'chunk-b' }
  ],
  chunkSignature: { 'src/a.js': 'sig-b', 'src/b.js': 'sig-new' },
  configHash: 'cfg-shared',
  toolVersion: '1.0.0'
});
await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
  buildId: 'build-b',
  buildRoot: 'builds/build-b',
  buildRoots: { code: 'builds/build-b' }
});
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: 'snap-20260212000000-diffb'
});

const first = await computeIndexDiff({
  repoRoot,
  userConfig,
  from: 'snap:snap-20260212000000-diffa',
  to: 'snap:snap-20260212000000-diffb',
  modes: ['code'],
  includeRelations: false,
  persist: true
});
assert.equal(first.persisted, true, 'expected persisted diff result');
assert.ok(first.diffId.startsWith('diff_'), 'expected deterministic diff id prefix');
assert.ok(
  Number(first.summary?.totals?.byKind?.['file.modified'] || 0) >= 1,
  'expected file.modified event in summary'
);

const shown = showDiff({
  repoRoot,
  userConfig,
  diffId: first.diffId,
  format: 'jsonl'
});
assert.ok(Array.isArray(shown.events) && shown.events.length > 0, 'expected persisted events');
const chunkModified = shown.events.find((event) => event.kind === 'chunk.modified');
assert.ok(chunkModified, 'expected chunk.modified event');
assert.equal(chunkModified.chunkId, 'chunk-a', 'chunk events must use stable metaV2.chunkId');

const second = await computeIndexDiff({
  repoRoot,
  userConfig,
  from: 'snap:snap-20260212000000-diffa',
  to: 'snap:snap-20260212000000-diffb',
  modes: ['code'],
  includeRelations: false,
  persist: true
});
assert.equal(second.diffId, first.diffId, 'diffId should be deterministic for identical inputs');
assert.equal(second.reused, true, 'second run should reuse existing persisted diff');

const truncated = await computeIndexDiff({
  repoRoot,
  userConfig,
  from: 'snap:snap-20260212000000-diffa',
  to: 'snap:snap-20260212000000-diffb',
  modes: ['code'],
  includeRelations: false,
  persist: false,
  maxEvents: 1
});
assert.equal(truncated.summary.truncated, true, 'expected truncation when maxEvents is low');
assert.equal(Array.isArray(truncated.events) ? truncated.events.length : 0, 1, 'expected bounded events list');

await seedBuild({
  repoCacheRoot,
  buildId: 'build-c',
  files: [
    { file: 'src/a.js', content: 'export const a = 3;', chunkId: 'chunk-a' }
  ],
  chunkSignature: { 'src/a.js': 'sig-c' },
  configHash: 'cfg-different',
  toolVersion: '1.0.0'
});
await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
  buildId: 'build-c',
  buildRoot: 'builds/build-c',
  buildRoots: { code: 'builds/build-c' }
});
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: 'snap-20260212000000-diffc'
});

await assert.rejects(
  () => computeIndexDiff({
    repoRoot,
    userConfig,
    from: 'snap:snap-20260212000000-diffa',
    to: 'snap:snap-20260212000000-diffc',
    modes: ['code'],
    persist: false
  }),
  /configHash mismatch/,
  'config mismatch should fail without allowMismatch'
);

const mismatchAllowed = await computeIndexDiff({
  repoRoot,
  userConfig,
  from: 'snap:snap-20260212000000-diffa',
  to: 'snap:snap-20260212000000-diffc',
  modes: ['code'],
  allowMismatch: true,
  persist: false
});
assert.equal(mismatchAllowed.summary.compat.configHashMismatch, true, 'mismatch should be annotated when allowed');

await seedBuild({
  repoCacheRoot,
  buildId: 'build-d',
  files: [
    { file: 'src/a.js', content: 'export const a = 4;', chunkId: 'chunk-a' }
  ],
  chunkSignature: { 'src/a.js': 'sig-d' },
  configHash: 'cfg-shared',
  toolVersion: '9.9.9'
});
await writeJson(path.join(repoCacheRoot, 'builds', 'current.json'), {
  buildId: 'build-d',
  buildRoot: 'builds/build-d',
  buildRoots: { code: 'builds/build-d' }
});
await createPointerSnapshot({
  repoRoot,
  userConfig,
  modes: ['code'],
  snapshotId: 'snap-20260212000000-diffd'
});

const toolMismatch = await computeIndexDiff({
  repoRoot,
  userConfig,
  from: 'snap:snap-20260212000000-diffa',
  to: 'snap:snap-20260212000000-diffd',
  modes: ['code'],
  persist: false
});
assert.equal(toolMismatch.summary.compat.toolVersionMismatch, true, 'tool mismatch should be annotated');

console.log('index diff service test passed');
