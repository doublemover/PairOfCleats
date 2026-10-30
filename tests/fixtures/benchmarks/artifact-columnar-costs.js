import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildColumnarChunkMetaFromRows } from '../../../src/index/build/artifacts/writers/chunk-meta/iterator.js';
import { inflateColumnarRows, iterateColumnarRows } from '../../../src/shared/artifact-io/columnar-rows.js';
import { loadJsonArrayArtifact, loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const collect = async rows => { const out = []; for await (const row of rows) out.push(row); return out; };
const sampleCosts = async (operation, verify) => {
  const samples = [];
  for (let iteration = 0; iteration < 4; iteration++) {
    const cpu = process.cpuUsage(), start = performance.now();
    const result = await operation();
    const wallMs = performance.now() - start, used = process.cpuUsage(cpu);
    verify(result);
    samples.push({ wallMs, cpuUserMicros: used.user, cpuSystemMicros: used.system });
  }
  return { iterations: 4, samples, scope: 'same-process CPU;wall includes awaited IO;assertions excluded;uninstrumented' };
};
const observeEnvelope = payload => {
  const work = { envelopeReads: {}, columnVisits: 0, extentReads: 0, cellReads: 0 };
  const arrays = Object.fromEntries(payload.columns.map(column => [column, new Proxy(payload.arrays[column], {
    get(target, key, receiver) {
      if (key === 'length') work.extentReads++;
      else if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) work.cellReads++;
      return Reflect.get(target, key, receiver);
    }
  })]));
  const columns = new Proxy(payload.columns, { get(target, key, receiver) {
    if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) work.columnVisits++;
    return Reflect.get(target, key, receiver);
  } });
  return { work, payload: new Proxy({ ...payload, arrays, columns }, { get(target, key, receiver) {
    if (typeof key === 'string') work.envelopeReads[key] = (work.envelopeReads[key] || 0) + 1;
    return Reflect.get(target, key, receiver);
  } }) };
};

export const runScenario = async ({ destination }) => {
  const fixture = path.join(destination, 'columnar-input'); await fs.mkdir(fixture);
  const observations = [];
  try {
    for (const [shape, rowCount, columnCount] of [['small', 8, 4], ['wide', 128, 128]]) {
      const rows = Array.from({ length: rowCount }, (_, id) => Object.fromEntries([
        ['id', id], ['file', `src/${id}.js`],
        ...Array.from({ length: columnCount - 2 }, (_, index) => [`value${index}`, id === 0 ? null : `${id}:${index}`])
      ]));
      const payload = buildColumnarChunkMetaFromRows(rows), bytes = Buffer.from(JSON.stringify(payload));
      assert.equal(payload.columns.length, columnCount); assert.equal(payload.length, rowCount);
      const work = {};
      for (const route of ['iterate', 'inflate']) {
        const observed = observeEnvelope(payload);
        if (route === 'iterate') {
          const iterator = iterateColumnarRows(observed.payload);
          assert.equal(observed.work.cellReads, 0, 'admission reads extents before touching cells');
          assert.deepEqual([...iterator], rows);
        } else assert.deepEqual(inflateColumnarRows(observed.payload), rows);
        assert.equal(observed.work.columnVisits, columnCount);
        assert.equal(observed.work.extentReads, columnCount);
        assert.equal(observed.work.cellReads, rowCount * columnCount, 'one value read per actual emitted cell');
        work[route] = observed.work;
      }
      const outDir = path.join(fixture, shape); await fs.mkdir(outDir);
      const filename = 'sample.columnar.json'; await fs.writeFile(path.join(outDir, filename), bytes);
      const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
        pieces: [{ name: 'sample', path: filename, format: 'columnar', count: rowCount,
          bytes: bytes.length, checksum: `sha256:${sha256(bytes)}` }] };
      const samples = {}, cleanCosts = {};
      for (const route of ['materialized-loader', 'stream-loader']) {
        const load = route === 'materialized-loader'
          ? () => loadJsonArrayArtifact(outDir, 'sample', { manifest })
          : () => collect(loadJsonArrayArtifactRows(outDir, 'sample', { manifest }));
        assert.deepEqual(await load(), rows);
        cleanCosts[route] = await sampleCosts(load, result => assert.deepEqual(result, rows));
        samples[route] = await observeHeapAllocations({ destination, name: `columnar-${shape}-${route}`, iterations: 4,
          operation: load });
      }
      cleanCosts.producer = await sampleCosts(() => buildColumnarChunkMetaFromRows(rows), result => assert.deepEqual(result, payload));
      const producer = await observeHeapAllocations({ destination, name: `columnar-${shape}-producer`, iterations: 4,
        operation: () => buildColumnarChunkMetaFromRows(rows) });
      assert.equal(sha256(await fs.readFile(path.join(outDir, filename))), sha256(bytes));
      observations.push({ shape, inputIdentity: { sha256: sha256(bytes), bytes: bytes.length },
        rows: rowCount, columns: columnCount, emittedCells: rowCount * columnCount, work, cleanCosts, samples, producer });
    }
    return { issue: 1753, claim: 'production extent admission and actual loader costs;no performance gain claim', observations };
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
};
