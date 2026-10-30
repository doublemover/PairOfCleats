import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { enqueueSymbolsArtifacts } from '../../../src/index/build/artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from '../../../src/index/build/artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from '../../../src/index/build/artifacts/writers/symbol-edges.js';
import { enqueueCallSitesArtifacts } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { createSymbolArtifactChunks } from '../../indexing/artifacts/symbols/helpers/symbol-artifact-fixture.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { logicalPayloadRows } from '../../../tools/index/stats-artifacts.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('symbol-family-logical-counts');
const env = applyTestEnv({ extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const [alpha, beta] = createSymbolArtifactChunks();
const chunks = [...Array.from({ length: 4 }, (_, id) => {
  const row = structuredClone(alpha), uid = `uid-alpha-${id}`;
  row.name = `alpha-${id}`; row.chunkUid = uid; row.metaV2.chunkUid = uid;
  row.metaV2.symbol = { ...row.metaV2.symbol, chunkUid: uid, symbolId: `sym:${uid}`, qualifiedName: row.name };
  row.codeRelations.callLinks[0].fromChunkUid = uid; row.codeRelations.usageLinks[0].fromChunkUid = uid;
  return row;
}), beta];
const writers = [
  ['symbols', 'symbols', enqueueSymbolsArtifacts, 5],
  ['symbol_occurrences', 'symbolOccurrences', enqueueSymbolOccurrencesArtifacts, 8],
  ['symbol_edges', 'symbolEdges', enqueueSymbolEdgesArtifacts, 8],
  ['call_sites', 'callSites', enqueueCallSitesArtifacts, 4]
];
const write = async (outDir, writer, maxJsonBytes) => {
  await fs.mkdir(outDir, { recursive: true }); const tasks = [], pieces = [];
  await writer({ state: { chunks }, outDir, maxJsonBytes, compression: null,
    enqueueWrite: (_label, job) => tasks.push(job),
    addPieceFile: (entry, filename) => pieces.push({ ...entry, path: path.relative(outDir, filename).replaceAll('\\', '/') }),
    formatArtifactLabel: filename => filename });
  for (const job of tasks) await job();
  for (const piece of pieces) piece.bytes = (await fs.stat(path.join(outDir, piece.path))).size;
  return pieces;
};
try {
  const indexDir = path.join(dir, 'index-code'); await fs.mkdir(indexDir);
  const pieces = [];
  for (const [family, _field, writer, expected] of writers) {
    const first = path.join(dir, family), original = await write(first, writer, null);
    const data = original.find(piece => piece.name === family);
    const rows = (await fs.readFile(path.join(first, data.path), 'utf8')).trimEnd().split('\n');
    assert.equal(rows.length, expected, family + ' actual unsharded rows');
    const maxLine = Math.max(...rows.map(line => Buffer.byteLength(line) + 1));
    const sharded = await write(indexDir, writer, maxLine * 2);
    const payload = sharded.filter(piece => piece.name === family);
    assert.ok(payload.length > 1, family + ' actual writer must produce multiple disjoint parts');
    assert.ok(Math.max(...payload.map(piece => piece.count)) < expected);
    assert.equal(logicalPayloadRows(sharded, family), expected); pieces.push(...sharded);
  }
  await fs.mkdir(path.join(indexDir, 'pieces'));
  const manifestPath = path.join(indexDir, 'pieces/manifest.json');
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces };
  const run = async () => {
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const result = await spawnSubprocess(process.execPath, [path.resolve('tools/index/stats.js'), '--index-dir', indexDir, '--json'],
      { env, timeoutMs: 5000, maxOutputBytes: 512 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.equal(result.exitCode, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const report = await run();
  for (const [_family, field, _writer, expected] of writers) assert.equal(report.modes.code[field].rows, expected, field);
  const selected = pieces.find(piece => piece.name === 'symbols'), count = selected.count;
  for (const invalid of [undefined, null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    selected.count = invalid; assert.equal((await run()).modes.code.symbols.rows, null);
  }
  selected.count = count;
  assert.equal(logicalPayloadRows([{ ...selected, count: Number.MAX_SAFE_INTEGER },
    { ...selected, path: 'symbols.part-999999.jsonl', count: 1 }], 'symbols'), null);
  const one = { name: 'file_meta', path: 'file_meta.json', count: 0 };
  assert.equal(logicalPayloadRows([one], 'file_meta'), 0);
  assert.equal(logicalPayloadRows([one, { ...one, path: 'file_meta.json.gz' },
    { ...one, name: 'file_meta_offsets', count: 99 }], 'file_meta'), 0);
  assert.equal(logicalPayloadRows([{ ...one, count: 5 }, { ...one, path: 'file_meta.columnar.json', count: 5 }], 'file_meta'), 5);
  assert.equal(logicalPayloadRows([{ ...one, count: 5 }, { ...one, path: 'file_meta.columnar.json', count: 4 }], 'file_meta'), null);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Actual sharded symbol/call writers feed exact logical totals through the stats CLI and retain unknown counts.');
