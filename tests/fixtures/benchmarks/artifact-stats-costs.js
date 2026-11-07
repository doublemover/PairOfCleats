import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { enqueueSymbolsArtifacts } from '../../../src/index/build/artifacts/writers/symbols.js';
import { logicalPayloadRows } from '../../../tools/index/stats-artifacts.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { createSymbolArtifactChunks } from '../../indexing/artifacts/symbols/helpers/symbol-artifact-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sampleCosts = async (operation, verify, iterations) => {
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const cpu = process.cpuUsage(), start = performance.now();
    const result = await operation();
    const wallMs = performance.now() - start, used = process.cpuUsage(cpu);
    verify(result);
    samples.push({ wallMs, cpuUserMicros: used.user, cpuSystemMicros: used.system });
  }
  return { iterations, samples, scope: 'same-process CPU;wall includes awaited IO;assertions excluded;uninstrumented' };
};

// Importing this scenario never changes the environment or starts bootstrap.
export const runScenario = async ({ destination }) => {
  const fixture = path.join(destination, 'stats-input');
  await fs.mkdir(fixture, { recursive: false });
  const env = applyTestEnv({ syncProcess: false, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const [template] = createSymbolArtifactChunks();
  const chunks = Array.from({ length: 129 }, (_, id) => {
    const chunk = structuredClone(template), uid = `uid-${String(id).padStart(4, '0')}`;
    chunk.chunkUid = uid; chunk.metaV2.chunkUid = uid;
    chunk.metaV2.symbol = { ...chunk.metaV2.symbol, chunkUid: uid, symbolId: `sym:${uid}` };
    return chunk;
  });
  const write = async (outDir, maxJsonBytes) => {
    await fs.mkdir(outDir, { recursive: true });
    const jobs = [], pieces = [];
    await enqueueSymbolsArtifacts({ state: { chunks }, outDir, maxJsonBytes,
      enqueueWrite: (_label, job) => jobs.push(job),
      addPieceFile: (entry, filename) => pieces.push({ ...entry, path: path.relative(outDir, filename).replaceAll('\\', '/') }),
      formatArtifactLabel: filename => filename });
    for (const job of jobs) await job();
    for (const piece of pieces) piece.bytes = (await fs.stat(path.join(outDir, piece.path))).size;
    return pieces;
  };
  const observations = [];
  try {
    const singleDir = path.join(fixture, 'single', 'index-code');
    const single = await write(singleDir, null);
    const payloadBytes = await fs.readFile(path.join(singleDir, single.find(row => row.name === 'symbols').path));
    const lines = payloadBytes.toString('utf8').trimEnd().split('\n');
    assert.equal(lines.length, 129);
    const cap = Math.max(...lines.map(line => Buffer.byteLength(line) + 1)) * 8;
    for (const [shape, outDir, maxJsonBytes, ready] of [
      ['single', singleDir, null, single],
      ['many', path.join(fixture, 'many', 'index-code'), cap, null]
    ]) {
      const pieces = ready || await write(outDir, maxJsonBytes);
      const payload = pieces.filter(row => row.name === 'symbols');
      assert.equal(payload.length === 1, shape === 'single');
      if (shape === 'many') assert.ok(new Set(payload.map(row => row.count)).size > 1, 'real producer emits an uneven final shard');
      const sourceRows = [];
      for (const piece of payload) sourceRows.push(await fs.readFile(path.join(outDir, piece.path)));
      assert.equal(sha256(Buffer.concat(sourceRows)), sha256(payloadBytes), 'shard layout preserves exact actual producer rows');
      const work = { piecesVisited: 0, propertyReads: {}, countReads: 0 };
      const observed = pieces.map(piece => new Proxy(piece, { get(target, key, receiver) {
        if (typeof key === 'string') work.propertyReads[key] = (work.propertyReads[key] || 0) + 1;
        if (key === 'name') work.piecesVisited++;
        if (key === 'count') work.countReads++;
        return Reflect.get(target, key, receiver);
      } }));
      assert.equal(logicalPayloadRows(observed, 'symbols'), 129);
      assert.equal(work.piecesVisited, pieces.length);
      assert.equal(work.countReads, payload.length, 'only logical payload counts are read');
      await fs.mkdir(path.join(outDir, 'pieces'));
      await fs.writeFile(path.join(outDir, 'pieces', 'manifest.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces }));
      const cliStart = performance.now();
      const cli = await spawnSubprocess(process.execPath,
        [path.resolve('tools/index/stats.js'), '--index-dir', outDir, '--json'],
        { env, timeoutMs: 5000, maxOutputBytes: 512 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
      assert.equal(cli.exitCode, 0, cli.stderr);
      assert.equal(JSON.parse(cli.stdout).modes.code.symbols.rows, 129);
      const cliWallMs = performance.now() - cliStart;
      const cleanConsumer = await sampleCosts(() => logicalPayloadRows(pieces, 'symbols'), result => assert.equal(result, 129), 16);
      const consumer = await observeHeapAllocations({ destination, name: `stats-${shape}-consumer`, iterations: 64,
        operation: () => logicalPayloadRows(pieces, 'symbols') });
      // Actual writer plus queued physical writes: no mock producer or row oracle.
      const cleanProducer = await sampleCosts(() => write(outDir, maxJsonBytes),
        result => assert.equal(logicalPayloadRows(result, 'symbols'), 129), 2);
      const producer = await observeHeapAllocations({ destination, name: `stats-${shape}-producer`, iterations: 2,
        operation: () => write(outDir, maxJsonBytes) });
      const finalRows = [];
      for (const piece of payload) finalRows.push(await fs.readFile(path.join(outDir, piece.path)));
      assert.equal(sha256(Buffer.concat(finalRows)), sha256(payloadBytes));
      observations.push({ shape, inputIdentity: { sha256: sha256(payloadBytes), bytes: payloadBytes.length, rows: 129 },
        manifestPieces: pieces.length, logicalParts: payload.length, shardCounts: payload.map(row => row.count), work,
        actualStatsCli: { rows: 129, wallMs: cliWallMs, outputSha256: sha256(cli.stdout), cpu: 'not-observed-in-child' },
        cleanConsumer, cleanProducer, consumer, producer });
    }
    return { issue: 1751, claim: 'bounded local correctness/work observations;no throughput gain claim', observations };
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
};
