import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { createGraphStore } from '../../src/graph/store.js';
import { writeJsonLinesFileAsync } from '../../src/shared/json-stream/jsonl-write.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'call-site-pages-'));
const hash = bytes => 'sha1:' + createHash('sha1').update(bytes).digest('hex');
const rows = Array.from({ length: 137 }, (_, ordinal) => ({
  callSiteId: 'site-' + ordinal, callerChunkUid: ordinal % 2 ? 'caller-b' : 'caller-a',
  targetChunkUid: ordinal % 7 === 0 ? null : 'target', targetCandidates: ordinal % 7 === 0 ? ['may-a', 'may-b'] : [],
  file: 'src/Unicode-λ.js', start: ordinal * 10, end: ordinal * 10 + 4,
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
  const meta = { format: 'jsonl-sharded', parts: pieces.filter(piece => piece.name === 'call_sites').map(piece => piece.path),
    offsets: pieces.filter(piece => piece.name === 'call_sites_offsets').map(piece => piece.path) };
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
  assert.deepEqual(unresolved.map(row => row.callSiteId), ['site-136'], 'empty filtered pages still advance');
  const ambiguous = [];
  for await (const row of store.iterateCallSites({ filter: { resolution: 'ambiguous' }, limit: 3 })) ambiguous.push(row);
  assert.deepEqual(ambiguous, rows.filter(row => row.extensions.syntax.resolution === 'ambiguous'));
  const first = await store.readCallSitesPage({ filter: { callerChunkUid: 'caller-a' }, limit: 1 });
  await assert.rejects(store.readCallSitesPage({ cursor: first.cursor, filter: { callerChunkUid: 'caller-b' } }),
    { code: 'ERR_CALL_SITE_CURSOR_SCOPE' });
  await assert.rejects(store.readCallSitesPage({ maxPageBytes: 1 }), { code: 'ERR_CALL_SITE_PAGE_BYTES' });
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
