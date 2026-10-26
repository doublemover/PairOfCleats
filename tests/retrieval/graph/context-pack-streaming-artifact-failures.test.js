import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assembleCompositeContextPack, assembleCompositeContextPackStreaming } from '../../../src/context-pack/assemble.js';
import { buildChunkUidMapSeedIndex } from '../../../src/context-pack/seed-resolution.js';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createCanonicalTestChunkUid } from '../../helpers/chunk-uid.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('context-pack-streaming-artifact-failures');
try {
  const repoRoot = path.join(dir, 'repo'), indexDir = path.join(dir, 'index');
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true }); await fs.mkdir(indexDir);
  const text = 'export function greet() { return "hello"; }\n';
  await fs.writeFile(path.join(repoRoot, 'src/file.js'), text);
  const chunkUid = createCanonicalTestChunkUid({ namespace: 'context-seed', virtualPath: 'src/file.js' });
  const row = { docId: 0, chunkUid, chunkId: 'seed-chunk', file: 'src/file.js', start: 0, end: text.length };
  const compact = path.join(indexDir, 'compact.jsonl'); await fs.writeFile(compact, JSON.stringify(row) + '\n');
  const piece = { name: 'chunk_uid_map', path: 'compact.jsonl', format: 'jsonl', count: 1 };
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [piece] };
  const common = { repoRoot, indexDir, manifest, strict: true, indexCompatKey: 'context-seed-fixture',
    now: () => '2026-10-26T00:00:00.000Z', includeGraph: false, includeTypes: false, includeRisk: false,
    includeImports: false, includeUsages: false, includeCallersCallees: false };
  const seed = { type: 'chunk', chunkUid };
  const hit = await assembleCompositeContextPackStreaming({ ...common, seed });
  assert.equal(hit.primary.file, 'src/file.js'); assert.ok(hit.primary.excerpt.includes('export function greet'));
  assert.deepEqual(hit.stats.seedResolution, { strategy: 'chunk_uid_map_index', candidates: 1, rowsIndexed: 1, readState: 'ready', hit: true });
  assert.ok(!hit.warnings.some(value => /^CHUNK_UID_MAP_/u.test(value.code)));
  const fileHit = await assembleCompositeContextPackStreaming({ ...common, seed: { type: 'file', path: 'src/file.js' } });
  assert.equal(fileHit.primary.excerpt, hit.primary.excerpt);
  const miss = await assembleCompositeContextPackStreaming({ ...common, seed: { type: 'chunk', chunkUid: 'absent-seed' } });
  assert.equal(miss.stats.seedResolution.readState, 'ready'); assert.equal(miss.stats.seedResolution.hit, false);
  assert.ok(miss.warnings.some(value => value.code === 'CHUNK_UID_MAP_MISS'));
  const chunk = { id: 0, ...row, name: 'greet', kind: 'FunctionDeclaration', lang: 'javascript', ext: '.js', startLine: 1, endLine: 1 };
  const synchronous = assembleCompositeContextPack({ ...common, seed, chunkMeta: [chunk] });
  assert.equal(synchronous.primary.file, hit.primary.file); assert.equal(synchronous.primary.excerpt, hit.primary.excerpt);

  for (const strict of [true, false]) {
    await fs.rm(compact);
    await assert.rejects(assembleCompositeContextPackStreaming({ ...common, strict, seed }), { code: 'ERR_ARTIFACT_PARTS_MISSING' });
    await fs.writeFile(compact, '{broken\n');
    await assert.rejects(assembleCompositeContextPackStreaming({ ...common, strict, seed }), { code: 'ERR_JSONL_INVALID' });
    await fs.writeFile(compact, JSON.stringify(row) + '\n'); await fs.writeFile(path.join(indexDir, 'late.jsonl'), '{broken\n');
    const late = { ...manifest, pieces: [piece, { ...piece, path: 'late.jsonl' }] };
    await assert.rejects(assembleCompositeContextPackStreaming({ ...common, manifest: late, strict, seed }), { code: 'ERR_JSONL_INVALID' });
    await assert.rejects(buildChunkUidMapSeedIndex({ repoRoot, indexDir, manifest: late, strict }), { code: 'ERR_JSONL_INVALID' });
  }
  const absent = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [] };
  await assert.rejects(assembleCompositeContextPackStreaming({ ...common, manifest: absent, seed }), { code: 'ERR_MANIFEST_ENTRY_MISSING' });
  const optional = await assembleCompositeContextPackStreaming({ ...common, manifest: absent, strict: false, seed });
  assert.equal(optional.stats.seedResolution.readState, 'optional-absent');
  assert.ok(optional.warnings.some(value => value.code === 'CHUNK_UID_MAP_UNAVAILABLE'
    && value.artifact === 'chunk_uid_map' && value.reason === 'optional-undeclared'));
  assert.ok(!optional.warnings.some(value => value.code === 'CHUNK_UID_MAP_MISS'), 'unavailable is not a negative semantic lookup');
  await assert.rejects(assembleCompositeContextPackStreaming({ ...common, manifest: null, strict: false, seed }), { code: 'ERR_MANIFEST_MISSING' });

  chunk.metaV2 = buildMetaV2({ chunk, docmeta: {} });
  assert.ok(chunk.metaV2.symbol.symbolId);
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify([chunk]));
  const metadataOnly = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ name: 'chunk_meta', path: 'chunk_meta.json', format: 'json', count: 1 }] };
  const symbol = await assembleCompositeContextPackStreaming({ ...common, manifest: metadataOnly,
    seed: { type: 'symbol', symbolId: chunk.metaV2.symbol.symbolId } });
  assert.equal(symbol.primary.file, 'src/file.js'); assert.equal(symbol.primary.excerpt, hit.primary.excerpt);
  assert.equal(symbol.stats.seedResolution.readState, 'not-requested', 'symbol-only metadata does not require an unrelated compact map');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Streaming context packs retain strict artifact failures and distinguish valid seed misses from optional absence');
