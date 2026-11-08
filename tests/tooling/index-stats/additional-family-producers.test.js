import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { createLoggerScope } from '../../../src/shared/progress-runtime.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { logicalPayloadRows } from '../../../tools/index/stats-artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('stats-additional-producers');
const env = applyTestEnv({ extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const selectedShape = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/index-stats/additional-family-producers/')[1];
assert.ok(['json', 'sharded', 'columnar'].includes(selectedShape));
const logger = createLoggerScope();
const messages = [];
logger.setProgressHandlers({ log(message) { assert.ok(messages.length < 2000); messages.push(message); } });
const names = Array.from({ length: 7 }, (_, id) => 'src/file-' + id + '.js');
const graph = count => ({ nodeCount: count, edgeCount: 0,
  nodes: Array.from({ length: count }, (_, id) => ({ id: 'node-' + id, out: [], in: [] })) });
let primary, failed = false;
try {
  await fs.mkdir(path.join(dir, 'src'));
  const chunks = [], fileInfoByPath = new Map();
  for (const [id, file] of names.entries()) {
    const text = `export function f${id}() { return 'alpha beta gamma'; }\n`;
    const hash = createHash('sha1').update(text).digest('hex');
    await fs.writeFile(path.join(dir, file), text);
    const chunk = { id, file, ext: '.js', name: 'f' + id, kind: 'FunctionDeclaration',
      text, start: 0, end: text.length, startLine: 1, endLine: 1,
      tokens: ['alpha', 'beta', 'gamma'], tokenCount: 3, fileHash: hash, fileHashAlgo: 'sha1', fileSize: Buffer.byteLength(text) };
    await prepareChunkIds({ chunks: [chunk], text, relKey: file, containerExt: '.js', containerLanguageId: 'javascript',
      lineIndex: buildLineIndex(text), fileHash: hash, fileHashAlgo: 'sha1', vfsManifestConcurrency: 1, strict: true });
    chunks.push(chunk); fileInfoByPath.set(file, { size: Buffer.byteLength(text), hash, hashAlgo: 'sha1' });
  }
  for (const shape of [selectedShape]) {
    const outDir = path.join(dir, shape, 'index-code'); await fs.mkdir(outDir, { recursive: true });
    const postings = await buildPostings({ chunks, df: new Map(['alpha', 'beta', 'gamma'].map(token => [token, 7])),
      tokenPostings: new Map(['alpha', 'beta', 'gamma'].map(token => [token, names.map((_, id) => [id, 1])])),
      docLengths: names.map(() => 3), fieldPostings: {}, fieldDocLengths: {},
      phrasePost: new Map([['alpha beta', [0, 1]], ['beta gamma', [2, 3]], ['gamma alpha', [4, 5, 6]]]),
      triPost: new Map([['alp', [0]], ['bet', [1, 2]], ['gam', [3, 4]], ['pha', [5, 6]]]),
      postingsConfig: {}, embeddingsEnabled: false, modelId: 'stub', useStubEmbeddings: true, log() {} });
    assert.equal(postings.phraseVocab.length, 3); assert.equal(postings.chargramVocab.length, 4);
    // Exercise the actual binary publisher, independently of model inference.
    Object.assign(postings, { dims: 3, quantizedVectors: names.map((_, id) => new Uint8Array([id, 127, 255])),
      quantizedDocVectors: Array.from({ length: 9 }, () => new Uint8Array([1, 2, 3])),
      quantizedCodeVectors: [new Uint8Array([4, 5, 6]), new Uint8Array([7, 8, 9])] });
    const state = { chunks: structuredClone(chunks), scannedFilesTimes: [], scannedFiles: names, skippedFiles: [], totalTokens: 21,
      fileRelations: new Map(), fileInfoByPath, fileDetailsByPath: new Map(), chunkUidToFile: new Map(),
      docLengths: names.map(() => 3), vfsManifestRows: [], vfsManifestCollector: null, fieldTokens: [], importResolutionGraph: null };
    await logger.run(() => writeIndexArtifacts({ root: dir, outDir, mode: 'code', state, postings,
      postingsConfig: {}, modelId: 'stub', useStubEmbeddings: true, dictSummary: null,
      timing: { start: Date.now() }, incrementalEnabled: false, fileCounts: { candidates: 7 }, perfProfile: null,
      userConfig: { indexing: { scm: { provider: 'none' }, artifacts: {
        fileMetaFormat: shape === 'sharded' ? 'jsonl' : shape, fileMetaColumnarThresholdBytes: 1,
        fileMetaShardedMaxBytes: 650,
        ...(shape === 'sharded' ? { byteBudgets: { graph_relations: { maxBytes: 200, overflow: 'shard' } } } : {})
      } } }, indexState: { buildId: 'stats-family-' + shape, mode: 'code', counts: { files: 7, chunks: 7 },
        generatedAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z' },
      graphRelations: { version: 2, callGraph: graph(7), usageGraph: graph(2), importGraph: graph(1) }, stageCheckpoints: null }));
    const manifestPath = path.join(outDir, 'pieces/manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const pieces = manifest.pieces;
    const files = await loadJsonArrayArtifact(outDir, 'file_meta', { manifest, strict: true });
    assert.deepEqual(files.map(row => row.file), names); assert.equal(logicalPayloadRows(pieces, 'file_meta'), 7);
    const filePieces = pieces.filter(row => row.name === 'file_meta');
    if (shape === 'sharded') {
      assert.ok(filePieces.length > 1); assert.ok(Math.max(...filePieces.map(row => row.count)) < 7);
      const rows = [];
      for (const piece of pieces.filter(row => row.name === 'graph_relations')) {
        rows.push(...(await fs.readFile(path.join(outDir, piece.path), 'utf8')).trim().split('\n').map(JSON.parse));
      }
      assert.deepEqual(rows.map(row => row.graph + '/' + row.node.id),
        ['callGraph', 'usageGraph', 'importGraph'].flatMap((name, index) =>
          Array.from({ length: [7, 2, 1][index] }, (_, id) => name + '/node-' + id)));
      assert.ok(pieces.filter(row => row.name === 'graph_relations').length > 1);
      assert.equal(logicalPayloadRows(pieces, 'graph_relations'), 10);
    } else {
      assert.equal(filePieces.length, 1);
      assert.equal(logicalPayloadRows(pieces, 'graph_relations'), null, 'an uncounted object envelope remains unknown');
    }
    const phrase = JSON.parse(await fs.readFile(path.join(outDir, 'phrase_ngrams.json'), 'utf8'));
    const chargram = JSON.parse(await fs.readFile(path.join(outDir, 'chargram_postings.json'), 'utf8'));
    assert.deepEqual(phrase.vocab, ['alpha beta', 'beta gamma', 'gamma alpha']);
    assert.deepEqual(chargram.vocab, ['alp', 'bet', 'gam', 'pha']);
    assert.deepEqual(await fs.readFile(path.join(outDir, 'dense_vectors_uint8.bin')), Buffer.from(names.flatMap((_, id) => [id, 127, 255])));
    const run = async () => {
      const result = await spawnSubprocess(process.execPath, [path.resolve('tools/index/stats.js'), '--index-dir', outDir, '--json'],
        { env, timeoutMs: 5000, maxOutputBytes: 512 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, '');
      return JSON.parse(result.stdout).modes.code;
    };
    const report = await run();
    assert.equal(report.fileMeta.rows, 7); assert.equal(report.graphRelations.rows, shape === 'sharded' ? 10 : null);
    assert.equal(report.phraseNgrams.rows, 3); assert.equal(report.chargramPostings.rows, 4);
    assert.equal(report.embeddings.denseVectors.count, 7, 'doc9/code2 and repeated binary metadata cannot replace/add to primary7');
    const primaryDense = pieces.find(piece => piece.name === 'dense_vectors');
    const meta = pieces.find(piece => piece.name === 'dense_vectors_binary_meta');
    assert.equal(primaryDense.count, 7); assert.equal(meta.count, 7);
    for (const family of ['file_meta', 'phrase_ngrams', 'chargram_postings', 'dense_vectors', ...(shape === 'sharded' ? ['graph_relations'] : [])]) {
      const selected = pieces.find(piece => piece.name === family), count = selected.count;
      delete selected.count; await fs.writeFile(manifestPath, JSON.stringify(manifest));
      const unknown = await run(), value = family === 'dense_vectors' ? unknown.embeddings.denseVectors.count
        : unknown[{ file_meta: 'fileMeta', phrase_ngrams: 'phraseNgrams', chargram_postings: 'chargramPostings', graph_relations: 'graphRelations' }[family]].rows;
      assert.equal(value, null, family + ' cannot infer unknown cardinality from metadata/other shards'); selected.count = count;
    }
  }
} catch (error) { primary = error; failed = true; }
finally {
  for (const [phase, operation] of [['stats-logger-close', () => logger.close()], ['stats-fixture-cleanup', () => fs.rm(dir, { recursive: true, force: true })]]) {
    try { await operation(); }
    catch (cleanup) { primary = failed ? addStorageFailureContext(primary, { phase }, cleanup, { secondaryPresent: true }) : cleanup; failed = true; }
  }
}
if (failed) throw primary;
console.log('Actual graph/file/vocabulary/dense publishers retain logical stats through JSON/shards/columnar and unknown-count negatives.');
