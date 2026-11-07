import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createSymbolArtifactChunks, runSymbolArtifactWriters } from './helpers/symbol-artifact-fixture.js';
import { enqueueCallSitesArtifacts } from '../../../../src/index/build/artifacts/writers/call-sites.js';
import { loadJsonArrayArtifact } from '../../../../src/shared/artifact-io/loaders/core.js';
import { loadSymbolEdgesByFile, loadSymbolOccurrencesByFile } from '../../../../src/shared/artifact-io/loaders/per-file.js';
import { writePiecesManifest } from '../../../helpers/artifact-io-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('symbol-path-identity-consumer');
const paths = [' leading.js', 'trailing.js ', 'src/two  spaces.js', 'src/two spaces.js', 'src/雪  λ.js'];
const base = createSymbolArtifactChunks()[0];
const chunks = [...paths, ''].map((file, index) => {
  const chunk = structuredClone(base), uid = `uid-${index}`;
  chunk.file = file; chunk.chunkUid = uid; chunk.name = '  ordinary prose name  ';
  chunk.metaV2.file = file; chunk.metaV2.virtualPath = file ? `${file}#virtual  segment ` : '';
  chunk.metaV2.chunkUid = uid;
  for (const detail of chunk.codeRelations.callDetails) Object.assign(detail, { startLine: 1, startCol: 1, endLine: 1, endCol: 5 });
  chunk.metaV2.symbol = { ...chunk.metaV2.symbol, symbolId: `symbol-${index}`, scopedId: `scope-${index}`,
    symbolKey: `key-${index}`, qualifiedName: '  qualified prose name  ' };
  return chunk;
});
try {
  for (const maxJsonBytes of [null, 1024]) {
    const outDir = path.join(dir, maxJsonBytes ? 'shards' : 'ordinary'); await fs.mkdir(outDir);
    const result = await runSymbolArtifactWriters({ outDir, chunks, maxJsonBytes, useFileIndex: true });
    const writes = [], callPieces = [];
    await enqueueCallSitesArtifacts({ state: { chunks }, outDir, maxJsonBytes,
      enqueueWrite: (_name, job) => writes.push(job), addPieceFile: (entry, filePath) => callPieces.push({ entry, filePath }),
      formatArtifactLabel: name => name });
    for (const write of writes) await write();
    await fs.writeFile(path.join(outDir, 'file_meta.json'), JSON.stringify(result.fileMeta));
    await writePiecesManifest(outDir, [...result.pieceEntries, ...callPieces].map(({ entry, filePath }) => ({
      ...entry, path: path.relative(outDir, filePath).replaceAll('\\', '/')
    })).concat([{ name: 'file_meta', path: 'file_meta.json', format: 'json' }]));
    const symbols = await loadJsonArrayArtifact(outDir, 'symbols');
    const calls = await loadJsonArrayArtifact(outDir, 'call_sites');
    assert.equal(symbols.length, paths.length); assert.equal(calls.length, paths.length);
    const digest = value => createHash('sha256').update(Buffer.from(value)).digest('hex');
    for (const [index, file] of paths.entries()) {
      const symbol = symbols.find(row => row.chunkUid === `uid-${index}`);
      assert.equal(symbol.file, file); assert.equal(symbol.virtualPath, `${file}#virtual  segment `);
      assert.equal(digest(symbol.file), digest(file));
      assert.equal(symbol.qualifiedName, 'qualified prose name', 'prose normalization stays separate');
      const call = calls.find(row => row.callerChunkUid === `uid-${index}`);
      assert.equal(call.file, file); assert.equal(digest(call.file), digest(file));
      const fileId = result.fileIdByPath.get(file); assert.ok(Number.isInteger(fileId));
      const occurrences = await loadSymbolOccurrencesByFile(outDir, { filePath: file });
      const edges = await loadSymbolEdgesByFile(outDir, { fileId });
      assert.ok(occurrences.length > 0); assert.ok(edges.length > 0);
      assert.ok(occurrences.every(row => row.host.file === file && row.host.chunkUid === symbol.chunkUid));
      assert.ok(edges.every(row => row.from.file === file && row.from.chunkUid === symbol.chunkUid));
    }
    assert.equal(new Set(symbols.map(row => row.file)).size, paths.length, 'interior whitespace paths cannot collide');
    assert.deepEqual(await loadSymbolOccurrencesByFile(outDir, { filePath: 'missing.js' }), []);
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual ordinary/sharded symbol, relation and call-site writes preserve exact paths through indexed reader joins.');
