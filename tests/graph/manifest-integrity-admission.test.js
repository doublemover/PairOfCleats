import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createGraphStore } from '../../src/graph/store.js';
import { prepareGraphIndex } from '../../src/integrations/tooling/graph-helpers.js';
import { createGraphStoreFixture, emptyGraphRelations } from './helpers/graph-fixtures.js';

const { tmpDir } = createGraphStoreFixture({ prefix: 'graph-manifest-integrity-', graphRelations: emptyGraphRelations() });
const manifestPath = path.join(tmpDir, 'pieces', 'manifest.json');
const original = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const meta = { name: 'graph_relations_meta', path: 'graph.meta.json', format: 'json' };
try {
  await fs.writeFile(path.join(tmpDir, meta.path), JSON.stringify({ format: 'jsonl-sharded', parts: ['missing.jsonl'] }));
  const cases = [
    { pieces: [...original.pieces, meta, { ...meta, path: 'other.meta.json' }], code: 'ERR_MANIFEST_INVALID' },
    { pieces: original.pieces.concat({ name: 'graph_relations', path: 'other.json', format: 'json' }), code: 'ERR_MANIFEST_INVALID' },
    { pieces: original.pieces.filter(piece => piece.name !== 'graph_relations').concat(meta), code: 'ERR_MANIFEST_INCOMPLETE' },
    { pieces: original.pieces.filter(piece => piece.name !== 'graph_relations').concat(meta,
      { name: 'graph_relations', path: 'missing.jsonl', format: 'jsonl' }), code: 'ERR_ARTIFACT_MISSING' },
    { pieces: original.pieces.map(piece => piece.name === 'graph_relations' ? { ...piece, path: '../outside.json' } : piece) }
  ];
  for (const entry of cases) {
    const manifest = { ...original, pieces: entry.pieces };
    const store = createGraphStore({ indexDir: tmpDir, manifest, strict: true });
    const presence = store.getArtifactPresence('graph_relations');
    assert.equal(presence.state, 'invalid');
    if (entry.code) assert.equal(presence.error.code, entry.code);
    await assert.rejects(store.loadGraphIndex({ graphs: ['callGraph'], includeCsr: false }),
      error => error.code === presence.error.code);
    await assert.rejects(prepareGraphIndex({ indexDir: tmpDir, selection: ['callGraph'], strict: true,
      graphInputs: { manifest, indexSignature: 'test-integrity' }, cacheEnabled: false }),
    error => error.code === presence.error.code, 'shared graph-tool preparation must retain the same integrity failure');
  }
  await fs.writeFile(path.join(tmpDir, meta.path), '{broken');
  const malformed = { ...original, pieces: original.pieces.concat(meta) };
  await assert.rejects(prepareGraphIndex({ indexDir: tmpDir, selection: ['callGraph'],
    graphInputs: { manifest: malformed, indexSignature: 'malformed-meta' }, cacheEnabled: false }));
  const absent = { ...original, pieces: original.pieces.filter(piece => piece.name !== 'graph_relations') };
  const optional = createGraphStore({ indexDir: tmpDir, manifest: absent });
  assert.equal(optional.getArtifactPresence('graph_relations').state, 'absent');
  assert.equal(optional.hasArtifact('graph_relations'), false);
  const valid = createGraphStore({ indexDir: tmpDir, manifest: original });
  assert.equal(valid.getArtifactPresence('graph_relations').state, 'ready');
  const graph = await valid.loadGraphIndex({ graphs: ['callGraph'], includeCsr: false });
  assert.equal(graph.callGraphIndex.size, 0);
  const prepared = await prepareGraphIndex({ indexDir: tmpDir, selection: ['callGraph'],
    graphInputs: { manifest: original, indexSignature: 'valid-empty' }, cacheEnabled: false });
  assert.equal(prepared.graphIndex.callGraphIndex.size, 0);
} finally { await fs.rm(tmpDir, { recursive: true, force: true }); }
console.log('GraphStore and shared graph-tool admission retain manifest integrity provenance and valid empty/absent controls.');
