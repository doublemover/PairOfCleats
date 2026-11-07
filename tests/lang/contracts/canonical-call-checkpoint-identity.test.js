import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import nativeFs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalProjection } from '../../fixtures/benchmarks/native-projection-publication.js';
import { collectFileSemanticFacts } from '../../../src/index/semantic/collect-file.js';
import { collectSemanticOwnership } from '../../../src/index/semantic/ownership.js';
import { normalizeSemanticConfig } from '../../../src/index/semantic/config.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { enqueueCallSitesArtifacts } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { enqueueSemanticArtifacts } from '../../../src/index/build/artifacts/writers/semantic/family.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { readJsonLinesIterator } from '../../../src/shared/artifact-io/json.js';
import { createGraphStore } from '../../../src/graph/store.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('canonical-call-checkpoint-identity/')[1];
assert.ok(['exact', 'source', 'parser', 'policy', 'generation'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir('canonical-call-checkpoint-' + selected);
const buildId = 'call-checkpoint-generation', outDir = path.join(dir, buildId, 'index-code');
const buildRoot = path.dirname(outDir), semanticRoot = path.join(outDir, 'semantic');
const checkpointPath = path.join(outDir, 'call_sites.runs', 'merge-checkpoint.json');
const generation = { baseBuildId: buildId, semanticRevision: 0 };
const text = 'int caller(void) {\n' + Array.from({ length: 40 }, (_, index) => `target${index}();`).join('\n') + '\nreturn 0;\n}\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const account = createSemanticDiskAccount(32 * 1024 * 1024);
await fs.mkdir(semanticRoot, { recursive: true });

const prepare = async ({ source = text, nativeParserEnabled = true, languages = ['c'] } = {}) => {
  // Actual registered/native extraction, canonical UID/file hash/token payload
  // construction, native semantic retention and original occurrence ownership.
  const projected = await canonicalProjection('c', { text: source }, 'calls.c');
  assert.equal(projected.sites.length, 40);
  assert.equal(projected.fileHash, createHash('sha1').update(source).digest('hex'));
  assert.ok(projected.payloads.every((row, index) => row.chunkUid === projected.chunks[index].chunkUid
    && row.metaV2.chunkUid === row.chunkUid && row.fileHash === projected.fileHash));
  const policy = normalizeSemanticConfig({ enabled: true, profile: 'targeted', languages });
  const bytes = Buffer.from(source);
  const retained = await collectFileSemanticFacts({ bytes, text: source, language: 'c', relPath: 'calls.c',
    repositoryNamespace: buildRoot, stagingRoot: semanticRoot, diskAccount: account, policy, nativeParserEnabled });
  const facts = await collectSemanticOwnership({ facts: retained, chunks: projected.payloads, bytes,
    repositoryNamespace: buildRoot, stagingRoot: semanticRoot, diskAccount: account, policy,
    storage: { generation, relativePath: 'index-code/semantic' } });
  assert.equal(facts.sourceHash, hash(bytes));
  return { chunks: projected.payloads, semanticFactsByFile: new Map([['calls.c', facts]]),
    semanticDiskAccount: account, facts, source };
};
const enqueue = async (state, suppliedBuildId = buildId) => {
  const jobs = [], pieces = [];
  const addPieceFile = (entry, file) => pieces.push({ ...entry, path: path.relative(outDir, file).replaceAll('\\', '/') });
  const enqueueWrite = (_label, job) => jobs.push(job);
  await enqueueCallSitesArtifacts({ state, outDir, buildRoot, buildId: suppliedBuildId, maxJsonBytes: 4096,
    spillBufferRows: 1, spillBufferBytes: 1024, enqueueWrite, addPieceFile, formatArtifactLabel: value => value });
  return { jobs, pieces, enqueueWrite, addPieceFile };
};
const rowsOf = async pieces => {
  const rows = [];
  for (const piece of pieces.filter(row => row.name === 'call_sites')) {
    for await (const row of readJsonLinesIterator(path.join(outDir, piece.path))) rows.push(row);
  }
  return rows;
};
const assertRows = (rows, state, available) => {
  assert.equal(rows.length, 40); assert.equal(new Set(rows.map(row => row.callSiteId)).size, 40);
  const caller = state.chunks.find(row => row.name === 'caller'); assert.ok(caller);
  for (let index = 0; index < 40; index++) {
    const literal = `target${index}()`, start = state.source.indexOf(literal);
    const matches = rows.filter(row => row.calleeRaw === `target${index}`);
    assert.equal(matches.length, 1); const row = matches[0];
    assert.equal(row.callerChunkUid, caller.chunkUid); assert.equal(row.start, start);
    assert.equal(row.end, start + literal.length); assert.equal(row.extensions.syntax.coordinateSystem, 'utf16');
    assert.equal(row.extensions.semanticRef.status, available ? 'available' : 'unavailable');
    if (available) {
      assert.equal(row.extensions.semanticRef.sourceHash, hash(Buffer.from(state.source)));
      assert.equal(row.extensions.semanticRef.recordRef.partitionId, state.facts.syntaxPartitionId);
      assert.deepEqual(row.extensions.semanticRef.generation, generation);
    }
  }
};
const originalFailure = Object.assign(new Error('original second-group input EIO'), { code: 'EIO' });
const observe = async (operation, { interrupt = false } = {}) => {
  const original = nativeFs.createReadStream, reads = [], finalCheckpoints = [], streams = new Set();
  let injected = false;
  nativeFs.createReadStream = function(file, options) {
    const stream = Reflect.apply(original, this, [file, options]);
    streams.add(stream); stream.once('close', () => streams.delete(stream));
    if (options?.encoding === 'utf8') {
      const name = path.basename(String(file));
      if (/^call_sites\.run-\d+\.jsonl$/u.test(name)) reads.push(name);
      if (name === 'ordered.jsonl') finalCheckpoints.push(JSON.parse(nativeFs.readFileSync(checkpointPath, 'utf8')));
      if (interrupt && !injected && name === 'call_sites.run-00032.jsonl') {
        injected = true; queueMicrotask(() => stream.destroy(originalFailure));
      }
    }
    return stream;
  };
  try {
    const value = await operation();
    assert.equal(streams.size, 0, 'original readers must close before the operation returns');
    return { value, reads, finalCheckpoints, injected };
  } finally {
    nativeFs.createReadStream = original;
    // This is original resource cleanup, including an assertion-failure path.
    await Promise.all([...streams].map(stream => new Promise(resolve => {
      if (stream.closed) return resolve(); stream.once('close', resolve); stream.destroy();
    })));
  }
};
let primaryFailure, hasPrimaryFailure = false;
try {
  const initial = await prepare(), baseline = await enqueue(initial);
  for (const job of baseline.jobs) await job();
  const expected = await rowsOf(baseline.pieces); assertRows(expected, initial, true);
  const interrupted = await enqueue(initial);
  const failureObservation = await observe(async () => {
    await assert.rejects(interrupted.jobs[0](), error => error === originalFailure);
  }, { interrupt: true });
  assert.equal(failureObservation.injected, true);
  assert.equal(initial.callSitesCoverage.status, 'incomplete'); assert.deepEqual(interrupted.pieces, []);
  const checkpointBytes = await fs.readFile(checkpointPath), checkpoint = JSON.parse(checkpointBytes);
  assert.ok(checkpoint.inputIdentity); assert.ok(checkpoint.passes['0']['0']);
  assert.equal(checkpoint.passes['0']['1'], undefined, 'only the successfully closed first group is checkpointed');
  const firstRun = checkpoint.passes['0']['0'];
  assert.equal(hash(await fs.readFile(firstRun.path)), firstRun.sha256);
  let state = initial;
  if (selected === 'source') state = await prepare({ source: '// exact changed source\n' + text });
  if (selected === 'parser') state = await prepare({ nativeParserEnabled: false });
  if (selected === 'policy') state = await prepare({ languages: ['c', 'python'] });
  if (selected === 'generation') {
    const rejected = await observe(() => assert.rejects(enqueue(initial, 'another-build-generation'), { code: 'ERR_CALL_SITE_SEMANTIC_REF' }));
    assert.deepEqual(rejected.reads, [], 'generation authority rejects before entering the merge');
    assert.deepEqual(await fs.readFile(checkpointPath), checkpointBytes);
  }
  if (state !== initial) {
    assert.notEqual(state.facts.syntaxPartitionId, initial.facts.syntaxPartitionId,
      'the original source/parser/extraction-policy owner produces a different immutable syntax identity');
    const before = initial.facts.partitions.find(row => row.partitionId === initial.facts.syntaxPartitionId);
    const after = state.facts.partitions.find(row => row.partitionId === state.facts.syntaxPartitionId);
    if (selected === 'source') assert.notEqual(state.facts.sourceHash, initial.facts.sourceHash);
    if (selected === 'parser') {
      assert.notEqual(after.producerHash, before.producerHash);
      assert.ok(state.facts.coverage.some(row => row.phase === 'syntax' && row.state === 'disabled'
        && row.reason === 'native_parser_policy_disabled'));
    }
    if (selected === 'policy') {
      assert.equal(after.producerHash, before.producerHash);
      assert.notEqual(after.policyHash, before.policyHash);
    }
  }
  const resumed = await enqueue(state), observation = await observe(async () => {
    for (const job of resumed.jobs) await job();
  });
  assert.equal(observation.finalCheckpoints.length, 1);
  const unchanged = selected === 'exact' || selected === 'generation';
  assert.equal(observation.finalCheckpoints[0].inputIdentity === checkpoint.inputIdentity, unchanged);
  const earlyReads = observation.reads.filter(name => Number(name.match(/(\d+)\.jsonl$/u)[1]) < 32);
  assert.equal(earlyReads.length, unchanged ? 0 : 32,
    'unchanged canonical bytes reuse the durable first group; changed authority-bearing rows recompute it');
  const rows = await rowsOf(resumed.pieces); assertRows(rows, state, selected !== 'parser');
  if (unchanged) assert.deepEqual(rows, expected, 'actual checkpoint replay preserves every canonical field');
  const completedJobs = resumed.jobs.length;
  enqueueSemanticArtifacts({ state, root: buildRoot, outDir, enabled: true,
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId },
    enqueueWrite: resumed.enqueueWrite, addPieceFile: resumed.addPieceFile, declareArtifactFamily() {} });
  for (const job of resumed.jobs.slice(completedJobs)) await job();
  await writePiecesManifest({ pieceEntries: resumed.pieces, outDir, mode: 'code',
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId } });
  const store = createGraphStore({ indexDir: outDir }), published = []; let cursor = null, pages = 0;
  do {
    const page = await store.readCallSitesPage({ limit: 7, scanRows: 7, cursor });
    assert.ok(page.rows.length <= 7 && page.scanned <= 7); published.push(...page.rows); cursor = page.cursor;
    assert.ok(++pages <= 7 && (page.rows.length || cursor === null), 'bounded continuation makes observable progress');
    assert.ok(published.length <= 40, 'continuation must advance within the independently expected set');
  } while (cursor);
  assert.deepEqual(published, rows, 'original manifest-backed query pages conserve the full recovered canonical set');
  if (selected !== 'parser') {
    const retained = await openPublishedSemanticStore({ indexDir: outDir, repoRoot: buildRoot, generation });
    const refs = published.map(row => row.extensions.semanticRef.recordRef);
    const spans = await retained.store.getSourceSpans(refs);
    assert.equal(spans.length, 40);
    for (let index = 0; index < spans.length; index++) {
      assert.equal(spans[index].text, state.source.slice(published[index].start, published[index].end));
      assert.equal(spans[index].sourceHash, hash(Buffer.from(state.source)));
    }
  }
  await assert.rejects(fs.stat(path.dirname(checkpointPath)), { code: 'ENOENT' });
  console.log(JSON.stringify({ selected, retained: rows.length, firstGroupSourceReads: earlyReads.length,
    oldCheckpointIdentity: checkpoint.inputIdentity, currentCheckpointIdentity: observation.finalCheckpoints[0].inputIdentity,
    scope: 'actual native/canonical retained-semantic rows and original interrupted merge/re-enqueue/checkpoint/publication;no parser/policy authority invented for unavailable semantic rows' }));
} catch (error) { primaryFailure = error; hasPrimaryFailure = true; throw error; }
finally {
  try { await fs.rm(dir, { recursive: true, force: true }); }
  catch (cleanup) {
    if (hasPrimaryFailure) throw addStorageFailureContext(primaryFailure, {}, cleanup, { secondaryPresent: true });
    throw cleanup;
  }
}
