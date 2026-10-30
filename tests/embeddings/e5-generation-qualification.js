import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { requireBootstrap } from '../../src/shared/bootstrap-readiness.js';
import { readVerifiedContainedFile } from '../../src/shared/contained-file.js';
import { acquireEmbeddingArtifactLease } from '../../src/shared/embedding-artifact-lease.js';
import { disposeEmbeddingAdapterCaches } from '../../src/shared/embedding-adapter.js';
import { preserveEmbeddingCleanupFailure } from '../../src/shared/embedding-cache-lifetime.js';
import { captureEmbeddingFailureDiagnostics, projectEmbeddingFailureDiagnostics } from '../../src/shared/embedding-failure-diagnostics.js';
import { captureSweepSource } from '../../tools/bench/ab-sweep-source.js';
import { assertDenseReferenceManifest } from './helpers/dense-upstream-reference.js';
import { captureEmbeddingProviderRuntime } from './helpers/provider-runtime-provenance.js';
import { runQualificationPhase } from './helpers/qualification-phase.js';
import { readE5GenerationSeed, runE5Stage2, runE5Stage3, runE5QueryCache } from './helpers/e5-generation-consumers.js';
import { applyTestEnv } from '../helpers/test-env.js';

// Manual process only. All model and stage operations are original production
// owners; task-owned outputs remain available for the separately bounded stage.
await requireBootstrap();
const args = process.argv.slice(2); assert.equal(args.length % 2, 0);
const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, index) => [args[index * 2].replace(/^--/, ''), args[index * 2 + 1]]));
for (const key of ['manifest', 'out', 'operation']) assert.ok(options[key]);
assert.ok(['stage2', 'stage3', 'query-cache'].includes(options.operation));
if (options.operation !== 'stage2') assert.ok(options.seed);
if (options.operation === 'query-cache') assert.ok(options['numerical-reference']);
const manifestPath = path.resolve(options.manifest), destination = path.resolve(options.out);
const saved = await readVerifiedContainedFile(path.dirname(manifestPath), manifestPath, { maxBytes: 1024 * 1024, hashAlgorithm: 'sha256' });
const manifest = JSON.parse(saved.buffer.toString('utf8')); assertDenseReferenceManifest(manifest);
assert.equal(manifest.modelId, 'intfloat/multilingual-e5-large-instruct');
await fs.mkdir(destination); applyTestEnv({ embeddings: null, extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const started = performance.now(), cpu = process.cpuUsage(), controller = new AbortController(), phases = [], samples = [];
const observe = name => samples.push({ phase: name, elapsedMs: performance.now() - started, ...process.memoryUsage() });
const phase = (name, operation, adopt = null) => runQualificationPhase({ name, operation, adopt, signal: controller.signal, phases, observe });
const receipt = { schemaVersion: 1, status: 'failed', operation: options.operation, historicalAuthorWorkspace: true,
  manifest: { path: manifestPath, sha256: saved.hash }, source: captureSweepSource(process.cwd()),
  phases, memorySamples: samples, sourceOwners: [], modelArtifact: null };
let lease, failure, failed = false;
const remember = error => { failure = failed ? preserveEmbeddingCleanupFailure(failure, error) : error; failed = true; };
const deadline = setTimeout(() => controller.abort(new Error('Original E5 generation capsule crossed30seconds.')), 30000);
const timer = setInterval(() => observe('sample'), 5); timer.unref();
try {
  assert.equal(receipt.source.state, 'clean-revision');
  const transformers = await import('@huggingface/transformers');
  transformers.env.allowRemoteModels = false; transformers.env.allowLocalModels = true;
  receipt.runtime = Object.fromEntries(await Promise.all([['transformers', '@huggingface/transformers'], ['onnxruntimeNode', 'onnxruntime-node']]
    .map(async ([name, dependency]) => [name, JSON.parse(await fs.readFile(path.join(process.cwd(), 'node_modules', dependency, 'package.json'))).version])));
  assert.deepEqual(receipt.runtime, manifest.runtime);
  receipt.providerRuntime = await phase('verify-original-provider-runtime', () => captureEmbeddingProviderRuntime({ provider: 'xenova', signal: controller.signal }));
  assert.equal(receipt.providerRuntime.binding.moduleCacheLoaded, true);
  assert.deepEqual(manifest.providerRuntime, { name: receipt.providerRuntime.name, version: receipt.providerRuntime.version });
  for (const file of ['tests/embeddings/e5-generation-qualification.js', 'tests/embeddings/helpers/e5-generation-consumers.js',
    'tests/embeddings/helpers/provider-runtime-provenance.js', 'src/index/embedding.js', 'src/index/build/runtime/embeddings.js',
    'src/retrieval/embedding.js', 'src/retrieval/cli/run-search-session/embedding-cache.js', 'src/retrieval/index-cache.js',
    'src/shared/embedding-identity.js', 'src/shared/embedding-input-format.js', 'tools/build/embeddings/runner.js',
    'tools/build/embeddings/runtime-receipt.js']) receipt.sourceOwners.push({ path: file,
    sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex') });
  await phase('verify-actual-model-bytes', () => acquireEmbeddingArtifactLease({ provider: 'xenova', modelId: manifest.modelId,
    modelsDir: manifest.modelsDir, rootDir: destination }, { signal: controller.signal }), value => { lease = value; });
  assert.equal(lease.artifact.status, 'verified');
  assert.deepEqual([...lease.artifact.inventory].sort((a, b) => a.path < b.path ? -1 : 1),
    [...manifest.artifacts].sort((a, b) => a.path < b.path ? -1 : 1)); receipt.modelArtifact = lease.artifact;
  if (options.operation === 'stage2') Object.assign(receipt, await runE5Stage2({ destination, manifest, artifact: lease.artifact,
    signal: controller.signal, phase }));
  else {
    const input = await readE5GenerationSeed({ filename: options.seed, manifestHash: saved.hash, artifact: lease.artifact, signal: controller.signal });
    assert.equal(input.receipt.operation, options.operation === 'stage3' ? 'stage2' : 'stage3');
    assert.deepEqual(input.receipt.source, receipt.source);
    assert.deepEqual(input.receipt.providerRuntime, receipt.providerRuntime);
    receipt.seedSource = { path: path.resolve(options.seed), sha256: input.sha256 };
    Object.assign(receipt, options.operation === 'stage3'
      ? await runE5Stage3({ seed: input.seed, manifest, artifact: lease.artifact, signal: controller.signal, phase })
      : await runE5QueryCache({ seed: input.seed, manifest, manifestHash: saved.hash, artifact: lease.artifact,
        reference: options['numerical-reference'], providerRuntime: receipt.providerRuntime, source: receipt.source, signal: controller.signal, phase }));
  }
  await phase('verify-loaded-original-model-bytes', () => lease.verifyLoaded());
  assert.deepEqual(captureSweepSource(process.cwd()), receipt.source);
  receipt.status = 'passed';
} catch (error) {
  remember(error); const diagnostic = captureEmbeddingFailureDiagnostics(error), projected = {};
  projectEmbeddingFailureDiagnostics(projected, diagnostic);
  receipt.error = { name: projected.name, code: projected.code, message: diagnostic.message, ownershipPending: !diagnostic.released() };
} finally {
  try { await disposeEmbeddingAdapterCaches(); } catch (error) { remember(error); receipt.status = 'failed'; }
  lease?.release(); clearInterval(timer); clearTimeout(deadline); observe('settled');
  receipt.elapsedMs = performance.now() - started; receipt.cpu = process.cpuUsage(cpu); receipt.processResourceUsage = process.resourceUsage();
  receipt.memoryScope = '5ms JS samples and process-lifetime OS high-water;no exact transient/native allocation or unload claim';
  if (receipt.elapsedMs >= 30000) remember(new Error('E5 capsule including original cleanup exceeded30seconds.'));
  if (failed) receipt.status = 'failed';
  await fs.writeFile(path.join(destination, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
}
if (failed) throw failure;
console.log(JSON.stringify({ status: receipt.status, operation: options.operation, receipt: path.join(destination, 'receipt.json') }));
