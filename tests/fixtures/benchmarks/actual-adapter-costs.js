import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

/** Manual real-model child. Imports of production consumers follow the exact
 * two-owner load boundary; no ordinary discovery, optional skip or stub arm.
 */
const args = process.argv.slice(2); assert.equal(args.length % 2, 0);
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) =>
  [args[index * 2].replace(/^--/, ''), args[index * 2 + 1]]));
for (const key of ['arm', 'cohort', 'route', 'manifest', 'out']) assert.ok(options[key], 'Required --' + key);
assert.ok(['original', 'current'].includes(options.arm));
assert.ok(['cold', 'warm', 'cold-copies', 'warm-copies', 'cold-allocations', 'warm-allocations', 'cold-memory', 'warm-memory'].includes(options.cohort));
const temperature = options.cohort === 'cold' || options.cohort.startsWith('cold-') ? 'cold' : 'warm';
const observationKind = options.cohort.replace(/^(cold|warm)-/, '');
assert.ok(['batch', 'prepared'].includes(options.route));
const out = path.resolve(options.out); await fs.mkdir(out);
const started = performance.now(), startCpu = process.cpuUsage();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const originals = [
  { name: 'embedding-provider-adapters', blob: 'd28a8ccab44237b0f75b7b17ed1fc804b49aacc4',
    sha256: '2a0a76b5ec7d8005d9200e7b1848e8350ef2048e35666b6103d0e2cfb9a5fde0' },
  { name: 'embedding-utils', blob: 'a3ab2c77ba5856c974f9fd95a19ce089371299ae',
    sha256: 'ab997207a193f863fd3d66cad74bf050aa2db656dec2b5b98e3060558caeae09' }
];
const overrides = new Map(), sourceOwners = [];
for (const original of originals) {
  const owner = 'src/shared/' + original.name + '.js', url = new URL('../../../' + owner, import.meta.url);
  const saved = new URL('./' + original.name + '-original-506e.js.txt', import.meta.url);
  const bytes = await fs.readFile(saved), source = bytes.toString('utf8').replace(/\r\n/g, '\n');
  assert.equal(hash(source), original.sha256);
  assert.equal(createHash('sha1').update('blob ' + Buffer.byteLength(source) + '\0').update(source).digest('hex'), original.blob);
  const current = await fs.readFile(url);
  overrides.set(url.href, { source, interceptions: 0 });
  sourceOwners.push({ path: owner, checkoutSha256: hash(current), executedSha256: options.arm === 'original' ? original.sha256 : hash(current),
    original: { commit: '506e56451020bfdb864f68b2235aa4a2f12a7a82', blob: original.blob, sha256: original.sha256,
      source: 'https://github.com/doublemover/PairOfCleats/blob/506e56451020bfdb864f68b2235aa4a2f12a7a82/' + owner } });
}
const hook = options.arm === 'original' ? registerHooks({ load(url, context, next) {
  const replacement = overrides.get(url); if (!replacement) return next(url, context);
  replacement.interceptions++; return { format: 'module', source: replacement.source, shortCircuit: true };
} }) : null;
let adapter, adapterModule, lease, sampleTimer, report, failed = false, failure, originalCleanupSettled = true, leaseReleased = false;
let preserve = (primary, secondary) => new AggregateError([primary, secondary], 'Qualification and original cleanup failed.', { cause: primary });
const remember = error => { failure = failed ? preserve(failure, error) : error; failed = true; };
try {
  const { preserveEmbeddingCleanupFailure } = await import('../../../src/shared/embedding-cache-lifetime.js'); preserve = preserveEmbeddingCleanupFailure;
  const { requireBootstrap } = await import('../../../src/shared/bootstrap-readiness.js'); await requireBootstrap();
  const { applyTestEnv } = await import('../../helpers/test-env.js');
  applyTestEnv({ cacheRoot: path.join(out, 'cache'), embeddings: null, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
  const { readVerifiedContainedFile } = await import('../../../src/shared/contained-file.js');
  const readJson = async (filename, maxBytes) => {
    const resolved = path.resolve(filename), read = await readVerifiedContainedFile(path.dirname(resolved), resolved,
      { maxBytes, hashAlgorithm: 'sha256' });
    return { value: JSON.parse(read.buffer.toString('utf8')), identity: { path: resolved, sha256: read.hash, bytes: read.buffer.length } };
  };
  const selected = await readJson(options.manifest, 1024 * 1024), manifest = selected.value;
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.provider, 'xenova');
  assert.equal(typeof manifest.modelId, 'string'); assert.ok(manifest.modelId.length > 0);
  assert.ok(path.isAbsolute(manifest.modelsDir)); assert.equal(manifest.normalize, true);
  assert.ok(Array.isArray(manifest.texts) && manifest.texts.length >= 32 && manifest.texts.length <= 64);
  assert.ok(manifest.texts.every(text => typeof text === 'string' && text.length > 0 && text.length <= 32768));
  assert.ok(Number.isSafeInteger(manifest.dimensions) && manifest.dimensions > 0 && manifest.dimensions <= 8192);
  assert.ok(Number.isFinite(manifest.tolerance) && manifest.tolerance > 0 && manifest.tolerance <= 1e-4);
  assert.equal(typeof manifest.corpusProvenance, 'string'); assert.ok(manifest.corpusProvenance.length > 0);
  const { resolveEmbeddingModelProfile } = await import('../../../src/shared/embedding-model-profile.js');
  const profile = resolveEmbeddingModelProfile(manifest.modelId, manifest.modelProfile);
  if (profile) assert.equal(manifest.dimensions, profile.dimensions);
  const { MINILM_REFERENCE_RECIPE, assertMiniLmReferenceManifest, compareMiniLmReferenceVectors } =
    await import('../../embeddings/helpers/minilm-upstream-reference.js');
  const miniLm = manifest.modelId === MINILM_REFERENCE_RECIPE.modelId;
  if (miniLm) { assertMiniLmReferenceManifest(manifest); assert.equal(options.route, 'batch'); assert.ok(options['numerical-reference']); }
  else assert.ok(profile, 'This finite comparison supports actual MiniLM or the registered EG2 prepared profile only.');
  assert.equal(manifest.corpusSource?.path, 'tests/fixtures/embeddings/minilm-provider-corpus.json');
  const corpus = await readJson(manifest.corpusSource.path, 65536);
  assert.equal(corpus.identity.sha256, manifest.corpusSource.sha256);
  assert.equal(corpus.value.schemaVersion, 1); assert.equal(corpus.value.provenance, manifest.corpusProvenance);
  assert.deepEqual(corpus.value.texts, manifest.texts);
  const root = path.join(out, 'runtime-root'); await fs.mkdir(root);
  const { acquireEmbeddingArtifactLease } = await import('../../../src/shared/embedding-artifact-lease.js');
  lease = await acquireEmbeddingArtifactLease({ provider: 'xenova', modelId: manifest.modelId, modelsDir: manifest.modelsDir,
    rootDir: root, modelProfile: profile, onnx: manifest.onnxConfig });
  assert.equal(lease.artifact.status, 'verified');
  const sorted = rows => [...rows].sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(sorted(lease.artifact.inventory), sorted(manifest.artifacts));
  const transformers = await import('@huggingface/transformers');
  transformers.env.allowRemoteModels = false; transformers.env.allowLocalModels = true;
  const runtime = {};
  for (const [name, module] of Object.entries({ transformers: '@huggingface/transformers', onnxruntimeNode: 'onnxruntime-node' })) {
    runtime[name] = JSON.parse(await fs.readFile(path.join(process.cwd(), 'node_modules', module, 'package.json'), 'utf8')).version;
  }
  assert.deepEqual(runtime, manifest.runtime);
  const { captureEmbeddingProviderRuntime } = await import('../../embeddings/helpers/provider-runtime-provenance.js');
  const providerRuntime = await captureEmbeddingProviderRuntime({ provider: 'xenova' });
  assert.equal(providerRuntime.binding.moduleCacheLoaded, true);
  if (manifest.providerRuntime) assert.deepEqual(manifest.providerRuntime, { name: providerRuntime.name, version: providerRuntime.version });
  const corpusIdentity = { source: { path: manifest.corpusSource.path, sha256: corpus.identity.sha256 },
    sha256: hash(JSON.stringify(manifest.texts)), rows: manifest.texts.map((text, index) =>
      ({ index, bytes: Buffer.byteLength(text), sha256: hash(text) })) };
  let reference = null;
  if (miniLm) {
    reference = await readJson(options['numerical-reference'], 16 * 1024 * 1024);
    const expected = reference.value;
    assert.equal(expected.status, 'numerical-reference'); assert.equal(expected.route, 'upstream-reference');
    assert.deepEqual(expected.referenceRecipe, MINILM_REFERENCE_RECIPE); assert.equal(expected.manifest.sha256, selected.identity.sha256);
    assert.deepEqual(expected.modelArtifact, lease.artifact); assert.deepEqual(expected.runtime, runtime); assert.deepEqual(expected.corpus, corpusIdentity);
    assert.ok(expected.largeBatch.length >= 1);
    const referenceOwner = 'tests/embeddings/helpers/minilm-upstream-reference.js';
    assert.equal(expected.sourceOwners.find(row => row.path === referenceOwner)?.sha256, hash(await fs.readFile(referenceOwner)));
  }
  adapterModule = await import('../../../src/shared/embedding-adapter.js');
  for (const replacement of overrides.values()) assert.equal(replacement.interceptions, options.arm === 'original' ? 1 : 0,
    'Each declared historical owner must load exactly once at its production URL.');
  const samples = [], comparisons = [], memorySamples = [];
  report = { schemaVersion: 1, status: 'running', issue: 1544, arm: options.arm, cohort: options.cohort, temperature, route: options.route,
    historicalAuthorWorkspace: true, sourceOwners, manifest: selected.identity, runtime,
    host: { node: process.version, platform: process.platform, arch: process.arch }, providerRuntime,
    modelArtifact: lease.artifact, corpus: corpusIdentity, profile, tolerance: manifest.tolerance,
    numericalReference: reference?.identity || null,
    numericalScope: miniLm ? 'Independent raw MiniLM token/mask/mean/L2 reference at identical full batch geometry.'
      : 'Same-source original/current actual EG2 consistency; independent EG2 model/reference accuracy remains separate.',
    comparisonScope: 'Exactly the declared original provider-adapters and utils Git blobs; all other production owners, installed dependencies and pinned model/tokenizer bytes current and identical. No historical whole-tree performance claim.',
    coldScope: 'Fresh-process first adapter creation/tokenization/model inference; OS filesystem cache and host CPU cache are uncontrolled. Artifact hashing, imports and native provenance run before timing.',
    warmScope: 'Same live adapter after one untimed identical full-batch inference; actual inference re-executes, not a vector/result-cache hit.',
    samples, comparisons, memorySamples, outputBytes: manifest.texts.length * manifest.dimensions * 4, vectors: null };
  const validate = vectors => {
    assert.equal(vectors.length, manifest.texts.length);
    for (const vector of vectors) {
      assert.ok(vector instanceof Float32Array); assert.equal(vector.length, manifest.dimensions);
      let norm = 0; for (const value of vector) { assert.ok(Number.isFinite(value)); norm += value * value; }
      assert.ok(Math.abs(Math.sqrt(norm) - 1) <= manifest.tolerance);
    }
    if (miniLm) comparisons.push(compareMiniLmReferenceVectors(vectors, reference.value.largeBatch[0].vectors, manifest.tolerance));
    if (!report.vectors) report.vectors = vectors.map(vector => [...vector]);
    else for (const [row, vector] of vectors.entries()) for (const [column, value] of vector.entries()) {
      assert.ok(Math.abs(value - report.vectors[row][column]) <= manifest.tolerance);
    }
  };
  let prepared = null;
  const prepare = async () => {
    if (options.route === 'prepared' && !prepared) {
      const at = performance.now(), cpu = process.cpuUsage(); prepared = await adapter.prepare(manifest.texts);
      report.tokenization = { elapsedMs: performance.now() - at, cpu: process.cpuUsage(cpu), rows: prepared.length };
      assert.equal(prepared.length, manifest.texts.length);
    }
  };
  const infer = () => options.route === 'prepared' ? adapter.embedPrepared(prepared) : adapter.embed(manifest.texts);
  const create = () => {
    adapter = adapterModule.getEmbeddingAdapter({ rootDir: root, provider: 'xenova', modelId: manifest.modelId,
      dims: manifest.dimensions, modelsDir: manifest.modelsDir, localFilesOnly: true, useStub: false,
      normalize: true, modelProfile: profile, modelArtifact: lease.artifact,
      sessionOptions: { intraOpNumThreads: 1, interOpNumThreads: 1 } });
  };
  const timed = async (name, operation) => {
    const beforeMemory = process.memoryUsage(), at = performance.now(), cpu = process.cpuUsage();
    const vectors = await operation();
    const elapsedMs = performance.now() - at, used = process.cpuUsage(cpu), afterMemory = process.memoryUsage();
    samples.push({ name, rows: vectors.length, elapsedMs, cpu: used, rowsPerSecond: vectors.length * 1000 / elapsedMs,
      outputBytes: report.outputBytes, beforeMemory, afterMemory, processLifetimeMaxRssKiB: process.resourceUsage().maxRSS });
    validate(vectors); // correctness, copies and receipt serialization are outside clean operation clocks
  };
  if (options.cohort === 'cold') {
    await timed('cold-first-full-batch', async () => { create(); await prepare(); return infer(); });
  } else {
    create();
    if (temperature === 'warm') {
      await prepare(); const at = performance.now(), cpu = process.cpuUsage(); let priming = await infer();
      report.priming = { elapsedMs: performance.now() - at, cpu: process.cpuUsage(cpu), rows: priming.length }; validate(priming); priming = null;
    }
    const operation = async () => { await prepare(); return infer(); };
    if (options.cohort === 'warm') for (let run = 0; run < 3; run++) await timed('warm-full-batch-' + run, infer);
    else if (observationKind === 'copies') {
      const { observeAdapterCopies } = await import('../../embeddings/helpers/adapter-copy-observation.js');
      const observed = await observeAdapterCopies({ transformers, operation, rows: manifest.texts.length, dimensions: manifest.dimensions, miniLm });
      validate(observed.vectors); report.copies = observed.observation;
    } else if (observationKind === 'allocations') {
      const { observeHeapAllocations } = await import('../../helpers/heap-sampling.js');
      const observedOutputs = [];
      report.allocations = await observeHeapAllocations({ destination: out, name: options.arm + '-actual-inference', iterations: temperature === 'cold' ? 1 : 2,
        operation: async () => { observedOutputs.push(await operation()); } });
      for (const vectors of observedOutputs) validate(vectors);
      observedOutputs.length = 0;
      report.allocationScope = 'One cold first-inference or two warm full-batch inferences, as iterations/temperature record; sampled JS profile includes original tokenizer/model/adapter/disposal and result-array appends. Outputs retained through sampling for checks after inspector stop, then released. Warm priming-vector witness retained equally in both arms. Adapter creation and preselected artifact verification precede sampling. No clean latency or leak inference from instrumentation.';
    } else {
      const observe = phase => memorySamples.push({ phase, elapsedMs: performance.now() - started, ...process.memoryUsage() });
      observe('before'); sampleTimer = setInterval(() => observe('during-inference'), 5); sampleTimer.unref();
      let vectors;
      try { vectors = await operation(); } finally { clearInterval(sampleTimer); sampleTimer = null; observe('returned'); }
      validate(vectors);
      report.observedPeak = Object.fromEntries(['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers'].map(key =>
        [key, Math.max(...memorySamples.map(row => row[key]))]));
      report.memoryScope = 'Separate 5ms JS memory samples plus endpoint observations; sampled peaks are lower bounds, may miss native/event-loop-blocked transients. OS maxRSS is process lifetime, not an inference delta or leak measurement.';
    }
  }
  report.execution = adapter.executionInfo(); assert.equal(report.execution.stub, false); assert.equal(report.execution.provider, 'xenova');
  await lease.verifyLoaded();
  for (const owner of sourceOwners) assert.equal(hash(await fs.readFile(path.resolve(owner.path))), owner.checkoutSha256);
  report.status = 'passed';
} catch (error) { remember(error); }
finally {
  clearInterval(sampleTimer);
  for (const cleanup of [() => adapter?.dispose(), () => adapterModule?.disposeEmbeddingAdapterCaches()]) {
    try { await cleanup(); } catch (error) { originalCleanupSettled = false; remember(error); }
  }
  try {
    if (adapterModule) {
      assert.ok(adapterModule.getRetiredEmbeddingCacheOwners().every(owner => !owner.pending));
      const { getPendingTransformersResourceOwners } = await import('../../../src/shared/embedding-transformers-resources.js');
      assert.equal(getPendingTransformersResourceOwners().length, 0);
    }
  } catch (error) { originalCleanupSettled = false; remember(error); }
  try { lease?.release(); leaseReleased = Boolean(lease); } catch (error) { remember(error); }
  try { hook?.deregister(); } catch (error) { remember(error); }
  const elapsedMs = performance.now() - started;
  if (elapsedMs >= 30000) remember(new Error('Actual child including original cleanup exceeded 30 seconds.'));
  if (report) {
    report.status = failed ? 'failed' : 'passed'; report.elapsedMs = elapsedMs; report.cpu = process.cpuUsage(startCpu);
    report.processResourceUsage = process.resourceUsage();
    report.cleanup = { adapterAndCachesOriginalSettled: originalCleanupSettled, artifactVerificationLeaseReleased: leaseReleased };
    try { await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); }
    catch (error) { remember(error); }
  }
}
if (failed) throw failure;
