#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { registerHooks } from 'node:module';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { buildFileMeta, buildFileMetaColumnar } from '../../../src/index/build/artifacts/file-meta.js';
import { createChunkMetaIterator } from '../../../src/index/build/artifacts/writers/chunk-meta/iterator.js';
import { compactChunkMetaEntry } from '../../../src/index/build/artifacts/writers/chunk-meta/shared.js';
import { stripChunkMetaColdFields } from '../../../src/shared/chunk-meta-cold.js';
import { loadIncrementalState } from '../../../src/index/build/incremental/planning.js';
import { buildDatabaseFromBundles } from '../../../src/storage/sqlite/build/from-bundles.js';
import { readRecordEmbeddingSource } from '../../../src/integrations/triage/record-source.js';
import { sha1 } from '../../../src/shared/hash.js';
import { buildChunkDisplayMetadata } from '../../../src/retrieval/output/format/shared.js';

const { dir } = await prepareIsolatedTestCacheDir('records-namespace-publication');
const root = path.join(dir, 'repo'), recordsDir = path.join(dir, 'external'), repoCacheRoot = path.join(dir, 'repo-cache');
const repoFile = path.join(root, 'triage', 'records', 'incident.md');
await fs.mkdir(path.dirname(repoFile), { recursive: true }); await fs.mkdir(recordsDir);
const repositoryText = '# Repository incident\nRepository boundary source.\n';
const externalText = '# External incident\nExternal boundary source.\n';
await fs.writeFile(repoFile, repositoryText); await fs.writeFile(path.join(recordsDir, 'incident.md'), externalText);
await fs.writeFile(path.join(recordsDir, 'incident.json'), JSON.stringify({ recordId: 'external-id', source: 'external-triage',
  recordType: 'finding', vuln: { vulnId: 'CVE-EXTERNAL', title: 'External sidecar summary' } }));
const key = Symbol.for('poc.test.records-namespace-publication'), captures = [], embeddingInputs = [];
globalThis[key] = input => captures.push({ chunks: structuredClone(input.state.chunks),
  fileMeta: buildFileMeta(input.state), indexState: structuredClone(input.indexState) });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const resolved = next(specifier, context);
    return context.parentURL?.endsWith('/src/integrations/triage/index-records.js')
      && resolved.url.endsWith('/src/index/build/artifacts.js') ? { url: 'poc:record-publication', shortCircuit: true } : resolved;
  },
  load(url, context, next) {
    if (url === 'poc:record-publication') return { format: 'module', shortCircuit: true,
      source: "export const writeIndexArtifacts=async input=>globalThis[Symbol.for('poc.test.records-namespace-publication')](input);" };
    return next(url, context);
  }
});
const runtime = { root, buildRoot: path.join(dir, 'build'), repoCacheRoot,
  userConfig: { cache: { root: path.join(dir, 'cache') }, triage: { recordsDir, promoteFields: ['source', 'recordId', 'recordType'] } },
  postingsConfig: { enablePhraseNgrams: true, enableChargrams: true, fielded: true }, dictWords: new Set(), dictConfig: {},
  modelId: 'stub-model', useStubEmbeddings: true, workerPool: null,
  getChunkEmbedding: async text => { embeddingInputs.push(text); return []; }, profile: { id: 'default' },
  indexingConfig: { profile: 'default' }, embeddingEnabled: false, embeddingService: false,
  incrementalEnabled: true, incrementalBundleFormat: 'json', shards: { enabled: false }, twoStage: { enabled: false } };
try {
  const { buildRecordsIndexForRepo } = await import('../../../src/integrations/triage/index-records.js');
  const discovery = { entries: [{ abs: repoFile, rel: 'triage/records/incident.md', record: { source: 'repository-record', recordType: 'record' } }] };
  const run = () => buildRecordsIndexForRepo({ runtime, discovery });
  await run();
  const initial = captures.at(-1);
  assert.equal(initial.chunks.length, 2);
  assert.equal(new Set(initial.chunks.map(chunk => chunk.file)).size, 2);
  assert.equal(new Set(initial.chunks.map(chunk => chunk.chunkUid)).size, 2);
  assert.equal(initial.fileMeta.fileMeta.length, 2);
  const byKind = kind => initial.chunks.find(chunk => chunk.recordSource.kind === kind);
  const repository = byKind('repository'), external = byKind('triage');
  assert.ok(repository && external);
  assert.equal(repository.fileHash, sha1(Buffer.from(repositoryText)));
  assert.equal(external.fileHash, sha1(Buffer.from(externalText)));
  assert.equal(repository.end, repositoryText.length); assert.equal(external.end, externalText.length);
  assert.equal(repository.name, 'incident'); assert.equal(external.name, 'CVE-EXTERNAL');
  assert.equal(repository.docmeta.record.source, 'repository-record');
  assert.equal(external.docmeta.record.source, 'external-triage');
  for (const chunk of initial.chunks) {
    assert.equal(chunk.file, chunk.recordSource.storagePath);
    assert.deepEqual(chunk.metaV2.recordSource, chunk.recordSource);
    const file = initial.fileMeta.fileMeta.find(row => row.file === chunk.file);
    assert.deepEqual(file.recordSource, chunk.recordSource); assert.equal(file.hash, chunk.fileHash);
    const source = await readRecordEmbeddingSource({ repoRoot: root, recordsDir, file: chunk.file, items: [{ chunk }] });
    assert.equal(source.text, chunk.recordSource.kind === 'triage' ? externalText : repositoryText);
    const display = buildChunkDisplayMetadata({ chunk, mode: 'records', columns: 108,
      minFileWidth: 18, pathWidthOffset: 2, rootDir: root, hyperlinkMode: 'always' });
    assert.ok(display.fileLabel.startsWith(`${chunk.recordSource.kind}:triage/records/incident.md`));
    assert.doesNotMatch(display.fileStyled, /\u001b\]8;/u, 'virtual source references cannot become unverified current-file links');
  }
  const columnar = buildFileMetaColumnar(initial.fileMeta.fileMeta);
  assert.equal(columnar.arrays.recordSource.length, 2);
  const iterator = createChunkMetaIterator({ chunks: initial.chunks, fileIdByPath: initial.fileMeta.fileIdByPath,
    resolvedTokenMode: 'none', tokenSampleSize: 0, maxJsonBytes: 32 * 1024 });
  const hot = [...iterator()].map(stripChunkMetaColdFields);
  assert.deepEqual(hot.map(row => row.recordSource), initial.chunks.map(row => row.recordSource));
  assert.throws(() => compactChunkMetaEntry(hot[0], 64), { code: 'ERR_RECORD_SOURCE_LIMIT' });
  const state = await loadIncrementalState({ repoRoot: root, repoCacheRoot, mode: 'records', enabled: true, bundleFormat: 'json' });
  assert.equal(Object.keys(state.manifest.files).length, 2);
  assert.ok(initial.chunks.every(chunk => state.manifest.files[chunk.file].recordSource.contentHash === chunk.fileHash));
  const dbPath = path.join(dir, 'records.db');
  const built = await buildDatabaseFromBundles({ Database, outPath: dbPath, repoRoot: root, mode: 'records',
    incrementalData: { manifest: state.manifest, bundleDir: state.bundleDir }, envConfig: { bundleThreads: 1 },
    threadLimits: { fileConcurrency: 1 }, emitOutput: false, validateMode: 'off', vectorConfig: { enabled: false }, modelConfig: { id: null } });
  assert.equal(built.count, 2);
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db.prepare('SELECT file,metaV2_json FROM chunks ORDER BY file').all();
    assert.deepEqual(rows.map(row => row.file), initial.chunks.map(row => row.file).sort());
    for (const row of rows) assert.deepEqual(JSON.parse(row.metaV2_json).recordSource,
      initial.chunks.find(chunk => chunk.file === row.file).recordSource);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM file_manifest').get().count, 2);
  } finally { db.close(); }
  embeddingInputs.length = 0; await run();
  assert.equal(embeddingInputs.length, 0); assert.deepEqual(captures.at(-1).chunks, initial.chunks);
  await fs.writeFile(path.join(recordsDir, 'incident.md'), repositoryText);
  await run();
  const equalText = captures.at(-1).chunks;
  assert.equal(equalText.length, 2); assert.equal(new Set(equalText.map(chunk => chunk.fileHash)).size, 1);
  assert.equal(new Set(equalText.map(chunk => chunk.chunkUid)).size, 2);
  assert.equal(new Set(equalText.map(chunk => chunk.metaV2.recordSource.rootKey)).size, 2);
  assert.notDeepEqual(equalText[0].docmeta.record, equalText[1].docmeta.record);
} finally { hooks.deregister(); delete globalThis[key]; }
console.log('Records publication, hot/cold metadata, incremental replay, SQLite and deferred reads retain both root namespaces.');
