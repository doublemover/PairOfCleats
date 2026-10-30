import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { buildCallSiteId } from '../../src/index/callsite-id.js';
import { createGraphStore } from '../../src/graph/store.js';
import { buildShardedJsonlMetaFields } from '../../src/index/build/artifacts/writers/_common.js';
import { writeJsonLinesFileAsync } from '../../src/shared/json-stream/jsonl-write.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'call-site-pages-'));
const hash = bytes => 'sha1:' + createHash('sha1').update(bytes).digest('hex');
const rows = Array.from({ length: 137 }, (_, ordinal) => ({
  callSiteId: buildCallSiteId({ file: 'src/Unicode-λ.js', startLine: 1, startCol: ordinal * 10 + 1,
    endLine: 1, endCol: ordinal * 10 + 5, calleeRaw: 'invoke' }), callerChunkUid: ordinal % 2 ? 'caller-b' : 'caller-a',
  targetChunkUid: ordinal % 7 === 0 ? null : 'target', targetCandidates: ordinal % 7 === 0 ? ['may-a', 'may-b'] : [],
  file: 'src/Unicode-λ.js', start: ordinal * 10, end: ordinal * 10 + 4,
  startLine: 1, startCol: ordinal * 10 + 1, endLine: 1, endCol: ordinal * 10 + 5, languageId: 'javascript', args: [],
  calleeRaw: 'invoke', calleeNormalized: 'invoke',
  extensions: { syntax: { producer: 'tree-sitter', coordinateSystem: 'utf16', role: 'call',
    resolution: ordinal % 7 === 0 ? 'ambiguous' : 'resolved', reason: 'fixture', rawPreviewTruncated: false } }
}));
rows[136] = { ...rows[136], targetChunkUid: null, targetCandidates: [],
  extensions: { syntax: { ...rows[136].extensions.syntax, resolution: 'unresolved' } } };
const manifestPath = path.join(root, 'pieces', 'manifest.json');
try {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const pieces = [];
  for (const [part, selected] of [rows.slice(0, 67), rows.slice(67)].entries()) {
    const relative = `call_sites.parts/call_sites.part-${String(part).padStart(5, '0')}.jsonl`;
    const file = path.join(root, relative), offsets = file + '.offsets.bin';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeJsonLinesFileAsync(file, selected, { atomic: true, offsets: { path: offsets, atomic: true } });
    for (const [name, location] of [['call_sites', relative], ['call_sites_offsets', relative + '.offsets.bin']]) {
      const bytes = await fs.readFile(path.join(root, location));
      pieces.push({ name, path: location, format: name === 'call_sites' ? 'jsonl' : 'bin',
        count: selected.length, bytes: bytes.length, checksum: hash(bytes) });
    }
  }
  const dataPieces = pieces.filter(piece => piece.name === 'call_sites');
  const meta = buildShardedJsonlMetaFields({ artifact: 'call_sites',
    result: { total: rows.length, totalBytes: dataPieces.reduce((sum, piece) => sum + piece.bytes, 0),
      maxPartRecords: 70, maxPartBytes: Math.max(...dataPieces.map(piece => piece.bytes)), targetMaxBytes: 65536 },
    parts: dataPieces.map(piece => ({ path: piece.path, records: piece.count, bytes: piece.bytes })) });
  const metaBytes = Buffer.from(JSON.stringify(meta));
  await fs.writeFile(path.join(root, 'call_sites.meta.json'), metaBytes);
  pieces.push({ name: 'call_sites_meta', path: 'call_sites.meta.json', format: 'json',
    bytes: metaBytes.length, checksum: hash(metaBytes) });
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'generation-one', pieces };
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const store = createGraphStore({ indexDir: root });
  const collected = [];
  let cursor = null, pages = 0;
  do {
    const page = await store.readCallSitesPage({ cursor, limit: 11, scanRows: 13 });
    assert.ok(page.rows.length <= 11 && page.scanned <= 13 && page.bytes <= 1024 * 1024);
    collected.push(...page.rows); cursor = page.cursor; pages += 1;
  } while (cursor !== null);
  assert.ok(pages > 10);
  assert.deepEqual(collected, rows, 'every supported occurrence survives across shards, repeated edges and unresolved targets');
  const unresolved = [];
  for await (const row of store.iterateCallSites({ filter: { resolution: 'unresolved' }, scanRows: 1 })) unresolved.push(row);
  assert.deepEqual(unresolved.map(row => row.callSiteId), [rows[136].callSiteId], 'empty filtered pages still advance');
  const ambiguous = [];
  for await (const row of store.iterateCallSites({ filter: { resolution: 'ambiguous' }, limit: 3 })) ambiguous.push(row);
  assert.deepEqual(ambiguous, rows.filter(row => row.extensions.syntax.resolution === 'ambiguous'));
  const first = await store.readCallSitesPage({ filter: { callerChunkUid: 'caller-a' }, limit: 1 });
  await assert.rejects(store.readCallSitesPage({ cursor: first.cursor, filter: { callerChunkUid: 'caller-b' } }),
    { code: 'ERR_CALL_SITE_CURSOR_SCOPE' });
  await assert.rejects(store.readCallSitesPage({ maxPageBytes: 1 }), { code: 'ERR_CALL_SITE_PAGE_BYTES' });
  const malformedRoot = path.join(root, 'malformed'), malformedFile = path.join(malformedRoot, 'call_sites.jsonl');
  await fs.mkdir(path.join(malformedRoot, 'pieces'), { recursive: true });
  const malformed = { ...rows[0], callerChunkUid: 'unmatched-caller' }; delete malformed.args;
  await writeJsonLinesFileAsync(malformedFile, [malformed], { atomic: true,
    offsets: { path: malformedFile + '.offsets.bin', atomic: true } });
  const malformedPieces = [];
  for (const [name, location] of [['call_sites', 'call_sites.jsonl'], ['call_sites_offsets', 'call_sites.jsonl.offsets.bin']]) {
    const bytes = await fs.readFile(path.join(malformedRoot, location));
    malformedPieces.push({ name, path: location, format: name === 'call_sites' ? 'jsonl' : 'bin',
      count: 1, bytes: bytes.length, checksum: hash(bytes) });
  }
  await fs.writeFile(path.join(malformedRoot, 'pieces', 'manifest.json'), JSON.stringify({
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'malformed-generation', pieces: malformedPieces
  }));
  await assert.rejects(createGraphStore({ indexDir: malformedRoot }).readCallSitesPage({ filter: { callerChunkUid: 'caller-a' } }),
    { code: 'ERR_CALL_SITE_PAGE_INTEGRITY' }, 'canonical validation precedes filtering even for an unmatched checksum-qualified row');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(store.readCallSitesPage({ signal: controller.signal }), { name: 'AbortError' });
  const graph = await store.loadGraphIndex({ graphs: ['callGraph'] });
  assert.deepEqual(graph.callSiteIndex.get('caller-a|target'), rows.filter(row => row.callerChunkUid === 'caller-a'
    && row.targetChunkUid === 'target').map(row => row.callSiteId), 'normal graph builds stream the exact pair projection');
  collected[0].calleeRaw = 'caller mutation';
  assert.equal((await store.readCallSitesPage({ limit: 1 })).rows[0].calleeRaw, 'invoke');
  const dataPath = path.join(root, pieces[0].path), original = await fs.readFile(dataPath), stat = await fs.stat(dataPath);
  const changed = Buffer.from(original); changed[changed.indexOf('invoke')] = 'I'.charCodeAt(0);
  await fs.writeFile(dataPath, changed); await fs.utimes(dataPath, stat.atime, stat.mtime);
  await assert.rejects(store.readCallSitesPage(), { code: 'ERR_JSONL_CONTENT_INTEGRITY' });
  await fs.writeFile(dataPath, original);
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, buildId: 'generation-two' }));
  await assert.rejects(store.readCallSitesPage({ cursor: first.cursor, filter: { callerChunkUid: 'caller-a' } }),
    { code: 'ERR_CALL_SITE_CURSOR_SCOPE' });
  const replacement = createGraphStore({ indexDir: root, manifest: { ...manifest, buildId: 'generation-two' } });
  await assert.rejects(replacement.readCallSitesPage({ cursor: first.cursor, filter: { callerChunkUid: 'caller-a' } }),
    { code: 'ERR_CALL_SITE_CURSOR_SCOPE' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('retained call-site pages test passed');
