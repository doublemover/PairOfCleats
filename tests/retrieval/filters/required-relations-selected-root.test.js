import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadFileRelations } from '../../../src/retrieval/cli/index-loader.js';
import { hydrateLoadedIndexes } from '../../../src/retrieval/cli/load-indexes/filter-loader.js';
import { createImportExtraction } from '../../../src/shared/import-extraction.js';
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
  // A zero-row family cannot prove an existing file's requested facts. Actual
  // empty per-file arrays, or a genuinely empty index, remain complete.
  await assert.rejects(hydrate({ chunkMeta: [{ id: 0, file: 'a.js' }] }, false, false), { code: 'CAPABILITY_MISSING' });
  await hydrate({ chunkMeta: [] }, false, false);
  await fs.writeFile(path.join(selected, 'file_relations.json'), JSON.stringify([{ file: 'a.js', relations: { usages: [] } }]));
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
  const hydrateImports = idx => hydrateLoadedIndexes({ rootDir: root, userConfig: {}, runCode: true,
    codeIndexDir: selected, idxCode: idx, strict: true, relationFilters: { importName: 'needle' } });
  for (const state of ['unsupported', 'partial', 'unqualified', 'unavailable', 'invalid', 'cancelled']) {
    const receipt = createImportExtraction({ entries: [], text: '', state,
      reasons: state === 'partial' ? ['source_length_limit'] : [],
      parser: { id: 'controlled-producer', version: '1', available: true } });
    const idx = { chunkMeta: [{ id: 0, file: 'a.js', codeRelations: { imports: [], importExtraction: receipt } }] };
    await assert.rejects(hydrateImports(idx), error => error.code === 'CAPABILITY_MISSING' && error.details.state === state);
  }
  const receipt = createImportExtraction({ entries: [], text: '', state: 'complete',
    parser: { id: 'controlled-producer', version: '1', available: true } });
  const verifiedEmpty = { chunkMeta: [{ id: 0, file: 'a.js', codeRelations: { imports: [], importExtraction: receipt } }] };
  await hydrateImports(verifiedEmpty);
  assert.equal(verifiedEmpty.fileRelationsReadiness.state, 'complete-inline');
  await assert.rejects(hydrateImports({ chunkMeta: [{ id: 0, file: 'a.js', codeRelations: { imports: [] } }] }),
    error => error.code === 'CAPABILITY_MISSING' && error.details.state === 'unqualified');
  const staticSubset = createImportExtraction({ entries: [], text: '', parserCoverage: 'partial',
    producerId: 'controlled-static-parser', scope: 'static-import-specifiers',
    parser: { id: 'controlled-producer', version: '1', available: true } });
  await hydrateImports({ chunkMeta: [{ id: 0, file: 'a.js', codeRelations: { imports: [], importExtraction: staticSubset } }] });
  const unknownPrimary = createImportExtraction({ entries: [], text: '', state: 'unqualified' });
  await assert.rejects(hydrateImports({ chunkMeta: [{ id: 0, file: 'a.js', codeRelations: {
    imports: [], importExtraction: unknownPrimary, importScanExtraction: staticSubset } }] }),
  error => error.code === 'CAPABILITY_MISSING' && error.details.state === 'unqualified',
  'a qualified secondary static scan cannot upgrade the broader unknown primary producer');
  const lexicalOnly = { chunkMeta: [{ id: 0, file: 'a.js' }] };
  await hydrateLoadedIndexes({ rootDir: root, userConfig: {}, runCode: true, codeIndexDir: selected,
    idxCode: lexicalOnly, needsFileRelations: false, needsAnnArtifacts: false });
  assert.equal(lexicalOnly.fileRelationsReadiness, undefined, 'unrequested relation evidence remains optional');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('required relations selected root passed');
