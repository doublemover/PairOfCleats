import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCodeMap } from '../../src/map/build-map.js';
import { buildMapMembers } from '../../src/map/build-map/members.js';
import { buildMemberIndex, resolveMemberByName } from '../../src/map/build-map/symbols.js';
import { createRepoMapIterator } from '../../src/index/build/artifacts/writers/repo-map.js';
import { prepareArtifactIoTestDir, writePiecesManifest } from '../helpers/artifact-io-fixture.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { buildShardedJsonlMetaFields } from '../../src/index/build/artifacts/writers/_common.js';

const dir = await prepareArtifactIoTestDir('map-canonical-member-inventory');
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const chunks = [
  { id: 0, start: 0, end: 20, file: 'src/a.js', name: 'alpha', kind: 'function', startLine: 1, endLine: 2,
    metaV2: { chunkUid: 'chunk:alpha', symbol: { symbolId: 'sym:v1:alpha' },
      dataflow: { aliases: ['a=b', 'c=d', 'e=f', 'g=h', 'i=j'] } } },
  { id: 1, start: 0, end: 20, file: 'src/b.js', name: 'beta', kind: 'function', startLine: 1, endLine: 2,
    metaV2: { chunkUid: 'chunk:beta', symbol: { symbolId: 'sym:v1:beta' } } }
];
const relations = new Map([
  ['src/a.js', { exports: ['alpha'], importLinks: ['src/empty.js', 'external/pkg.js'] }],
  ['src/b.js', { exports: ['beta'] }]
]);
const repoMap = [...createRepoMapIterator({ chunks, fileRelations: relations })()];
assert.equal(repoMap[0].chunkUid, 'chunk:alpha');
const pieces = [];
const write = async (name, value) => {
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(value));
  pieces.push({ name, path: `${name}.json`, format: 'json' });
};
try {
  await write('repo_map', repoMap);
  await write('chunk_meta', chunks);
  await write('file_relations', [...relations].map(([file, value]) => ({ file, relations: value })));
  // Inventory-only files have neither named chunks nor repo_map entries. The
  // JSONL shards exercise the canonical owner instead of file_meta.json.
  const fileRows = ['src/a.js', 'src/b.js', 'src/empty.js', 'src/comment-only.js']
    .map((file, id) => ({ id, file, ext: '.js' }));
  const parts = [];
  for (const [shard, rows] of [fileRows.slice(0, 2), fileRows.slice(2)].entries()) {
    const file = `file_meta.part-${String(shard).padStart(5, '0')}.jsonl`;
    const payload = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    await fs.writeFile(path.join(dir, file), payload);
    parts.push({ path: file, records: rows.length, bytes: Buffer.byteLength(payload) });
    pieces.push({ name: 'file_meta', path: file, format: 'jsonl' });
  }
  await fs.writeFile(path.join(dir, 'file_meta.meta.json'), JSON.stringify(buildShardedJsonlMetaFields({
    artifact: 'file_meta', parts, result: { total: fileRows.length,
      totalBytes: parts.reduce((sum, part) => sum + part.bytes, 0) }
  })));
  pieces.push({ name: 'file_meta_meta', path: 'file_meta.meta.json', format: 'json' });
  await writePiecesManifest(dir, pieces);
  const options = { include: ['imports', 'exports', 'aliases'], onlyExported: true };
  const map = await buildCodeMap({ repoRoot: dir, indexDir: dir, options });
  assert.deepEqual(map.nodes.map(node => node.path), fileRows.map(row => row.file).sort());
  assert.equal(map.summary.counts.members, 2, 'each symbol has one visible canonical member');
  const alpha = map.nodes.find(node => node.path === 'src/a.js').members[0];
  assert.equal(alpha.id, 'sym:v1:alpha');
  assert.equal(alpha.exported, true);
  assert.equal(alpha.dataflow.aliases.length, 5);
  assert.equal(map.edges.filter(edge => edge.type === 'alias').length, 5);
  assert.ok(map.edges.some(edge => edge.type === 'import' && edge.to.file === 'src/empty.js'));
  assert.ok(!map.nodes.some(node => node.path === 'external/pkg.js'));
  assert.equal(map.summary.omittedEndpoints.unavailable, 1);
  const capped = await buildCodeMap({ repoRoot: dir, indexDir: dir, options: { ...options, maxEdges: 2 } });
  assert.equal(capped.edges.length + capped.summary.dropped.edges, map.edges.length);

  // Pre-durable repo_map entries join only when the generation witnesses one
  // compatible declaration. Ambiguity must not transfer export authority.
  const legacy = repoMap.map(({ chunkUid, symbolId, virtualPath, ...entry }) => entry);
  const build = (rows, entries) => buildMapMembers({ chunkMeta: rows, repoMap: entries,
    fileMeta: [], fileRelations: [], intern: value => value, strict: true, warnings: [] });
  const joined = build(chunks, legacy);
  assert.equal(joined.memberById.size, 2);
  assert.equal(joined.memberById.get('sym:v1:alpha').exported, true);
  const overloaded = [...chunks, { ...chunks[0], id: 2, metaV2: {
    chunkUid: 'chunk:overload', symbol: { symbolId: 'sym:v1:overload' } } }];
  const ambiguous = build(overloaded, legacy);
  assert.equal(ambiguous.memberById.size, 3);
  assert.equal(ambiguous.identitySummary.ambiguous, 1);
  assert.equal(ambiguous.memberById.get('sym:v1:alpha').exported, null);
  assert.equal(ambiguous.aliasById.get('src/a.js::alpha'), null);
  assert.equal(resolveMemberByName(buildMemberIndex(ambiguous.memberById), 'alpha', 'src/a.js'), null);
  const origins = overloaded.map((chunk, index) => ({ ...chunk,
    metaV2: { ...chunk.metaV2, virtualPath: index === 2 ? 'src/a.js#embedded' : chunk.file } }));
  const qualified = build(origins, [{ ...legacy[0], virtualPath: 'src/a.js#embedded', exported: true }]);
  assert.equal(qualified.memberById.get('sym:v1:overload').exported, true);
  assert.equal(qualified.memberById.get('sym:v1:alpha').exported, null);
  assert.throws(() => build(chunks, [{ ...repoMap[0], file: 'src/other.js' }]), /disagrees/);
  const durableDisplay = build(chunks, [{ ...repoMap[0], signature: 'legacy display preview', endLine: 99 }]);
  assert.equal(durableDisplay.memberById.size, 2);
  assert.equal(durableDisplay.memberById.get('sym:v1:alpha').exported, true);
  assert.equal(durableDisplay.memberById.get('sym:v1:alpha').range.endLine, 2);
} finally {
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Canonical map members, sharded file inventory, ambiguity and complete alias evidence are preserved.');
