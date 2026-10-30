import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { applyTestEnv } from '../helpers/test-env.js';

/** Explicit offline/native capsule, intentionally outside ordinary test discovery.
 * Missing export/tokenizer/corpus/reference is a prerequisite failure, never a
 * skipped or stub-backed pass. Run capsules serially under the outer 30s owner.
 */
const args = process.argv.slice(2); assert.equal(args.length % 2, 0);
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) =>
  [args[index * 2].replace(/^--/, ''), args[index * 2 + 1]]));
for (const key of ['manifest', 'route', 'out']) assert.ok(options[key], 'Required --' + key);
assert.ok(['single', 'batch', 'prepared', 'query', 'resources'].includes(options.route));
if (options.route === 'resources') assert.ok(['reference', 'candidate'].includes(options.observation),
  'Resource sampling requires explicit --observation reference|candidate.');
if (options.observation === 'candidate') assert.ok(options.reference, 'Candidate comparison requires --reference from the frozen source/reference run.');
await requireBootstrap();
const manifestBytes = await fs.readFile(path.resolve(options.manifest)); assert.ok(manifestBytes.length <= 1024 * 1024);
const manifest = JSON.parse(manifestBytes);
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
  qualification: 'actual offline export/tokenizer/provider routes; supplied bounded corpus, no general performance gain claim',
  phases, allocations, memorySamples: samples, vectors: [] };
let adapter, lease, disposeCaches, failure, sampleTimer, deadlineWrite;
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
  deadlineWrite.catch(error => { failure ||= error; });
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
  for (const file of ['src/shared/embedding-output-admission.js', 'src/shared/embedding-utils.js',
    'src/shared/embedding-provider-adapters.js', 'src/shared/embedding-model-profile.js', 'src/retrieval/embedding.js']) {
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
  globalThis.Float32Array = new Proxy(originalFloat, { construct(target, args, constructor) {
    const value = Reflect.construct(target, args, constructor), stack = new Error().stack || '';
    const owner = stack.includes('embedding-output-admission.js') ? 'shared-output-admission'
      : stack.includes('normalizeEmbeddingGemma2Output') ? 'explicit-eg2-projection' : null;
    if (owner) allocations.push({ owner, bytes: value.byteLength, elapsedMs: performance.now() - started });
    return value;
  } });
  adapter = getEmbeddingAdapter({ rootDir: root, provider: manifest.provider, modelId: manifest.modelId,
    dims: manifest.dimensions, modelsDir: manifest.modelsDir, localFilesOnly: true, useStub: false,
    onnxConfig: manifest.onnxConfig, normalize: manifest.normalize !== false, modelProfile: profile,
    modelArtifact: lease.artifact, sessionOptions: { intraOpNumThreads: 1, interOpNumThreads: 1 } });
  sampleTimer = setInterval(() => observe('sample'), 5); sampleTimer.unref();
  const input = manifest.texts.slice(0, 2), baseline = await phase('cold-real-two-row-batch', () => adapter.embed(input, { signal: controller.signal }));
  assert.equal(baseline.length, 2);
  for (const vector of baseline) admitEmbeddingVector(vector, { dimensions: manifest.dimensions });
  assert.equal(adapter.executionInfo().stub, false); assert.equal(adapter.executionInfo().provider, manifest.provider);
  if (options.route === 'single') {
    const actual = []; for (const text of input) actual.push(await phase('warm-real-single', () => adapter.embedOne(text, { signal: controller.signal })));
    assertEqualVectors(actual, baseline);
  } else if (options.route === 'prepared') {
    const prepared = await phase('actual-tokenizer-prepare', () => adapter.prepare(input, { signal: controller.signal }));
    assert.equal(prepared.length, input.length);
    assertEqualVectors(await phase('warm-prepared-batch', () => adapter.embedPrepared(prepared, { signal: controller.signal })), baseline);
    assertEqualVectors(await phase('warm-prepared-single', () => adapter.embedPrepared([prepared[0]], { signal: controller.signal })), [baseline[0]]);
  } else if (options.route === 'query') {
    const formatting = resolveEmbeddingInputFormatting(manifest.modelId);
    for (const text of input) {
      const formatted = formatEmbeddingInput(text, { modelId: manifest.modelId, kind: 'query', formatting });
      const expected = await phase('query-format-oracle', () => adapter.embedOne(formatted, { signal: controller.signal }));
      const actual = await phase('actual-query-consumer', () => getQueryEmbedding({ text, modelId: manifest.modelId,
        dims: manifest.dimensions, modelDir: manifest.modelsDir, provider: manifest.provider, rootDir: root,
        useStub: false, onnxConfig: manifest.onnxConfig, normalize: manifest.normalize !== false,
        modelProfile: profile, modelArtifact: lease.artifact }));
      assert.ok(actual, 'Actual query consumer may not silently skip unavailable inference.'); assertEqualVectors([actual], [expected]);
    }
  } else if (options.route === 'resources') {
    assert.ok(manifest.texts.length >= 32, 'Representative large-batch sampling requires32–64 supplied texts.');
    const runs = [];
    for (let run = 0; run < 3; run++) {
      const allocationStart = allocations.length, began = performance.now(), cpuStart = process.cpuUsage();
      const vectors = await phase('actual-large-batch-' + run, () => adapter.embed(manifest.texts, { signal: controller.signal }));
      assert.equal(vectors.length, manifest.texts.length); for (const vector of vectors) admitEmbeddingVector(vector, { dimensions: manifest.dimensions });
      const allocated = allocations.slice(allocationStart), expectedBytes = vectors.length * manifest.dimensions * 4;
      assert.ok(allocated.reduce((sum, row) => sum + row.bytes, 0) <= expectedBytes,
        'Admission/projection may make only the necessary single owned Float32 output copy.');
      runs.push({ run, elapsedMs: performance.now() - began, cpu: process.cpuUsage(cpuStart),
        outputBytes: expectedBytes, copies: allocated, vectors: vectors.map(vector => [...vector]) });
    }
    for (const run of runs.slice(1)) assertEqualVectors(run.vectors, runs[0].vectors);
    receipt.largeBatch = runs; receipt.observation = options.observation;
  } else {
    assertEqualVectors(await phase('warm-reordered-batch', () => adapter.embed([...input].reverse(), { signal: controller.signal })), [...baseline].reverse());
    assertEqualVectors(await phase('warm-one-row-batch', () => adapter.embed([input[0]], { signal: controller.signal })), [baseline[0]]);
  }
  receipt.vectors = baseline.map(vector => [...vector]); receipt.execution = adapter.executionInfo();
  await phase('verify-loaded-original-closure', () => lease.verifyLoaded());
  if (options.reference) {
    const reference = JSON.parse(await fs.readFile(path.resolve(options.reference), 'utf8'));
    assert.equal(reference.status, 'sampled-reference'); assert.equal(reference.manifest.sha256, receipt.manifest.sha256);
    assert.deepEqual(reference.modelArtifact, receipt.modelArtifact); assert.deepEqual(reference.runtime, receipt.runtime);
    assertEqualVectors(receipt.vectors, reference.vectors);
    assertEqualVectors(receipt.largeBatch[0].vectors, reference.largeBatch[0].vectors);
    receipt.reference = { path: path.resolve(options.reference), sourceOwners: reference.sourceOwners,
      largeBatch: reference.largeBatch.map(({ vectors, ...run }) => run), samples: reference.memorySamples };
  }
  receipt.status = options.observation === 'reference' ? 'sampled-reference' : 'passed';
} catch (error) { failure = error; receipt.error = { name: error.name, code: error.code, message: error.message, stack: error.stack }; }
finally {
  try { await adapter?.dispose(); await disposeCaches?.(); }
  catch (error) { receipt.cleanupError = { name: error.name, code: error.code, message: error.message }; failure ||= error; receipt.status = 'failed'; }
  lease?.release(); clearInterval(sampleTimer); clearTimeout(deadline); globalThis.Float32Array = originalFloat;
  if (deadlineWrite) { try { await deadlineWrite; } catch (error) { failure ||= error; receipt.status = 'failed'; } }
  observe('settled'); receipt.elapsedMs = performance.now() - started; receipt.cpu = process.cpuUsage(cpu);
  receipt.processResourceUsage = process.resourceUsage();
  receipt.memoryScope = '5ms JS samples plus process-lifetime OS high-water; no continuous native-allocation or output-disposal lifetime inference';
  if (receipt.elapsedMs >= 30000) { receipt.status = 'failed'; failure ||= new Error('Actual capsule, including original cleanup, exceeded30seconds.'); }
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
if (failure) throw failure;
console.log(JSON.stringify({ status: receipt.status, route: receipt.route, elapsedMs: receipt.elapsedMs,
  receipt: path.join(out, 'receipt.json') }));
