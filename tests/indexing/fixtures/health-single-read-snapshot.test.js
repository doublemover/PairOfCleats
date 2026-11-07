#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { createFixtureHealthReadContext, readFixtureHealthSnapshot } from '../../helpers/fixture-health-snapshot.js';
import { withVerifiedArtifactReadScope } from '../../../src/shared/artifact-io/verified-read-scope.js';
import { readJsonFile } from '../../../src/shared/artifact-io.js';
import { MINHASH_HASH_IDENTITY } from '../../../src/index/minhash.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

ensureTestingEnv(process.env);
const root = resolveTestCachePath(process.cwd(), 'fixture-health-single-read-snapshot');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value));
const seed = async (mode, { gzip = false, empty = false } = {}) => {
  const dir = path.join(root, mode);
  await fs.mkdir(path.join(dir, 'pieces'), { recursive: true });
  const chunks = empty ? [] : [
    { id: 0, start: 0, end: 8, fileId: 0, file: 'query.psql', lang: 'sql', chunkUid: 'uid-0', docmeta: { dialect: 'postgres' } },
    { id: 1, start: 9, end: 16, fileId: 1, file: 'script.js', lang: 'javascript', chunkUid: 'uid-1',
      docmeta: { risk: { tags: ['source'], flows: [] } }, padding: 'x'.repeat(140000) }
  ];
  const chunkPath = `chunk_meta.part-000000.jsonl${gzip ? '.gz' : ''}`;
  const chunkBytes = Buffer.from(chunks.map(row => JSON.stringify(row)).join('\n') + (chunks.length ? '\n' : ''));
  await fs.writeFile(path.join(dir, chunkPath), gzip ? gzipSync(chunkBytes) : chunkBytes);
  await writeJson(path.join(dir, 'chunk_meta.meta.json'), { format: 'jsonl-sharded', parts: [chunkPath], totalRecords: chunks.length });
  await writeJson(path.join(dir, 'chunk_meta_cold.json'), empty ? [] : [{ id: 1, stats: { tokens: 1 } }]);
  await writeJson(path.join(dir, 'file_meta.json'), empty ? [] : [{ id: 0, file: 'query.psql' }, { id: 1, file: 'script.js' }]);
  const packed = Buffer.alloc(16); for (let index = 0; index < 4; index += 1) packed.writeUInt32LE(index + 1, index * 4);
  await fs.writeFile(path.join(dir, 'minhash_signatures.packed.bin'), packed);
  await writeJson(path.join(dir, 'minhash_signatures.packed.meta.json'), { hashIdentity: MINHASH_HASH_IDENTITY, format: 'u32', endian: 'le', dims: 2, count: 2 });
  await writeJson(path.join(dir, 'risk_flows.json'), empty ? [] : [{ schemaVersion: 1, flowId: 'flow-0', source: {}, sink: {}, confidence: 1, notes: [], path: { callSiteIdsByStep: ['site-0'], watchByStep: [[]] } }]);
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, compatibilityKey: 'fixture-current', mode: mode === 'empty' ? 'prose' : mode,
    pieces: [
      { name: 'chunk_meta', path: chunkPath, format: 'jsonl' },
      { name: 'chunk_meta_meta', path: 'chunk_meta.meta.json', format: 'json' },
      { name: 'chunk_meta_cold', path: 'chunk_meta_cold.json', format: 'json' },
      { name: 'file_meta', path: 'file_meta.json', format: 'json' },
      { name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format: 'packed' },
      { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' },
      ...(mode === 'code' ? [{ name: 'risk_flows', path: 'risk_flows.json', format: 'json' }] : [])
    ] };
  await writeJson(path.join(dir, 'pieces', 'manifest.json'), manifest);
  return dir;
};
try {
  const code = await seed('code');
  const prose = await seed('prose', { gzip: true });
  const extracted = await seed('extracted-prose');
  const modeDirs = { code, prose, 'extracted-prose': extracted };
  const requiredModes = Object.keys(modeDirs);
  const metrics = {};
  const first = await readFixtureHealthSnapshot({ modeDirs, requiredModes, metrics });
  assert.equal(first.compatibility.compatible, true);
  assert.equal(first.modes.code.hasRiskTags, true);
  assert.equal(first.modes.code.hasRiskWatchByStep, true);
  assert.equal(first.modes.code.missingSqlDialects, false);
  assert.ok(requiredModes.every(mode => first.modes[mode].hasChunkUids));
  assert.equal(metrics.chunkRows, 6, 'risk, SQL dialect and UID checks share one traversal per mode');
  for (const [file, count] of Object.entries(metrics.readsByPath)) assert.equal(count, 1, `one selected physical read for ${file}`);
  assert.equal(metrics.readsByPath[path.join(code, 'pieces', 'manifest.json')], 1);
  assert.equal(metrics.readsByPath[path.join(code, 'minhash_signatures.packed.meta.json')], 1, 'source resolution and packed validation share decoded metadata');
  const second = await readFixtureHealthSnapshot({ modeDirs, requiredModes });
  assert.deepEqual(second.authorityByMode, first.authorityByMode, 'new invocation repeats full fresh authority without changing decisions');
  assert.ok(second.metrics.verifiedBytes > 0, 'warm evaluation still reads real bytes');

  const fileMeta = path.join(code, 'file_meta.json');
  const old = await fs.stat(fileMeta);
  const original = await fs.readFile(fileMeta, 'utf8');
  await fs.writeFile(fileMeta, original.replace('script.js', 'edited.js'));
  await fs.utimes(fileMeta, old.atime, old.mtime);
  const mutated = await readFixtureHealthSnapshot({ modeDirs, requiredModes });
  assert.equal((await fs.stat(fileMeta)).size, old.size);
  assert.notEqual(mutated.authorityByMode.code, first.authorityByMode.code, 'same size/mtime cannot reuse an earlier certificate');

  const meta = path.join(code, 'minhash_signatures.packed.meta.json');
  const invalidIdentity = JSON.parse(await fs.readFile(meta, 'utf8')); delete invalidIdentity.hashIdentity;
  await writeJson(meta, invalidIdentity);
  const invalid = await readFixtureHealthSnapshot({ modeDirs, requiredModes });
  assert.equal(invalid.compatibility.compatible, false);
  assert.equal(invalid.authorityByMode.code, null);
  await seed('code');
  await fs.rm(path.join(code, 'chunk_meta.part-000000.jsonl'));
  assert.equal((await readFixtureHealthSnapshot({ modeDirs, requiredModes })).compatibility.compatible, false);

  const empty = await seed('empty', { empty: true });
  const emptySnapshot = await readFixtureHealthSnapshot({ modeDirs: { prose: empty }, requiredModes: ['prose'] });
  assert.equal(emptySnapshot.compatibility.compatible, true);
  assert.equal(emptySnapshot.modes.prose.hasChunkUids, false, 'empty fixture keeps the previous UID-health decision');

  const context = createFixtureHealthReadContext(empty);
  const manifestFile = path.join(empty, 'pieces', 'manifest.json');
  await withVerifiedArtifactReadScope(context, async () => {
    readJsonFile(manifestFile, { containedRoot: empty });
    await fs.appendFile(manifestFile, ' ');
    assert.throws(() => context.finish(), { code: 'ERR_FILE_CHANGED' });
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('fixture health single-read snapshot controls passed');
