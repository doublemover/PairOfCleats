import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticPartitionSink, createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { prepareSemanticBatchEntry, semanticBatchEntryBytes } from '../../../src/index/semantic/prepared-batch.js';
import { collectSemanticOwnership } from '../../../src/index/semantic/ownership.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { enqueueCallSitesArtifacts } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { enqueueSemanticArtifacts } from '../../../src/index/build/artifacts/writers/semantic/family.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { createGraphStore } from '../../../src/graph/store.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), 'call-site-retained-source-handoff');
await fs.rm(root, { recursive: true, force: true });
const outDir = path.join(root, 'index-code'), semanticRoot = path.join(outDir, 'semantic');
await fs.mkdir(semanticRoot, { recursive: true });
const text = 'def caller() = object[index]()';
const bytes = Buffer.from(text), start = text.indexOf('object'), end = text.length;
const snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace: root, path: 'calls.scala', language: 'scala' });
const partitionId = createSyntaxPartitionId({ sourceUnitId: snapshot.manifest.sourceUnitId,
  parser: { family: 'fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: {} });
const diskAccount = createSemanticDiskAccount(16 * 1024 * 1024);
// This handoff qualifies retained source/ownership, not Scala semantic extraction.
// The source keeps its actual language; no unsupported extractor is enabled.
const policy = normalizeSemanticConfig({ enabled: true });
const generation = { baseBuildId: 'call-source-generation', semanticRevision: 0 };
const storage = { generation, relativePath: 'index-code/semantic' };
const detail = { source: 'tree-sitter', coordinateSystem: 'utf16', role: 'call', callee: null,
  calleeRaw: 'object[index]', start, end, startLine: 1, startCol: start + 1,
  endLine: 1, endCol: end + 1, reason: 'dynamic-call-target', rawPreviewTruncated: false };
const chunks = [{ id: 0, file: 'calls.scala', chunkUid: 'caller', start: 0, end: text.length,
  kind: 'FunctionDeclaration', name: 'caller', lang: 'scala', codeRelations: { callDetails: [detail] } }];
try {
  const sink = await createSemanticPartitionSink({ stagingRoot: semanticRoot, source: snapshot.manifest, sourceBytes: bytes,
    sourceCapability: snapshot.sourceCapability, partitionId, producerHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), diskAccount });
  const entry = prepareSemanticBatchEntry({ family: 'node', row: { id: 0, kind: 'expression', span: [start, end], scope: null,
    data: { astKind: 'call_expression', operation: null, invocationKind: 'call', syntacticArgumentCount: 0, flags: [] } } });
  await sink.appendBatch({ partitionId, sequence: 0, rows: [entry], byteCount: semanticBatchEntryBytes(entry) });
  const partition = await sink.finalizeSource();
  const facts = await collectSemanticOwnership({ facts: { source: snapshot.manifest, partition, coverage: [] }, chunks, bytes,
    repositoryNamespace: root, stagingRoot: semanticRoot, storage, diskAccount, policy });
  assert.deepEqual(detail.semanticRecordRef, { partitionId, localId: 0 }, 'production ownership pass joins the retained invocation');
  const state = { chunks, semanticFactsByFile: new Map([['calls.scala', facts]]), semanticDiskAccount: diskAccount };
  const jobs = [], pieces = [];
  const addPieceFile = (entry, file) => pieces.push({ ...entry, path: path.relative(outDir, file).replaceAll('\\', '/') });
  const enqueueWrite = (_label, job) => jobs.push(job);
  await enqueueCallSitesArtifacts({ state, outDir, buildRoot: root, buildId: generation.baseBuildId, maxJsonBytes: 65536,
    enqueueWrite, addPieceFile, formatArtifactLabel: value => value });
  enqueueSemanticArtifacts({ state, root, outDir, enabled: true,
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: generation.baseBuildId },
    enqueueWrite, addPieceFile, declareArtifactFamily() {} });
  for (const job of jobs) await job();
  await writePiecesManifest({ pieceEntries: pieces, outDir, mode: 'code',
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: generation.baseBuildId } });
  const page = await createGraphStore({ indexDir: outDir }).readCallSitesPage();
  const retained = page.rows[0].extensions.semanticRef;
  assert.equal(retained.status, 'available');
  assert.deepEqual(retained.recordRef, detail.semanticRecordRef);
  assert.deepEqual(retained.generation, generation);
  assert.equal(retained.sourceHash, snapshot.manifest.byteHash);
  const published = await openPublishedSemanticStore({ indexDir: outDir, repoRoot: root, generation });
  const [source] = await published.store.getSourceSpans([retained.recordRef]);
  assert.equal(source.text, text.slice(start, end), 'full source comes from retained bytes without a working-tree file');
  assert.equal(source.sourceHash, retained.sourceHash);
  assert.equal(state.callSitesCoverage.semanticReferences.available, 1);
  const invalid = structuredClone(chunks); invalid[0].codeRelations.callDetails[0].end -= 1;
  await assert.rejects(enqueueCallSitesArtifacts({ state: { ...state, chunks: invalid }, outDir, buildRoot: root,
    buildId: generation.baseBuildId, maxJsonBytes: 65536, enqueueWrite, addPieceFile, formatArtifactLabel: value => value }),
  { code: 'ERR_CALL_SITE_SEMANTIC_REF' });
  await assert.rejects(enqueueCallSitesArtifacts({ state, outDir, buildRoot: root, buildId: 'wrong-generation',
    maxJsonBytes: 65536, enqueueWrite, addPieceFile, formatArtifactLabel: value => value }), { code: 'ERR_CALL_SITE_SEMANTIC_REF' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('canonical call-site retained source handoff test passed');
