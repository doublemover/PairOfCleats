import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { preserveEmbeddingCleanupFailure } from '../../src/shared/embedding-cache-lifetime.js';
import { captureEmbeddingFailureDiagnostics, projectEmbeddingFailureDiagnostics } from '../../src/shared/embedding-failure-diagnostics.js';
import { MINILM_REFERENCE_RECIPE, assertMiniLmReferenceManifest, createMiniLmUpstreamReference,
  compareMiniLmReferenceVectors, measureMiniLmVectorDifference } from './helpers/minilm-upstream-reference.js';

/** Explicit offline/native capsule, intentionally outside ordinary test discovery.
 * Missing export/tokenizer/corpus/reference is a prerequisite failure, never a
 * skipped or stub-backed pass. Run capsules serially under the outer 30s owner.
 */
const args = process.argv.slice(2); assert.equal(args.length % 2, 0);
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) =>
  [args[index * 2].replace(/^--/, ''), args[index * 2 + 1]]));
for (const key of ['manifest', 'route', 'out']) assert.ok(options[key], 'Required --' + key);
assert.ok(['single', 'batch', 'prepared', 'query', 'resources', 'upstream-reference'].includes(options.route));
if (options.route === 'resources') assert.ok(['reference', 'candidate', 'upstream-comparison'].includes(options.observation),
  'Resource sampling requires explicit --observation reference|candidate|upstream-comparison.');
if (options.observation === 'candidate') assert.ok(options.reference, 'Candidate comparison requires --reference from the frozen source/reference run.');
if (options.observation === 'upstream-comparison') assert.ok(options['numerical-reference'], 'Independent upstream comparison requires its separately completed receipt.');
await requireBootstrap();
const manifestPath = path.resolve(options.manifest);
const { buffer: manifestBytes } = await readVerifiedContainedFile(path.dirname(manifestPath), manifestPath,
  { maxBytes: 1024 * 1024, hashAlgorithm: 'sha256' });
const manifest = JSON.parse(manifestBytes);
const miniLm = manifest.modelId === MINILM_REFERENCE_RECIPE.modelId;
if (miniLm) {
  assertMiniLmReferenceManifest(manifest);
  assert.notEqual(options.route, 'prepared', 'MiniLM has no supported prepared profile; this qualification does not substitute for EG2.');
  if (options.route !== 'upstream-reference') assert.ok(options['numerical-reference'], 'MiniLM consumer qualification requires its independent raw-model receipt.');
}
if (options.route === 'upstream-reference') assert.equal(miniLm, true, 'No reference recipe is inferred for EG2, M3, E5 or other exports.');
if (options.observation === 'upstream-comparison') assert.equal(miniLm, true);
assert.equal(manifest.schemaVersion, 1); assert.ok(['xenova', 'onnx'].includes(manifest.provider));
assert.equal(typeof manifest.modelId, 'string'); assert.ok(path.isAbsolute(manifest.modelsDir));
assert.ok(Number.isSafeInteger(manifest.dimensions) && manifest.dimensions > 0 && manifest.dimensions <= 8192);
assert.ok(Array.isArray(manifest.texts) && manifest.texts.length >= 2 && manifest.texts.length <= 64);
assert.ok(manifest.texts.every(text => typeof text === 'string' && text.length > 0 && text.length <= 32768));
assert.ok(Number.isFinite(manifest.tolerance) && manifest.tolerance > 0 && manifest.tolerance <= 1e-4);
assert.ok(typeof manifest.corpusProvenance === 'string' && manifest.corpusProvenance.length > 0);
assert.ok(Array.isArray(manifest.artifacts) && manifest.artifacts.length >= 2 && manifest.artifacts.length <= 128);
assert.ok(manifest.artifacts.every(row => typeof row.path === 'string' && /^[a-f0-9]{64}$/.test(row.sha256)
  && Number.isSafeInteger(row.bytes) && row.bytes >= 0));
await fs.access(manifest.modelsDir);
const out = path.resolve(options.out); await fs.mkdir(out); // New capsule only: do not overwrite or retry a receipt.
const root = path.join(out, 'runtime-root'); await fs.mkdir(root);
applyTestEnv({ cacheRoot: path.join(out, 'cache'), embeddings: null,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const started = performance.now(), cpu = process.cpuUsage(), controller = new AbortController();
const phases = [], samples = [], allocations = [], originalFloat = globalThis.Float32Array;
const receipt = { schemaVersion: 1, status: 'failed', route: options.route, observation: options.observation || null,
  node: process.version, platform: process.platform, architecture: process.arch,
  manifest: { path: path.resolve(options.manifest), sha256: createHash('sha256').update(manifestBytes).digest('hex') },
  corpusProvenance: manifest.corpusProvenance, sourceOwners: [], modelArtifact: null, runtime: {},
  corpus: { sha256: createHash('sha256').update(JSON.stringify(manifest.texts)).digest('hex'),
    rows: manifest.texts.map((text, index) => ({ index, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') })) },
  qualification: 'actual offline export/tokenizer/provider routes; supplied bounded corpus, no general performance gain claim',
  phases, allocations, memorySamples: samples, vectors: [] };
let adapter, lease, disposeCaches, rawReference, failure, hasFailure = false, sampleTimer, deadlineWrite;
const diagnostic = error => { const captured = captureEmbeddingFailureDiagnostics(error), projected = {};
  projectEmbeddingFailureDiagnostics(projected, captured);
  return { name: projected.name, code: projected.code, message: captured.message, thrownType: error === null ? 'null' : typeof error,
    inspectionFailures: captured.inspectionErrors.length, ownershipPending: !captured.released() }; };
const rememberFailure = error => { failure = hasFailure ? preserveEmbeddingCleanupFailure(failure, error) : error; hasFailure = true; };
const observe = phase => { samples.push({ phase, elapsedMs: performance.now() - started, ...process.memoryUsage() }); };
const phase = async (name, operation) => {
  controller.signal.throwIfAborted(); const began = performance.now(); observe(name + ':before');
  const value = await operation(); observe(name + ':after');
  phases.push({ name, elapsedMs: performance.now() - began }); controller.signal.throwIfAborted(); return value;
};
const deadline = setTimeout(() => {
  controller.abort(new Error('Actual embedding capsule crossed its unchanged 30-second total bound.'));
  deadlineWrite = fs.appendFile(path.join(out, 'phases.jsonl'), JSON.stringify({ phase: 'deadline', elapsedMs: performance.now() - started,
    nativeSettlement: 'not inferred from cancellation' }) + '\n');
  deadlineWrite.catch(rememberFailure);
}, 30000);
const assertEqualVectors = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  for (let row = 0; row < expected.length; row++) {
    assert.equal(actual[row].length, expected[row].length);
    for (let column = 0; column < expected[row].length; column++) assert.ok(
      Math.abs(actual[row][column] - expected[row][column]) <= manifest.tolerance,
      `Route/order mismatch at row${row}/column${column}`);
  }
};
try {
  const { acquireEmbeddingArtifactLease } = await import('../../src/shared/embedding-artifact-lease.js');
  const { getEmbeddingAdapter, disposeEmbeddingAdapterCaches } = await import('../../src/shared/embedding-adapter.js');
  const { getQueryEmbedding } = await import('../../src/retrieval/embedding.js');
  const { admitEmbeddingVector } = await import('../../src/shared/embedding-output-admission.js');
  const { resolveEmbeddingModelProfile } = await import('../../src/shared/embedding-model-profile.js');
  const { formatEmbeddingInput, resolveEmbeddingInputFormatting } = await import('../../src/shared/embedding-input-format.js');
  disposeCaches = disposeEmbeddingAdapterCaches;
  const transformers = await import('@huggingface/transformers');
  transformers.env.allowRemoteModels = false; transformers.env.allowLocalModels = true;
  for (const [name, file] of Object.entries({ transformers: '@huggingface/transformers', onnxruntimeNode: 'onnxruntime-node' })) {
    const metadata = JSON.parse(await fs.readFile(path.join(process.cwd(), 'node_modules', file, 'package.json'), 'utf8'));
    receipt.runtime[name] = metadata.version;
  }
  assert.deepEqual(receipt.runtime, manifest.runtime, 'Freeze actual runtime/binding versions before qualification.');
  for (const file of ['tests/embeddings/actual-export-qualification.js', 'tests/embeddings/run-actual-export-qualification.js',
    'tests/embeddings/helpers/minilm-upstream-reference.js', 'tools/bench/qualification-capsule.js',
    'src/shared/embedding-output-admission.js', 'src/shared/embedding-utils.js', 'src/shared/embedding-artifact-lease.js',
    'src/shared/embedding-transformers-resources.js', 'src/shared/embedding-provider-adapters.js', 'src/shared/embedding-model-profile.js',
    'src/shared/embedding-cache-lifetime.js', 'src/shared/embedding-failure-diagnostics.js',
    'src/shared/embedding-model-loading.js', 'src/shared/embedding-input-format.js', 'src/retrieval/embedding.js',
    'node_modules/@huggingface/transformers/src/env.js', 'node_modules/@huggingface/transformers/src/pipelines/feature-extraction.js',
    'node_modules/@huggingface/transformers/src/models/auto/modeling_auto.js',
    'node_modules/@huggingface/transformers/src/models/auto/tokenization_auto.js',
    'node_modules/@huggingface/transformers/src/models/bert/modeling_bert.js',
    'node_modules/@huggingface/transformers/src/models/modeling_utils.js',
    'node_modules/@huggingface/transformers/src/tokenization_utils.js', 'node_modules/@huggingface/transformers/src/utils/tensor.js',
    'node_modules/@huggingface/transformers/package.json', 'node_modules/onnxruntime-node/package.json']) {
    receipt.sourceOwners.push({ path: file, sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex') });
  }
  const profile = resolveEmbeddingModelProfile(manifest.modelId, manifest.modelProfile);
  if (options.route === 'prepared') assert.equal(profile?.family, 'embeddinggemma2',
    'Prepared inference is supported only for the actual qualified EG2 profile; other exports are explicitly unsupported.');
  lease = await phase('verify-exact-model-closure', () => acquireEmbeddingArtifactLease({ provider: manifest.provider,
    modelId: manifest.modelId, modelsDir: manifest.modelsDir, rootDir: root,
    modelProfile: profile, onnx: manifest.onnxConfig }, { signal: controller.signal }));
  assert.equal(lease.artifact.status, 'verified', 'An immutable-revision name without exact local bytes is insufficient.');
  const byPath = rows => [...rows].sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(byPath(lease.artifact.inventory), byPath(manifest.artifacts)); receipt.modelArtifact = lease.artifact;
  let numericalReference = null;
  if (miniLm) {
    assert.equal(manifest.corpusSource?.path, 'tests/fixtures/embeddings/minilm-provider-corpus.json');
    assert.match(manifest.corpusSource.sha256, /^[a-f0-9]{64}$/);
    const corpus = await readVerifiedContainedFile(process.cwd(), path.resolve(manifest.corpusSource.path),
      { maxBytes: 65536, hashAlgorithm: 'sha256', expectedHash: manifest.corpusSource.sha256, signal: controller.signal });
    const saved = JSON.parse(corpus.buffer.toString('utf8'));
    assert.equal(saved.schemaVersion, 1); assert.equal(saved.provenance, manifest.corpusProvenance); assert.deepEqual(saved.texts, manifest.texts);
    receipt.corpus.source = { path: manifest.corpusSource.path, sha256: corpus.hash };
  }
  if (options['numerical-reference']) {
    assert.equal(miniLm, true, 'Each model family needs an explicitly implemented independent reference.');
    const selected = path.resolve(options['numerical-reference']);
    const snapshot = await readVerifiedContainedFile(path.dirname(selected), selected,
      { maxBytes: 16 * 1024 * 1024, hashAlgorithm: 'sha256', signal: controller.signal });
    numericalReference = JSON.parse(snapshot.buffer.toString('utf8'));
    assert.equal(numericalReference.status, 'numerical-reference'); assert.equal(numericalReference.route, 'upstream-reference');
    assert.deepEqual(numericalReference.referenceRecipe, MINILM_REFERENCE_RECIPE);
    assert.equal(numericalReference.manifest.sha256, receipt.manifest.sha256);
    assert.deepEqual(numericalReference.runtime, receipt.runtime); assert.deepEqual(numericalReference.modelArtifact, receipt.modelArtifact);
    assert.deepEqual(numericalReference.corpus, receipt.corpus);
    for (const source of receipt.sourceOwners.filter(row => row.path.includes('/minilm-upstream-reference.js') || row.path.startsWith('node_modules/'))) {
      assert.equal(numericalReference.sourceOwners.find(row => row.path === source.path)?.sha256, source.sha256);
    }
    receipt.numericalReference = { path: selected, sha256: snapshot.hash, sourceOwners: numericalReference.sourceOwners, comparisons: [] };
  }
  globalThis.Float32Array = new Proxy(originalFloat, { construct(target, args, constructor) {
    const value = Reflect.construct(target, args, constructor), stack = new Error().stack || '';
    const owner = stack.includes('embedding-output-admission.js') ? 'shared-output-admission'
      : stack.includes('normalizeEmbeddingGemma2Output') ? 'explicit-eg2-projection' : null;
    if (owner) allocations.push({ owner, bytes: value.byteLength, elapsedMs: performance.now() - started });
    return value;
  } });
  sampleTimer = setInterval(() => observe('sample'), 5); sampleTimer.unref();
  if (options.route === 'upstream-reference') {
    rawReference = await phase('upstream-raw-components-load', () => createMiniLmUpstreamReference({ transformers, manifest, signal: controller.signal }));
    receipt.referenceRecipe = rawReference.recipe;
    const baseline = await phase('cold-upstream-two-row-batch', () => rawReference.embed(manifest.texts.slice(0, 2)));
    assert.ok(baseline.tokenization.tokenCounts.some(count => count < baseline.rawOutput.dimensions[1]), 'The authored corpus must exercise actual padding masks.');
    receipt.vectors = baseline.vectors.map(vector => [...vector]); receipt.rawBaseline = { tokenization: baseline.tokenization, output: baseline.rawOutput };
    receipt.batchShapes = { singles: [], reversed: null };
    for (let index = 0; index < 2; index++) {
      const result = await phase('upstream-single-' + index, () => rawReference.embed([manifest.texts[index]]));
      receipt.batchShapes.singles.push({ index, vectors: result.vectors.map(vector => [...vector]),
        tokenization: result.tokenization, rawOutput: result.rawOutput });
    }
    const reversed = await phase('upstream-reversed-two-row-batch', () => rawReference.embed(manifest.texts.slice(0, 2).reverse()));
    receipt.batchShapes.reversed = { vectors: reversed.vectors.map(vector => [...vector]),
      tokenization: reversed.tokenization, rawOutput: reversed.rawOutput };
    receipt.largeBatch = [];
    for (let run = 0; run < 3; run++) {
      const began = performance.now(), cpuStart = process.cpuUsage();
      const result = await phase('upstream-large-batch-' + run, () => rawReference.embed(manifest.texts));
      receipt.largeBatch.push({ run, elapsedMs: performance.now() - began, cpu: process.cpuUsage(cpuStart), outputBytes: result.outputBytes,
        tokenization: result.tokenization, rawOutput: result.rawOutput, vectors: result.vectors.map(vector => [...vector]) });
    }
    receipt.crossBatchObservations = { acceptance: 'descriptive export behavior; strict product/reference comparisons use matching batches',
      singleVersusTwoRows: receipt.batchShapes.singles.map((row, index) =>
        measureMiniLmVectorDifference(row.vectors, [receipt.vectors[index]], manifest.tolerance)),
      twoVersusLargeBatch: measureMiniLmVectorDifference(receipt.largeBatch[0].vectors.slice(0, 2), receipt.vectors, manifest.tolerance) };
    for (const run of receipt.largeBatch.slice(1)) compareMiniLmReferenceVectors(run.vectors, receipt.largeBatch[0].vectors, manifest.tolerance);
    receipt.execution = { provider: 'upstream-raw-AutoTokenizer-AutoModel', stub: false, dtype: 'q8', device: 'cpu',
      requestedSessionOptions: { intraOpNumThreads: 1, interOpNumThreads: 1 },
      nativeInternalThreadCounts: 'not observed; upstream option handoff is distinct from native internal measurement' };
  } else {
    adapter = getEmbeddingAdapter({ rootDir: root, provider: manifest.provider, modelId: manifest.modelId,
      dims: manifest.dimensions, modelsDir: manifest.modelsDir, localFilesOnly: true, useStub: false,
      onnxConfig: manifest.onnxConfig, normalize: manifest.normalize !== false, modelProfile: profile,
      modelArtifact: lease.artifact, sessionOptions: { intraOpNumThreads: 1, interOpNumThreads: 1 } });
    const input = manifest.texts.slice(0, 2), baseline = await phase('cold-real-two-row-batch', () => adapter.embed(input, { signal: controller.signal }));
    assert.equal(baseline.length, 2);
    for (const vector of baseline) admitEmbeddingVector(vector, { dimensions: manifest.dimensions });
    assert.equal(adapter.executionInfo().stub, false); assert.equal(adapter.executionInfo().provider, manifest.provider);
    if (numericalReference) receipt.numericalReference.comparisons.push({ phase: 'cold-two-row-batch',
      ...compareMiniLmReferenceVectors(baseline, numericalReference.vectors, manifest.tolerance) });
    if (options.route === 'single') {
      const actual = []; for (const text of input) actual.push(await phase('warm-real-single', () => adapter.embedOne(text, { signal: controller.signal })));
      const expected = numericalReference ? numericalReference.batchShapes.singles.map(row => row.vectors[0]) : baseline;
      assertEqualVectors(actual, expected);
      if (numericalReference) receipt.numericalReference.comparisons.push({ phase: 'warm-real-singles',
        ...compareMiniLmReferenceVectors(actual, expected, manifest.tolerance) });
    } else if (options.route === 'prepared') {
      const prepared = await phase('actual-tokenizer-prepare', () => adapter.prepare(input, { signal: controller.signal }));
      assert.equal(prepared.length, input.length);
      assertEqualVectors(await phase('warm-prepared-batch', () => adapter.embedPrepared(prepared, { signal: controller.signal })), baseline);
      assertEqualVectors(await phase('warm-prepared-single', () => adapter.embedPrepared([prepared[0]], { signal: controller.signal })), [baseline[0]]);
    } else if (options.route === 'query') {
      const formatting = resolveEmbeddingInputFormatting(manifest.modelId);
      if (miniLm) receipt.queryExecutionPolicy = { publicConsumerSessionOptions: 'upstream defaults; no sessionOptions argument on getQueryEmbedding',
        rawReferenceRequested: { intraOpNumThreads: 1, interOpNumThreads: 1 },
        scope: 'numerical comparison only; no matched-thread query resource-cost claim' };
      for (const text of input) {
        const formatted = formatEmbeddingInput(text, { modelId: manifest.modelId, kind: 'query', formatting });
        if (miniLm) assert.equal(formatted, text, 'MiniLM query input is independently defined as the exact raw corpus text.');
        const expected = numericalReference ? numericalReference.batchShapes.singles[input.indexOf(text)].vectors[0]
          : await phase('query-format-oracle', () => adapter.embedOne(formatted, { signal: controller.signal }));
        const actual = await phase('actual-query-consumer', () => getQueryEmbedding({ text, modelId: manifest.modelId,
          dims: manifest.dimensions, modelDir: manifest.modelsDir, provider: manifest.provider, rootDir: root,
          useStub: false, onnxConfig: manifest.onnxConfig, normalize: manifest.normalize !== false,
          modelProfile: profile, modelArtifact: lease.artifact }));
        assert.ok(actual, 'Actual query consumer may not silently skip unavailable inference.'); assertEqualVectors([actual], [expected]);
        if (numericalReference) receipt.numericalReference.comparisons.push({ phase: 'actual-query-consumer',
          ...compareMiniLmReferenceVectors([actual], [expected], manifest.tolerance) });
      }
    } else if (options.route === 'resources') {
      assert.ok(manifest.texts.length >= 32, 'Representative large-batch sampling requires32–64 supplied texts.');
      const runs = [];
      for (let run = 0; run < 3; run++) {
        const allocationStart = allocations.length, began = performance.now(), cpuStart = process.cpuUsage();
        const vectors = await phase('actual-large-batch-' + run, () => adapter.embed(manifest.texts, { signal: controller.signal }));
        const elapsedMs = performance.now() - began, runCpu = process.cpuUsage(cpuStart), comparisonStarted = performance.now();
        assert.equal(vectors.length, manifest.texts.length); for (const vector of vectors) admitEmbeddingVector(vector, { dimensions: manifest.dimensions });
        if (numericalReference) receipt.numericalReference.comparisons.push({ phase: 'large-batch-' + run,
          ...compareMiniLmReferenceVectors(vectors, numericalReference.largeBatch[0].vectors, manifest.tolerance) });
        const allocated = allocations.slice(allocationStart), expectedBytes = vectors.length * manifest.dimensions * 4;
        if (miniLm) {
          assert.equal(allocated.length, vectors.length, 'The actual pooled-tensor route exercises one captured owned copy per input row.');
          assert.equal(allocated.reduce((sum, row) => sum + row.bytes, 0), expectedBytes);
        }
        assert.ok(allocated.reduce((sum, row) => sum + row.bytes, 0) <= expectedBytes,
          'Admission/projection may make only the necessary single owned Float32 output copy.');
        runs.push({ run, elapsedMs, cpu: runCpu, comparisonElapsedMs: performance.now() - comparisonStarted,
          outputBytes: expectedBytes, copies: allocated, vectors: vectors.map(vector => [...vector]) });
      }
      for (const run of runs.slice(1)) assertEqualVectors(run.vectors, runs[0].vectors);
      receipt.largeBatch = runs; receipt.observation = options.observation;
    } else {
      const reversed = await phase('warm-reordered-batch', () => adapter.embed([...input].reverse(), { signal: controller.signal }));
      const oneRow = await phase('warm-one-row-batch', () => adapter.embed([input[0]], { signal: controller.signal }));
      const expectedReversed = numericalReference ? numericalReference.batchShapes.reversed.vectors : [...baseline].reverse();
      const expectedSingle = numericalReference ? numericalReference.batchShapes.singles[0].vectors : [baseline[0]];
      assertEqualVectors(reversed, expectedReversed); assertEqualVectors(oneRow, expectedSingle);
      if (numericalReference) for (const [name, actual, expected] of [['warm-reordered-batch', reversed, expectedReversed],
        ['warm-one-row-batch', oneRow, expectedSingle]]) receipt.numericalReference.comparisons.push({ phase: name,
        ...compareMiniLmReferenceVectors(actual, expected, manifest.tolerance) });
    }
    receipt.vectors = baseline.map(vector => [...vector]); receipt.execution = adapter.executionInfo();
  }
  await phase('verify-loaded-original-closure', () => lease.verifyLoaded());
  if (options.reference) {
    const selected = path.resolve(options.reference);
    const snapshot = await readVerifiedContainedFile(path.dirname(selected), selected,
      { maxBytes: 16 * 1024 * 1024, hashAlgorithm: 'sha256', signal: controller.signal });
    const reference = JSON.parse(snapshot.buffer.toString('utf8'));
    assert.equal(options.route, 'resources'); assert.equal(reference.status, 'sampled-reference'); assert.equal(reference.manifest.sha256, receipt.manifest.sha256);
    assert.deepEqual(reference.modelArtifact, receipt.modelArtifact); assert.deepEqual(reference.runtime, receipt.runtime);
    const sourceDifferences = receipt.sourceOwners.filter(row => row.path.startsWith('src/')
      && reference.sourceOwners.find(previous => previous.path === row.path)?.sha256 !== row.sha256);
    assert.ok(sourceDifferences.length > 0, 'A current-source repeat cannot be labeled a before/after candidate comparison.');
    assertEqualVectors(receipt.vectors, reference.vectors);
    assertEqualVectors(receipt.largeBatch[0].vectors, reference.largeBatch[0].vectors);
    receipt.reference = { path: selected, sha256: snapshot.hash, sourceOwners: reference.sourceOwners,
      sourceDifferences,
      largeBatch: reference.largeBatch.map(({ vectors, ...run }) => run), samples: reference.memorySamples };
  }
  if (options.observation === 'upstream-comparison') receipt.resourceComparison = {
    kind: 'different-implementation-shared-export-observation;not-before-after-performance',
    reference: numericalReference.largeBatch.map(({ vectors, ...run }) => run), referenceSamples: numericalReference.memorySamples,
    scope: 'Raw token outputs and scalar pooling differ from pooled pipeline execution. Compare observed work, not a production validation speedup.' };
  receipt.status = options.route === 'upstream-reference' ? 'numerical-reference'
    : options.observation === 'reference' ? 'sampled-reference' : 'passed';
} catch (error) { rememberFailure(error); receipt.error = diagnostic(error); }
finally {
  for (const [owner, cleanup] of [['raw-reference', () => rawReference?.close()],
    ['adapter', () => adapter?.dispose()], ['adapter-caches', () => disposeCaches?.()]]) {
    try { await cleanup(); } catch (error) {
      (receipt.cleanupErrors ||= []).push({ owner, ...diagnostic(error) }); rememberFailure(error); receipt.status = 'failed';
    }
  }
  lease?.release(); clearInterval(sampleTimer); clearTimeout(deadline); globalThis.Float32Array = originalFloat;
  if (deadlineWrite) { try { await deadlineWrite; } catch (error) { rememberFailure(error); receipt.status = 'failed'; } }
  observe('settled'); receipt.elapsedMs = performance.now() - started; receipt.cpu = process.cpuUsage(cpu);
  receipt.processResourceUsage = process.resourceUsage();
  receipt.memoryScope = '5ms JS samples plus process-lifetime OS high-water; no continuous native-allocation or output-disposal lifetime inference';
  if (receipt.elapsedMs >= 30000) { receipt.status = 'failed'; rememberFailure(new Error('Actual capsule, including original cleanup, exceeded30seconds.')); }
  if (hasFailure) receipt.status = 'failed';
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
if (hasFailure) throw failure;
console.log(JSON.stringify({ status: receipt.status, route: receipt.route, elapsedMs: receipt.elapsedMs,
  receipt: path.join(out, 'receipt.json') }));
