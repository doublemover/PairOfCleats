import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadFileRelations } from '../../../src/retrieval/cli/index-loader.js';
import { hydrateLoadedIndexes } from '../../../src/retrieval/cli/load-indexes/filter-loader.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-required-relations-'));
try {
  const selected = path.join(root, 'selected/index-code');
  await fs.mkdir(path.join(selected, 'pieces'), { recursive: true });
  const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, mode: 'code', stage: 'stage2',
    pieces: [{ name: 'file_relations', type: 'relations', format: 'json', path: 'file_relations.json' }] };
  await fs.writeFile(path.join(selected, 'pieces/manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(selected, 'file_relations.json'), '[]');
  const empty = await loadFileRelations(root, {}, 'code', { indexDir: selected, required: true });
  assert.equal(empty.size, 0);
  assert.equal(empty.readiness.indexDir, selected);
  const hydrate = (idx, useSqlite, useLmdb) => hydrateLoadedIndexes({ rootDir: root, userConfig: {},
    useSqlite, useLmdb, runCode: true, codeIndexDir: selected, idxCode: idx,
    strict: true, needsAnnArtifacts: false, relationFilters: { uses: 'needle' } });
  for (const [useSqlite, useLmdb] of [[false, false], [true, false], [false, true]]) {
    const idx = { chunkMeta: [{ id: 0, file: 'a.js' }], fileRelations: new Map() };
    await hydrate(idx, useSqlite, useLmdb);
    assert.equal(idx.fileRelationsReadiness.state, 'complete');
  }
  await fs.writeFile(path.join(selected, 'file_relations.json'), '{broken');
  for (const [useSqlite, useLmdb] of [[false, false], [true, false], [false, true]]) {
    await assert.rejects(hydrate({ chunkMeta: [{ id: 0, file: 'a.js' }], fileRelations: new Map() }, useSqlite, useLmdb));
  }
  const inline = { chunkMeta: [{ id: 0, file: 'a.js', codeRelations: { usages: [] } }] };
  await hydrate(inline, false, false);
  assert.equal(inline.fileRelationsReadiness.state, 'complete-inline');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('required relations selected root passed');
