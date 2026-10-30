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
let adapter, adapterModule, onnxModule, lease, sampleTimer, report, failed = false, failure, originalCleanupSettled = true, leaseReleased = false;
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
  assert.equal(manifest.schemaVersion, 1); assert.ok(['xenova', 'onnx'].includes(manifest.provider));
  const direct = manifest.provider === 'onnx';
  const directReference = direct ? await import('../../embeddings/helpers/direct-minilm-reference.js') : null;
  if (direct) directReference.assertDirectMiniLmRoute(options.route);
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
  if (miniLm) {
    if (direct) directReference.assertDirectMiniLmManifest(manifest); else assertMiniLmReferenceManifest(manifest);
    assert.equal(options.route, 'batch'); assert.ok(options['numerical-reference']);
  }
  else assert.ok(profile, 'This finite comparison supports actual MiniLM or the registered EG2 prepared profile only.');
  if (direct) assert.ok(miniLm, 'This direct-provider cost cohort qualifies only the explicit MiniLM export.');
  assert.equal(manifest.corpusSource?.path, 'tests/fixtures/embeddings/minilm-provider-corpus.json');
  const corpus = await readJson(manifest.corpusSource.path, 65536);
  assert.equal(corpus.identity.sha256, manifest.corpusSource.sha256);
  assert.equal(corpus.value.schemaVersion, 1); assert.equal(corpus.value.provenance, manifest.corpusProvenance);
  assert.deepEqual(corpus.value.texts, manifest.texts);
  const root = path.join(out, 'runtime-root'); await fs.mkdir(root);
  const { acquireEmbeddingArtifactLease } = await import('../../../src/shared/embedding-artifact-lease.js');
  lease = await acquireEmbeddingArtifactLease({ provider: manifest.provider, modelId: manifest.modelId, modelsDir: manifest.modelsDir,
    rootDir: root, modelProfile: profile, onnx: manifest.onnxConfig });
  assert.equal(lease.artifact.status, 'verified');
  const sorted = rows => [...rows].sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(sorted(lease.artifact.inventory), sorted(manifest.artifacts));
  const installation = direct ? await directReference.readDirectMiniLmInstallation({ manifest, selectedGraph: lease.selectedModelPath }) : null;
  const transformers = await import('@huggingface/transformers');
  transformers.env.allowRemoteModels = false; transformers.env.allowLocalModels = true;
  const ort = direct ? await import('onnxruntime-node') : null;
  const runtime = {};
  for (const [name, module] of Object.entries({ transformers: '@huggingface/transformers', onnxruntimeNode: 'onnxruntime-node' })) {
    runtime[name] = JSON.parse(await fs.readFile(path.join(process.cwd(), 'node_modules', module, 'package.json'), 'utf8')).version;
  }
  assert.deepEqual(runtime, manifest.runtime);
  const { captureEmbeddingProviderRuntime } = await import('../../embeddings/helpers/provider-runtime-provenance.js');
  const providerRuntime = await captureEmbeddingProviderRuntime({ provider: manifest.provider });
  assert.equal(providerRuntime.binding.moduleCacheLoaded, true);
  if (manifest.providerRuntime) assert.deepEqual(manifest.providerRuntime, { name: providerRuntime.name, version: providerRuntime.version });
  if (direct) assert.equal(providerRuntime.version, '1.31.1');
  const { captureSweepSource } = await import('../../../tools/bench/ab-sweep-source.js');
  const source = captureSweepSource(process.cwd()); assert.equal(source.state, 'clean-revision');
  const frozenOwners = [];
  for (const file of ['tests/fixtures/benchmarks/actual-adapter-costs.js', 'tests/perf/qualification/actual-adapter-costs.js',
    'tests/embeddings/helpers/adapter-copy-observation.js', 'tests/helpers/heap-sampling.js',
    'src/shared/embedding-adapter.js', 'src/shared/embedding-cache-lifetime.js', 'src/shared/embedding-output-admission.js',
    'src/shared/embedding-vector-utils.js', 'src/shared/embedding-artifact-identity.js', 'src/shared/embedding-artifact-lease.js',
    'src/shared/embedding-transformers-resources.js', 'src/shared/embedding-model-loading.js', 'src/shared/embedding-model-profile.js',
    'node_modules/@huggingface/transformers/package.json', 'node_modules/@huggingface/transformers/dist/transformers.node.mjs',
    'node_modules/@huggingface/transformers/src/tokenization_utils.js', 'node_modules/@huggingface/transformers/src/utils/tensor.js',
    ...(direct ? ['tests/embeddings/helpers/direct-minilm-reference.js', 'src/shared/onnx-embeddings.js',
      'src/shared/onnx-embeddings/output.js', 'src/shared/onnx-embeddings/config.js', 'src/shared/onnx-embeddings/tokenization.js',
      'src/shared/onnx-embeddings/resource-lifetime.js', 'src/shared/onnx-embeddings/tensor-lifetime.js',
      'src/shared/onnx-embeddings/cache-lifetime.js', 'src/shared/onnx-embeddings/run-queue.js',
      'node_modules/onnxruntime-common/package.json', 'node_modules/onnxruntime-common/dist/cjs/tensor-impl.js',
      'node_modules/onnxruntime-common/dist/cjs/inference-session-impl.js'] : [])]) {
    frozenOwners.push({ path: file, sha256: hash(await fs.readFile(file)) });
  }
  const corpusIdentity = { source: { path: manifest.corpusSource.path, sha256: corpus.identity.sha256 },
    sha256: hash(JSON.stringify(manifest.texts)), rows: manifest.texts.map((text, index) =>
      ({ index, bytes: Buffer.byteLength(text), sha256: hash(text) })) };
  let reference = null;
  if (miniLm) {
    reference = await readJson(options['numerical-reference'], 16 * 1024 * 1024);
    const expected = reference.value;
    assert.equal(expected.status, 'numerical-reference'); assert.equal(expected.route, 'upstream-reference');
    assert.deepEqual(expected.referenceRecipe, direct ? directReference.DIRECT_MINILM_REFERENCE_RECIPE : MINILM_REFERENCE_RECIPE);
    assert.equal(expected.manifest.sha256, selected.identity.sha256);
    assert.deepEqual(expected.modelArtifact, lease.artifact); assert.deepEqual(expected.runtime, runtime); assert.deepEqual(expected.corpus, corpusIdentity);
    assert.ok(expected.largeBatch.length >= 1);
    const referenceOwner = direct ? 'tests/embeddings/helpers/direct-minilm-reference.js' : 'tests/embeddings/helpers/minilm-upstream-reference.js';
    assert.equal(expected.sourceOwners.find(row => row.path === referenceOwner)?.sha256, hash(await fs.readFile(referenceOwner)));
    if (direct) {
      assert.deepEqual(expected.providerRuntime, providerRuntime); assert.deepEqual(expected.installation, installation);
      assert.deepEqual(expected.source, source); assert.equal(expected.execution.provider, 'raw-AutoTokenizer-root-InferenceSession');
      assert.deepEqual(expected.execution.requestedSessionOptions, directReference.directMiniLmSessionOptions());
      assert.equal(expected.largeBatch[0].tokenization.tokenCounts.length, manifest.texts.length);
      assert.ok(expected.largeBatch[0].tokenization.tokenCounts.every(count => Number.isSafeInteger(count) && count > 0));
      for (const owner of frozenOwners.filter(row => row.path.startsWith('node_modules/'))) {
        const rawOwner = expected.sourceOwners.find(row => row.path === owner.path);
        if (rawOwner) assert.equal(rawOwner.sha256, owner.sha256);
      }
    }
  }
  adapterModule = await import('../../../src/shared/embedding-adapter.js');
  for (const replacement of overrides.values()) assert.equal(replacement.interceptions, options.arm === 'original' ? 1 : 0,
    'Each declared historical owner must load exactly once at its production URL.');
  const samples = [], comparisons = [], memorySamples = [];
  report = { schemaVersion: 1, status: 'running', issue: 1544, arm: options.arm, cohort: options.cohort, temperature, route: options.route,
    historicalAuthorWorkspace: true, source, sourceOwners, frozenOwners, manifest: selected.identity, runtime, provider: manifest.provider, installation,
    host: { node: process.version, platform: process.platform, arch: process.arch }, providerRuntime,
    modelArtifact: lease.artifact, corpus: corpusIdentity, profile, tolerance: manifest.tolerance,
    numericalReference: reference?.identity || null,
    numericalScope: miniLm ? 'Independent raw MiniLM token/mask/mean/L2 reference at identical full batch geometry.'
      : 'Same-source original/current actual EG2 consistency; independent EG2 model/reference accuracy remains separate.',
    comparisonScope: 'Exactly the declared original provider-adapters and utils Git blobs; all other production owners, installed dependencies and pinned model/tokenizer bytes current and identical. Direct ONNX output decoder/admission stays current in both arms; its full actual costs are observed, not a historical decoder-cost comparison. No historical whole-tree performance claim.',
    coldScope: 'Fresh-process first adapter creation/tokenization/model inference; OS filesystem cache and host CPU cache are uncontrolled. Artifact hashing, imports and native provenance run before timing.',
    warmScope: 'Same live adapter after one untimed identical full-batch inference; actual inference re-executes, not a vector/result-cache hit. Direct ONNX uses its original token-row cache policy; the effective flag and producer counters report that distinct tier.',
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
    adapter = adapterModule.getEmbeddingAdapter({ rootDir: root, provider: manifest.provider, modelId: manifest.modelId,
      dims: manifest.dimensions, modelsDir: manifest.modelsDir, localFilesOnly: true, useStub: false,
      normalize: true, modelProfile: profile, modelArtifact: lease.artifact, onnxConfig: manifest.onnxConfig,
      sessionOptions: { intraOpNumThreads: 1, interOpNumThreads: 1 } });
  };
  const timed = async (name, operation) => {
    const beforeWork = adapter?.executionInfo().measurements || {};
    const beforeMemory = process.memoryUsage(), at = performance.now(), cpu = process.cpuUsage();
    const vectors = await operation();
    const elapsedMs = performance.now() - at, used = process.cpuUsage(cpu), afterMemory = process.memoryUsage();
    const afterWork = adapter.executionInfo().measurements;
    const producerDelta = direct ? Object.fromEntries(['runs', 'outputsFetched', 'outputTensorBytes', 'outputValuesRead', 'hostPooledRows',
      'tensorResourcesObserved', 'tensorResourcesSettled', 'tokenizerCalls', 'tokenizerInputTexts', 'tokenCacheRowHits']
      .map(key => [key, (afterWork[key] || 0) - (beforeWork[key] || 0)])) : null;
    if (direct) { assert.equal(producerDelta.runs, 1); assert.equal(producerDelta.hostPooledRows, manifest.texts.length); }
    samples.push({ name, rows: vectors.length, elapsedMs, cpu: used, rowsPerSecond: vectors.length * 1000 / elapsedMs, producerDelta,
      outputBytes: report.outputBytes, beforeMemory, afterMemory, processLifetimeMaxRssKiB: process.resourceUsage().maxRSS });
    validate(vectors); // correctness, copies and receipt serialization are outside clean operation clocks
  };
  if (options.cohort === 'cold') {
    await timed('cold-first-full-batch', async () => { create(); await prepare(); return infer(); });
  } else {
    if (temperature === 'warm') {
      create();
      await prepare(); const at = performance.now(), cpu = process.cpuUsage(); let priming = await infer();
      report.priming = { elapsedMs: performance.now() - at, cpu: process.cpuUsage(cpu), rows: priming.length }; validate(priming); priming = null;
    }
    // Direct ONNX starts native session construction during adapter creation.
    // The cold instrumented operation must own creation as well as inference.
    const operation = async () => { if (!adapter) create(); await prepare(); return infer(); };
    if (options.cohort === 'warm') for (let run = 0; run < 3; run++) await timed('warm-full-batch-' + run, infer);
    else if (observationKind === 'copies') {
      const { observeAdapterCopies } = await import('../../embeddings/helpers/adapter-copy-observation.js');
      const before = adapter?.executionInfo().measurements || {};
      const observed = await observeAdapterCopies({ transformers, ort, provider: manifest.provider,
        operation, rows: manifest.texts.length, dimensions: manifest.dimensions, miniLm });
      validate(observed.vectors); report.copies = observed.observation;
      if (direct) {
        const after = adapter.executionInfo().measurements;
        const delta = key => (after[key] || 0) - (before[key] || 0);
        assert.equal(delta('runs'), 1); assert.equal(delta('outputsFetched'), 1);
        assert.equal(delta('tensorResourcesObserved'), 4); assert.equal(delta('tensorResourcesSettled'), 4);
        assert.equal(after.retainedTensorScopes, 0); assert.equal(delta('tensorCleanupFailures'), 0);
        const output = report.copies.disposals.find(row => row.role === 'output');
        assert.deepEqual(output.dimensions, reference.value.largeBatch[0].rawOutput.dimensions);
        assert.equal(output.bytes, reference.value.largeBatch[0].rawOutput.bytes); assert.equal(delta('outputTensorBytes'), output.bytes);
        assert.equal(delta('hostPooledRows'), manifest.texts.length); assert.equal(delta('sentenceOutputRows'), 0);
        assert.equal(delta('outputValuesRead'), reference.value.largeBatch[0].tokenization.tokenCounts.reduce((sum, count) => sum + count, 0) * manifest.dimensions);
        report.copies.originalProducerDelta = Object.fromEntries(['runs', 'outputsFetched', 'outputTensorBytes', 'outputValuesRead',
          'hostPooledRows', 'sentenceOutputRows', 'tensorResourcesObserved', 'tensorResourcesSettled', 'tensorCleanupFailures'].map(key => [key, delta(key)]));
      }
    } else if (observationKind === 'allocations') {
      const { observeHeapAllocations } = await import('../../helpers/heap-sampling.js');
      const observedOutputs = [];
      report.allocations = await observeHeapAllocations({ destination: out, name: options.arm + '-actual-inference', iterations: temperature === 'cold' ? 1 : 2,
        operation: async () => { observedOutputs.push(await operation()); } });
      for (const vectors of observedOutputs) validate(vectors);
      observedOutputs.length = 0;
      report.allocationScope = 'One cold creation/first-inference or two warm full-batch inferences, as iterations/temperature record; sampled JS profile includes original tokenizer/model/adapter/disposal and result-array appends. Outputs retained through sampling for checks after inspector stop, then released. Warm priming-vector witness retained equally in both arms. Preselected artifact verification and module/native imports precede sampling. No clean latency or leak inference from instrumentation.';
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
  report.execution = adapter.executionInfo(); assert.equal(report.execution.stub, false); assert.equal(report.execution.provider, manifest.provider);
  if (direct) {
    assert.equal(report.execution.fallback, null); assert.deepEqual(report.execution.effectiveSessionOptions, directReference.directMiniLmSessionOptions());
    assert.equal(report.execution.measurements.retainedTensorScopes, 0);
    assert.equal(report.execution.measurements.tensorResourcesObserved, report.execution.measurements.tensorResourcesSettled);
    assert.equal(report.execution.measurements.tensorCleanupFailures || 0, 0);
    const runs = temperature === 'cold' ? 1 : options.cohort === 'warm' ? 4 : observationKind === 'allocations' ? 3 : 2;
    const counts = report.execution.measurements;
    assert.equal(counts.runs, runs); assert.equal(counts.outputsFetched, runs);
    assert.equal(counts.hostPooledRows, runs * manifest.texts.length); assert.equal(counts.sentenceOutputRows || 0, 0);
    assert.equal(counts.outputTensorBytes, runs * reference.value.largeBatch[0].rawOutput.bytes);
    assert.equal(counts.outputValuesRead, runs * manifest.dimensions * reference.value.largeBatch[0].tokenization.tokenCounts.reduce((sum, count) => sum + count, 0));
    assert.equal(counts.tensorResourcesObserved, runs * 4);
    const tokenCacheEnabled = report.execution.requestedOnnxConfig.tokenizationCacheEnabled !== false;
    const uniqueTexts = new Set(manifest.texts).size, maxEntries = report.execution.requestedOnnxConfig.tokenizationCacheMaxEntries;
    const wholeCorpusFits = tokenCacheEnabled && maxEntries >= uniqueTexts;
    report.tokenRowCachePolicy = { enabled: tokenCacheEnabled,
      maxEntries, wholeCorpusFits,
      scope: 'Original bounded token-data cache; native inference still executes once per actual batch.' };
    if (!tokenCacheEnabled || wholeCorpusFits) {
      assert.equal(counts.tokenizerCalls, tokenCacheEnabled ? 1 : runs);
      assert.equal(counts.tokenizerInputTexts, uniqueTexts * (tokenCacheEnabled ? 1 : runs));
      assert.equal(counts.tokenCacheRowHits || 0, tokenCacheEnabled ? (runs - 1) * manifest.texts.length : 0);
    } else {
      assert.ok(counts.tokenizerCalls >= 1 && counts.tokenizerCalls <= runs);
      assert.ok(counts.tokenizerInputTexts >= uniqueTexts && counts.tokenizerInputTexts <= uniqueTexts * runs);
      assert.ok((counts.tokenCacheRowHits || 0) <= (runs - 1) * manifest.texts.length);
    }
    onnxModule = await import('../../../src/shared/onnx-embeddings.js');
    assert.deepEqual(await captureEmbeddingProviderRuntime({ provider: 'onnx' }), providerRuntime);
  }
  await lease.verifyLoaded();
  if (direct) assert.deepEqual(await directReference.readDirectMiniLmInstallation({ manifest, selectedGraph: lease.selectedModelPath }), installation);
  for (const owner of sourceOwners) assert.equal(hash(await fs.readFile(path.resolve(owner.path))), owner.checkoutSha256);
  for (const owner of frozenOwners) assert.equal(hash(await fs.readFile(path.resolve(owner.path))), owner.sha256);
  assert.deepEqual(captureSweepSource(process.cwd()), source);
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
      if (onnxModule) assert.ok(onnxModule.getRetiredOnnxSessionOwners().every(owner => !owner.pending));
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
