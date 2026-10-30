import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createLoggerScope } from '../../../src/shared/progress-runtime.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { writeArtifactPublicationRecord, writeArtifactPublicationValidationReport } from '../../../src/index/build/artifact-publication.js';
import { createRepoMapIterator } from '../../../src/index/build/artifacts/writers/repo-map.js';
import { buildCodeMap } from '../../../src/map/build-map.js';
import { runMapBenchWorker } from '../../../tools/bench/map/worker.js';
import { applyTestEnv } from '../../helpers/test-env.js';

await requireBootstrap(); applyTestEnv();
const request = JSON.parse(process.argv[2]), root = path.resolve(request.root), workRoot = path.join(root, 'work');
const marker = JSON.parse((await readVerifiedContainedFile(root, path.join(root, 'artifact-benchmark-owner.json'), { maxBytes: 8192 })).buffer);
assert.equal(marker.runIdentity, request.runIdentity); assert.equal(marker.workRoot, workRoot);
if (request.command === 'prepare') {
  const repoRoot = path.join(workRoot, 'repo'), buildRoot = path.join(workRoot, 'build'), indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true }); await fs.mkdir(indexDir, { recursive: true });
  const files = 256, members = 70, chunks = [], fileMeta = [], relations = new Map(), nodes = [];
  const sourceHash = createHash('sha256');
  for (let fileIndex = 0; fileIndex < files; fileIndex++) {
    const file = `src/file-${fileIndex}.js`, lines = Array.from({ length: members }, (_, index) =>
        `export function f${index}() { return f${(index + 1) % members}(); }\n`), body = lines.join('');
    await fs.writeFile(path.join(repoRoot, file), body); sourceHash.update(file); sourceHash.update(body);
    fileMeta.push({ id: fileIndex, file, ext: '.js', size: Buffer.byteLength(body), hash: createHash('sha256').update(body).digest('hex') });
    relations.set(file, { exports: Array.from({ length: members }, (_, index) => `f${index}`), importLinks: [] });
    let offset = 0;
    for (let index = 0; index < members; index++) {
      const uid = `chunk:map-qualification:${fileIndex}:${index}`, symbolId = `sym:v1:map-qualification:${fileIndex}:${index}`;
      chunks.push({ id: chunks.length, file, name: `f${index}`, kind: 'FunctionDeclaration', start: offset,
        end: offset + lines[index].length, startLine: index + 1, endLine: index + 1, metaV2: { chunkUid: uid, symbol: { symbolId } } });
      nodes.push({ id: uid, out: [`chunk:map-qualification:${fileIndex}:${(index + 1) % members}`],
        in: [`chunk:map-qualification:${fileIndex}:${(index + members - 1) % members}`] });
      offset += lines[index].length;
    }
  }
  const pieces = [];
  for (const [name, value] of [['chunk_meta', chunks], ['repo_map', [...createRepoMapIterator({ chunks, fileRelations: relations })()]],
    ['file_meta', fileMeta], ['file_relations', [...relations].map(([file, value]) => ({ file, relations: value }))],
    ['graph_relations', { version: 1, callGraph: { nodeCount: nodes.length, edgeCount: nodes.length, nodes },
      usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }, importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] } }]]) {
    const relative = `${name}.json`; await fs.writeFile(path.join(indexDir, relative), JSON.stringify(value));
    pieces.push({ name, path: relative, format: 'json' });
  }
  const buildId = `map-builder-qualification-${marker.runIdentity}`, indexState = { buildId, mode: 'code', stage: 'stage2', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION };
  await atomicWriteJson(path.join(indexDir, 'index_state.json'), indexState, { createOnly: true });
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  const logger = createLoggerScope(); let progressLines = 0;
  logger.setProgressHandlers({ log(message) {
    assert.equal(message, '→ Wrote pieces manifest (' + pieces.length + ' entries).'); progressLines++;
  } });
  try { await logger.run(() => writePiecesManifest({ pieceEntries: pieces, outDir: indexDir, mode: 'code', indexState })); }
  finally { await logger.close(); }
  assert.equal(progressLines, 1);
  const publicationValidation = await writeArtifactPublicationValidationReport({ buildRoot, outDir: indexDir, mode: 'code', buildId, pieceEntries: pieces, manifestPath });
  await writeArtifactPublicationRecord({ buildRoot, outDir: indexDir, mode: 'code', stage: 'stage2', buildId,
    pieceEntries: pieces, manifestPath, publicationValidation });
  const buildOptions = { mode: 'code', include: ['calls'], maxFiles: files, maxMembersPerFile: members, maxEdges: files * members };
  const full = await buildCodeMap({ repoRoot, indexDir, options: buildOptions });
  assert.deepEqual(full.summary.counts, { files, members: files * members, edges: files * members });
  assert.equal(full.summary.truncated, false); assert.deepEqual(full.summary.dropped, { files: 0, members: 0, edges: 0 });
  for (const node of full.nodes) {
    assert.equal(node.members.length, members);
    assert.deepEqual(new Set(node.members.map(row => row.name)), new Set(Array.from({ length: members }, (_, index) => `f${index}`)));
  }
  const capped = await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code', include: ['calls'] } });
  assert.equal(capped.summary.counts.files, 200); assert.equal(capped.summary.counts.members, 12000);
  assert.ok(capped.summary.counts.edges <= 3000); assert.equal(capped.summary.truncated, true);
  const capture = { schemaVersion: 1, repoRoot, indexDir, buildOptions, expectedCounts: full.summary.counts,
    expectedSections: full.sectionHashes, sourceSha256: sourceHash.digest('hex'),
    inputPolicy: 'authored-source-and-canonical-published-index-facts;actual-map-builder;not-parser/compiler-throughput',
    capped: capped.summary, full: full.summary };
  const file = path.join(root, 'builder-capture.json'); await atomicWriteJson(file, capture, { createOnly: true });
  const read = await readVerifiedContainedFile(root, file, { maxBytes: 65536 });
  console.log(JSON.stringify({ descriptor: { file, bytes: read.buffer.byteLength, sha256: read.hash }, capture }));
} else {
  assert.equal(request.command, 'observe'); assert.equal(path.dirname(request.capture.file), root);
  const loaded = await readVerifiedContainedFile(root, request.capture.file, { maxBytes: 65536,
    expectedBytes: request.capture.bytes, expectedHash: request.capture.sha256 });
  const capture = JSON.parse(loaded.buffer);
  assert.equal(capture.repoRoot, path.join(workRoot, 'repo')); assert.equal(capture.indexDir, path.join(workRoot, 'build/index-code'));
  const report = await runMapBenchWorker({ operation: 'build', repoRoot: capture.repoRoot, indexDir: capture.indexDir, buildOptions: capture.buildOptions });
  assert.deepEqual(report.workload.counts, capture.expectedCounts); assert.deepEqual(report.workload.sectionHashes, capture.expectedSections);
  assert.equal(report.workload.truncated, false); assert.equal(report.buildMetrics.memoryObservation.includesFinalModel, true);
  assert.equal(report.memory.processLifetimeRss.state, 'observed');
  console.log(JSON.stringify({ capture, report }));
}
