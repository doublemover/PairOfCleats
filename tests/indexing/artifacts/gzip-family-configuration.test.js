import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { gunzipSync } from 'node:zlib';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('gzip-family-configuration');
const streams = new URL('../../../src/shared/json-stream/streams.js', import.meta.url).href;
const compression = new URL('../../../src/shared/json-stream/compress.js', import.meta.url).href;
const route = 'gzip-family-observation:real-codec';
const calls = []; globalThis.gzipFamilyObservation = calls;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL === streams && specifier === './compress.js') return { url: route, shortCircuit: true };
  return next(specifier, context);
}, load(url, context, next) {
  if (url === route) return { format: 'module', shortCircuit: true, source: `
    export * from ${JSON.stringify(compression)};
    import {createFflateGzipStream as real,normalizeGzipOptions} from ${JSON.stringify(compression)};
    export const createFflateGzipStream=options=>{
      globalThis.gzipFamilyObservation.push({raw:structuredClone(options.gzipOptions),effective:normalizeGzipOptions(options.gzipOptions)});
      return real(options);
    };` };
  return next(url, context);
} });
try {
  const { enqueueRepoMapArtifacts, measureRepoMap } = await import('../../../src/index/build/artifacts/repo-map.js');
  const { enqueueTokenPostingsArtifacts } = await import('../../../src/index/build/artifacts/token-postings.js');
  const { resolveCompressionConfig } = await import('../../../src/index/build/artifacts/compression.js');
  const mtime = 1600000000000;
  const variants = [{ name: 'default', input: null, level: 6 }, ...[0, 1, 9].map(level => ({ name: `level-${level}`, input: { level, mem: 4, mtime }, level })),
    { name: 'low-clamped', input: { level: -2, ignored: true, mtime }, level: 0 },
    { name: 'high-clamped', input: { level: 12, mtime }, level: 9 }];
  const mapRows = Array.from({ length: 256 }, (_, id) => ({ file: `src/${id}.js`, name: `symbol-${id}`, kind: 'function',
    signature: ('long repeated signature with Unicode 雪😀 ' + id).repeat(16), startLine: 1, endLine: 2 }));
  const vocab = mapRows.map((_, id) => `token-${id}`), postings = vocab.map((_, id) => [[id, 1]]);
  const observations = [];
  for (const variant of variants) for (const family of ['repo-map-json', 'token-json-shards']) {
    const outDir = path.join(dir, `${variant.name}-${family}`); await fs.mkdir(outDir);
    const config = resolveCompressionConfig({ artifactCompression: { enabled: true, mode: 'gzip', gzipOptions: variant.input } });
    const originalOptions = structuredClone(config.compressionGzipOptions);
    const queue = [], pieces = [], before = calls.length;
    const hooks = { enqueueWrite: (_label, action) => queue.push(action), addPieceFile: piece => pieces.push(piece),
      formatArtifactLabel: value => value, log() {}, removeArtifact: target => fs.rm(target, { force: true, recursive: true }) };
    if (family === 'repo-map-json') {
      const repoMapIterator = () => mapRows;
      await enqueueRepoMapArtifacts({ outDir, ...hooks, repoMapIterator, useRepoMapJsonl: false,
        repoMapMeasurement: measureRepoMap({ repoMapIterator, maxJsonBytes: 1024 * 1024 }),
        repoMapCompression: 'gzip', compressionGzipOptions: config.compressionGzipOptions });
    } else await enqueueTokenPostingsArtifacts({ outDir, ...hooks,
      postings: { tokenVocab: vocab, tokenPostingsList: postings, avgDocLen: 1 }, state: { docLengths: vocab.map(() => 1) },
      tokenPostingsFormat: 'json', tokenPostingsUseShards: true, tokenPostingsShardSize: 100,
      tokenPostingsCompression: 'gzip', compressionGzipOptions: config.compressionGzipOptions });
    const start = performance.now(), cpu = process.cpuUsage();
    for (const action of queue) await action();
    const sample = { family, variant: variant.name, elapsedMs: performance.now() - start, cpu: process.cpuUsage(cpu) };
    const observed = calls.slice(before); assert.equal(observed.length, family === 'repo-map-json' ? 1 : 3);
    for (const call of observed) {
      assert.deepEqual(call.raw, call.effective); assert.equal(call.effective.level, variant.level);
      assert.equal(Object.hasOwn(call.effective, 'ignored'), false);
    }
    assert.deepEqual(config.compressionGzipOptions, originalOptions, 'normalization never changes the caller config');
    const files = family === 'repo-map-json' ? [path.join(outDir, 'repo_map.json.gz')]
      : (await fs.readdir(path.join(outDir, 'token_postings.shards'))).sort().map(name => path.join(outDir, 'token_postings.shards', name));
    const decoded = []; let encodedBytes = 0, decodedBytes = 0;
    for (const file of files) {
      const bytes = await fs.readFile(file), plain = gunzipSync(bytes); encodedBytes += bytes.length; decodedBytes += plain.length;
      assert.equal(bytes.readUInt32LE(4), variant.input?.mtime ? mtime / 1000 : 0);
      decoded.push(JSON.parse(plain));
    }
    if (family === 'repo-map-json') assert.deepEqual(decoded[0], mapRows);
    else {
      assert.deepEqual(decoded.flatMap(part => part.vocab), vocab);
      assert.deepEqual(decoded.flatMap(part => part.postings), postings);
      const meta = JSON.parse(await fs.readFile(path.join(outDir, 'token_postings.meta.json'), 'utf8'));
      assert.deepEqual(meta.docLengths, vocab.map(() => 1), 'shared document lengths retain their authoritative metadata owner');
    }
    observations.push({ ...sample, encodedBytes, decodedBytes, codecCalls: observed.length });
  }
  for (const family of ['repo-map-json', 'token-json-shards']) {
    const samples = observations.filter(row => row.family === family);
    assert.ok(samples.find(row => row.variant === 'level-9').encodedBytes < samples.find(row => row.variant === 'level-0').encodedBytes);
  }
  const mutable = { level: 1, mtime }, concurrent = [], before = calls.length;
  for (const level of [1, 9]) {
    mutable.level = level;
    const outDir = path.join(dir, `concurrent-${level}`); await fs.mkdir(outDir);
    const hooks = { enqueueWrite: (_label, action) => concurrent.push(action), addPieceFile() {},
      formatArtifactLabel: value => value, log() {}, removeArtifact: target => fs.rm(target, { force: true, recursive: true }) };
    const repoMapIterator = () => mapRows;
    await enqueueRepoMapArtifacts({ outDir, ...hooks, repoMapIterator, useRepoMapJsonl: false,
      repoMapMeasurement: measureRepoMap({ repoMapIterator, maxJsonBytes: 1024 * 1024 }),
      repoMapCompression: 'gzip', compressionGzipOptions: mutable });
    await enqueueTokenPostingsArtifacts({ outDir, ...hooks,
      postings: { tokenVocab: vocab, tokenPostingsList: postings, avgDocLen: 1 }, state: { docLengths: vocab.map(() => 1) },
      tokenPostingsFormat: 'json', tokenPostingsUseShards: true, tokenPostingsShardSize: 100,
      tokenPostingsCompression: 'gzip', compressionGzipOptions: mutable });
  }
  mutable.level = 0; // queued owners already captured their effective options
  await Promise.all(concurrent.map(action => action()));
  assert.equal(calls.slice(before).filter(call => call.effective.level === 1).length, 4);
  assert.equal(calls.slice(before).filter(call => call.effective.level === 9).length, 4);
  assert.ok(calls.slice(before).every(call => call.effective.mtime === mtime));
  console.log(JSON.stringify({ kind: 'serial-family-codec-observations', scope: 'configured-family correctness and bounded codec work; no full-index speedup', samples: observations }));
} finally { hook.deregister(); delete globalThis.gzipFamilyObservation; await fs.rm(dir, { recursive: true, force: true }); }
