import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { buildEmbeddingIdentityKey } from '../../../src/shared/embedding-identity.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { getIndexDir, loadUserConfig } from '../../../src/shared/dict-utils.js';
import { buildIndexSignatureInfo } from '../../../src/retrieval/index-cache.js';
import { loadDenseJudgedCorpus } from './dense-judged-corpus.js';
import { compareDenseReferenceVectors, resolveDenseReferenceRecipe } from './dense-upstream-reference.js';
import { createEmbeddingResolver } from '../../../src/retrieval/cli/run-search-session/embedding-cache.js';
import { createRetrievalWorkObservation } from '../../../src/contracts/retrieval-work.js';
import { getEmbeddingArtifactLeaseMetrics } from '../../../src/shared/embedding-artifact-lease.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const queryPrefix = 'Instruct: Given a code search query, retrieve relevant source code or documentation passages that answer the query\nQuery: ';
const readJson = async (file, signal) => {
  const read = await readVerifiedContainedFile(path.dirname(file), file, { maxBytes: 16 * 1024 * 1024, hashAlgorithm: 'sha256', signal });
  return { value: JSON.parse(read.buffer.toString('utf8')), sha256: read.hash };
};
const contained = (root, file) => {
  const relative = path.relative(root, file);
  assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
};
export const assertE5GenerationIdentity = (state, artifact) => {
  const identity = state.embeddings.embeddingIdentity;
  assert.equal(state.embeddings.ready, true); assert.equal(identity.stub, false);
  assert.equal(identity.modelId, 'intfloat/multilingual-e5-large-instruct'); assert.equal(identity.provider, 'xenova');
  assert.equal(identity.dims, 1024); assert.equal(identity.maxLength, 512); assert.equal(identity.pooling, 'mean'); assert.equal(identity.normalize, true);
  assert.equal(identity.inputFormatting.queryPrefix, queryPrefix); assert.equal(identity.inputFormatting.passagePrefix, null);
  assert.equal(identity.acquisition.dtype, 'fp32'); assert.equal(identity.acquisition.revision, 'c9e87c786ffac96aeaeb42863276930883923ecb');
  assert.deepEqual(identity.modelArtifact, artifact);
  assert.equal(state.embeddings.embeddingIdentityKey, buildEmbeddingIdentityKey(identity));
  return identity;
};
const observeIndex = async (indexDir, artifact, signal) => {
  const read = await readJson(path.join(indexDir, 'index_state.json'), signal);
  const signature = await buildIndexSignatureInfo(indexDir);
  assert.equal(signature.buildId, read.value.buildId); assert.equal(signature.mode, 'code');
  assert(signature.signature.includes('state:' + read.sha256), 'The original query generation owner hashes these actual persisted bytes.');
  return { indexDir, state: read.value, stateSha256: read.sha256, signature,
    identity: assertE5GenerationIdentity(read.value, artifact) };
};
const assertSource = async (seed, signal) => {
  contained(seed.ownerRoot, seed.repoRoot); contained(seed.ownerRoot, seed.cacheRoot); contained(seed.ownerRoot, seed.indexRoot);
  for (const row of seed.sources) await readVerifiedContainedFile(seed.repoRoot, path.join(seed.repoRoot, row.path), {
    expectedHash: row.sha256, expectedBytes: row.bytes, hashAlgorithm: 'sha256', maxBytes: 4096, signal });
};
export const readE5GenerationSeed = async ({ filename, manifestHash, artifact, signal }) => {
  const read = await readJson(path.resolve(filename), signal), receipt = read.value;
  assert.equal(receipt.status, 'passed'); assert.ok(['stage2', 'stage3'].includes(receipt.operation));
  assert.equal(receipt.manifest.sha256, manifestHash); assert.deepEqual(receipt.modelArtifact, artifact);
  await assertSource(receipt.generationSeed, signal);
  return { seed: receipt.generationSeed, receipt, sha256: read.sha256 };
};
const configFor = (manifest, cacheRoot) => createFastIndexingTestConfig({ threads: 1,
  models: { id: manifest.modelId, dir: manifest.modelsDir },
  indexing: { embeddingBatchSize: 1, workerPool: { enabled: false },
    embeddings: { enabled: true, mode: 'inline', provider: 'xenova', normalize: true },
    twoStage: { stage2: { embeddings: { enabled: true, mode: 'inline' } } } }, cache: { root: cacheRoot } });
const applySeed = (seed, manifest) => applyTestEnv({ cacheRoot: seed.cacheRoot, embeddings: null,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null }, testConfig: configFor(manifest, seed.cacheRoot) });

export const runE5Stage2 = async ({ destination, manifest, artifact, signal, phase }) => {
  const ownerRoot = path.join(destination, 'owned-generation'), repoRoot = path.join(ownerRoot, 'repo'), cacheRoot = path.join(ownerRoot, 'cache');
  await fs.mkdir(repoRoot, { recursive: true });
  const corpus = await loadDenseJudgedCorpus({ manifest, signal }), source = corpus.documents.find(row => row.id === 'json-code');
  const sourceFile = 'runtime-config.js'; await fs.writeFile(path.join(repoRoot, sourceFile), source.text);
  const seed = { ownerRoot, repoRoot, cacheRoot, indexRoot: null, sources: [{ path: sourceFile, bytes: source.bytes,
    sha256: source.sha256, sha1: createHash('sha1').update(source.text).digest('hex') }] };
  applySeed(seed, manifest);
  const { buildIndex } = await import('../../../src/integrations/core/build-index/index.js');
  const logs = [], append = line => { if (logs.length < 2048) logs.push(String(line)); };
  const result = await phase('actual-one-file-stage2-inline', () => buildIndex(repoRoot, { mode: 'code', stage: 'stage2',
    model: manifest.modelId, dims: 1024, threads: 1, incremental: false, progress: 'off', quiet: true,
    'scm-provider': 'none', abortSignal: signal, log: append }));
  const indexDir = getIndexDir(repoRoot, 'code', loadUserConfig(repoRoot)); seed.indexRoot = path.dirname(indexDir);
  contained(ownerRoot, seed.indexRoot);
  if (result.buildRoot) assert.equal(path.resolve(result.buildRoot), seed.indexRoot);
  const observed = await observeIndex(indexDir, artifact, signal);
  const build = await readJson(path.join(seed.indexRoot, 'build_state.json'), signal);
  assert.equal(build.value.buildId, observed.state.buildId);
  const attempts = build.value.runtime.attempts.filter(row => row.stage === 'stage2');
  assert(attempts.some(row => row.lifecycle === 'succeeded' && row.embeddings?.observation?.state === 'ready'
    && row.embeddings.observation.dims === 1024 && row.embeddings.observation.method === 'successful-inference'),
  'Actual Stage2 must observe real E5 inference;configured intent alone is insufficient.');
  const { readCompletedStage } = await import('../../../src/index/build/completed-stage.js');
  const { verifyStageSnapshot } = await import('../../../src/index/build/stage-snapshot.js');
  const completed = await readCompletedStage({ buildRoot: seed.indexRoot, mode: 'code', signal });
  const snapshot = await phase('verify-original-stage2-snapshot', () => verifyStageSnapshot({ buildRoot: seed.indexRoot,
    buildId: observed.state.buildId, repoRoot, mode: 'code', locator: completed.snapshot, signal }));
  seed.stage2 = await observeIndex(path.join(snapshot.snapshotRoot, 'index-code'), artifact, signal);
  await assertSource(seed, signal);
  return { generationSeed: seed, stage: observed, attempts, logs,
    scope: 'One actual saved JS source,normal inline Stage2 and immutable completion snapshot;no factory,stub or corpus index.' };
};

export const runE5Stage3 = async ({ seed, manifest, artifact, signal, phase }) => {
  applySeed(seed, manifest); await assertSource(seed, signal);
  const stage2 = await observeIndex(seed.stage2.indexDir, artifact, signal);
  assert.equal(stage2.stateSha256, seed.stage2.stateSha256);
  const { runBuildEmbeddings } = await import('../../../tools/build/embeddings/run.js');
  const summary = await phase('actual-pinned-stage3', () => runBuildEmbeddings(['--repo', seed.repoRoot, '--index-root', seed.indexRoot,
    '--mode', 'code', '--model', manifest.modelId, '--dims', '1024', '--threads', '1', '--batch', '1', '--progress', 'off', '--quiet'], { signal }));
  seed.stage3 = await observeIndex(path.join(seed.indexRoot, 'index-code'), artifact, signal);
  assert.equal(seed.stage3.state.buildId, stage2.state.buildId);
  assert.deepEqual(seed.stage3.identity, stage2.identity, 'Stage2/3 must persist one exact model/input/precision/artifact identity.');
  assert.match(seed.stage3.state.embeddings.embeddingGeneration, /^[a-f0-9]{64}$/);
  const build = await readJson(path.join(seed.indexRoot, 'build_state.json'), signal);
  const attempt = build.value.runtime.attempts.filter(row => row.stage === 'stage3').at(-1);
  assert.equal(attempt.lifecycle, 'succeeded'); assert.deepEqual(attempt.embeddings.resolvedIdentity, stage2.identity);
  assert.equal(attempt.runtime.writer.pending, 0); assert.equal(attempt.runtime.writer.pendingBytes, 0); assert.equal(attempt.runtime.writer.failed, 0);
  assert(attempt.embeddings.inferenceBatches > 0 || attempt.embeddings.observation.state === 'cache-only',
    'Record actual inference or original verified cache reuse;do not relabel cache-only work as native inference.');
  assert.equal((await observeIndex(seed.stage2.indexDir, artifact, signal)).stateSha256, stage2.stateSha256);
  await assertSource(seed, signal);
  return { generationSeed: seed, stage: seed.stage3, attempt, summary,
    scope: 'Original Stage3 runner pinned to the same source/build;inference/cache disposition is observed,not forced.' };
};

export const runE5QueryCache = async ({ seed, manifest, manifestHash, artifact, reference, providerRuntime, source, signal, phase }) => {
  applySeed(seed, manifest); await assertSource(seed, signal);
  const corpus = await loadDenseJudgedCorpus({ manifest, signal }), query = corpus.queries[0];
  const raw = await readJson(path.resolve(reference), signal);
  assert.equal(raw.value.status, 'numerical-reference'); assert.equal(raw.value.cohort, 'judged-queries');
  assert.equal(raw.value.manifest.sha256, manifestHash); assert.deepEqual(raw.value.referenceRecipe, resolveDenseReferenceRecipe(manifest.modelId));
  assert.deepEqual(raw.value.modelArtifact, artifact); assert.equal(raw.value.judged.rows[0].id, query.id);
  assert.deepEqual(raw.value.providerRuntime, providerRuntime); assert.deepEqual(raw.value.runtime, manifest.runtime);
  assert.deepEqual(raw.value.source, source, 'Native reference and generation consumers must come from the same frozen clean source.');
  const generations = [await observeIndex(seed.stage2.indexDir, artifact, signal), await observeIndex(seed.stage3.indexDir, artifact, signal)];
  assert.equal(generations[0].stateSha256, seed.stage2.stateSha256); assert.equal(generations[1].stateSha256, seed.stage3.stateSha256);
  assert.notDeepEqual(generations[0].signature, generations[1].signature);
  const observations = [];
  const invoke = async (generation, name, formatting = generation.identity.inputFormatting, expected = generation.identity) => {
    const work = createRetrievalWorkObservation(), began = performance.now(), cpu = process.cpuUsage(), before = getEmbeddingArtifactLeaseMetrics();
    const resolver = createEmbeddingResolver({ throwIfAborted: () => signal.throwIfAborted(), embeddingQueryText: query.text,
      modelConfig: { dir: manifest.modelsDir }, useStubEmbeddings: false, embeddingProvider: 'xenova', embeddingOnnx: null,
      rootDir: seed.repoRoot, generation: generation.signature, work });
    let vector = null, failure, failed = false;
    try { vector = await phase(name, () => resolver(manifest.modelId, 1024, true, formatting, null, expected, 'code')); }
    catch (error) { failed = true; failure = error; }
    const elapsedMs = performance.now() - began, after = getEmbeddingArtifactLeaseMetrics();
    observations.push({ name, elapsedMs, cpu: process.cpuUsage(cpu), work, failed, generation: generation.signature,
      artifactVerificationBytes: after.bytesHashed - before.bytesHashed, vectorSha256: vector ? sha(JSON.stringify([...vector])) : null });
    if (vector) compareDenseReferenceVectors([vector], [raw.value.judged.rows[0].vector], 1e-5);
    if (failed) throw failure;
    return vector;
  };
  for (let index = 0; index < generations.length; index++) {
    assert(await invoke(generations[index], `generation-${index}-cold`));
    assert(await invoke(generations[index], `generation-${index}-warm`));
    const [cold, warm] = observations.slice(-2);
    assert.deepEqual([cold.work.embeddingRequests, cold.work.embeddingApiCalls, cold.work.embeddingCacheHits], [1, 1, 0]);
    assert.deepEqual([warm.work.embeddingRequests, warm.work.embeddingApiCalls, warm.work.embeddingCacheHits], [1, 0, 1]);
    assert.equal(cold.vectorSha256, warm.vectorSha256); assert.equal(warm.work.models.code.stub, false);
  }
  const legacy = { family: 'e5', queryPrefix: 'query: ', passagePrefix: 'passage: ' };
  assert.equal(await invoke(generations[1], 'stale-template-rejected', legacy), null);
  await assert.rejects(invoke(generations[1], 'stale-identity-rejected', generations[1].identity.inputFormatting,
    { ...generations[1].identity, version: 0 }), { code: 'ERR_EMBEDDING_IDENTITY_UNSUPPORTED' });
  assert(await invoke(generations[1], 'healthy-after-negative'));
  assert.deepEqual([observations.at(-1).work.embeddingApiCalls, observations.at(-1).work.embeddingCacheHits], [0, 1]);
  await assertSource(seed, signal);
  return { generationSeed: seed, observations, numericalReference: { path: path.resolve(reference), sha256: raw.sha256 },
    expectedWarning: '[embeddings] Query embedder unavailable; skipping ANN. Persisted embedding formatting does not match multilingual-e5-large-instruct-code-retrieval-v1. Rebuild the dense index.',
    scope: 'Original process query-vector-result cache using default public getQueryEmbedding;fresh artifact verification remains included on cache hits;API counters are not native-kernel counters.' };
};
