import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { createOnnxEmbedder } from '../../../src/shared/onnx-embeddings.js';
import { createOnnxQualificationBinding, createOnnxQualificationLease, closeOnnxQualificationLease,
  sealOnnxMemoryEvidence } from '../../../src/shared/onnx-embeddings/qualification.js';
import { resolveEmbeddingArtifactIdentityAsync } from '../../../src/shared/embedding-artifact-lease.js';
import { embeddingArtifactReusable } from '../../../src/shared/embedding-artifact-identity.js';
import { observeProcessThreads } from '../../../src/shared/provider-thread-observation.js';
import { resolveOnnxModelPath } from '../../../src/shared/onnx-embeddings/config.js';

const safeBaseline = Object.freeze({ sessions: 1, intraOpNumThreads: 1, interOpNumThreads: 1,
  graphOptimizationLevel: 'basic', enableCpuMemArena: false, enableMemPattern: false });
const invalid = message => Object.assign(new Error(message), { code: 'ERR_ONNX_PROFILE_EXPERIMENT' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export const defaultOnnxProfileTexts = () => Array.from({ length: 16 }, (_, index) => index === 0 ? ''
  : `case ${index}: function value_${index}(input) { return input; }\n` + 'mixed length documentation λ '.repeat(1 + index * 5));

const compareVectors = (reference, actual) => {
  if (reference.length !== actual.length) throw invalid('Profile result count changed.');
  let maxAbsoluteError = 0, sumSquaredError = 0, coordinates = 0;
  for (let row = 0; row < reference.length; row++) {
    if (!reference[row].length || actual[row].length !== reference[row].length) throw invalid('Profile dimensions or output association changed.');
    for (let coordinate = 0; coordinate < reference[row].length; coordinate++) {
      const delta = Math.abs(reference[row][coordinate] - actual[row][coordinate]);
      if (!Number.isFinite(delta)) throw invalid('Profile produced nonfinite vectors.');
      maxAbsoluteError = Math.max(maxAbsoluteError, delta); sumSquaredError += delta * delta; coordinates++;
    }
  }
  const rank = (vectors, query) => vectors.map((row, id) => ({ id,
    score: row.reduce((sum, value, coordinate) => sum + value * query[coordinate], 0) }))
    .sort((left, right) => right.score - left.score || left.id - right.id).slice(0, 5);
  let topKChanged = 0, maxScoreDrift = 0;
  for (const index of [0, Math.floor(reference.length / 2), reference.length - 1]) {
    const expected = rank(reference, reference[index]), candidate = rank(actual, reference[index]);
    if (expected.some((row, at) => row.id !== candidate[at]?.id)) topKChanged++;
    for (let at = 0; at < expected.length; at++) maxScoreDrift = Math.max(maxScoreDrift, Math.abs(expected[at].score - candidate[at].score));
  }
  return { maxAbsoluteError, rootMeanSquaredError: Math.sqrt(sumSquaredError / Math.max(1, coordinates)),
    coordinates, absoluteTolerance: 1e-4, numericalPass: maxAbsoluteError <= 1e-4, topKChanged,
    topKQueries: 3, k: 5, maxScoreDrift, accepted: false };
};

const sourceIdentity = async () => Object.fromEntries(await Promise.all([
  ['experiment', import.meta.url], ['runtime', new URL('../../../src/shared/onnx-embeddings.js', import.meta.url)],
  ['output', new URL('../../../src/shared/onnx-embeddings/output.js', import.meta.url)],
  ['qualification', new URL('../../../src/shared/onnx-embeddings/qualification.js', import.meta.url)],
  ['resourceLifetime', new URL('../../../src/shared/onnx-embeddings/resource-lifetime.js', import.meta.url)]
].map(async ([name, url]) => {
  const bytes = await fs.readFile(new URL(url));
  if (bytes.length > 1024 * 1024) throw invalid('Profile source identity exceeded its bounded input.');
  return [name, hash(bytes)];
})));

/** One case only; its executable owner supervises the entire child at28s.
 * Injected sessions author control-flow fixtures, never native memory evidence.
 */
export const runOnnxProfileExperiment = async ({ rootDir, modelId, modelsDir, onnxConfig, envelope, memory,
  candidate, memoryEvidence = null, texts = defaultOnnxProfileTexts(), batchSize = 4, rounds = 2,
  signal = null, createSession = createOnnxEmbedder }) => {
  if (candidate && Object.keys(candidate).some(key => !Object.hasOwn(safeBaseline, key))) throw invalid('Unknown experiment session setting.');
  candidate = { ...safeBaseline, ...(candidate || {}) };
  if (!Array.isArray(texts) || !texts.length || texts.length > 64 || texts.some(text => typeof text !== 'string')
    || texts.reduce((bytes, text) => bytes + Buffer.byteLength(text), 0) > 64 * 1024
    || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 16
    || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 4) throw invalid('Profile workload exceeds the bounded case contract.');
  if (!Number.isSafeInteger(memory?.rssBytes) || memory.rssBytes < 0
    || !Number.isSafeInteger(memory?.freeBytes) || memory.freeBytes <= 0) throw invalid('Profile requires current effective memory headroom.');
  throwIfAborted(signal);
  const started = performance.now(), verificationStarted = performance.now();
  const modelArtifact = await resolveEmbeddingArtifactIdentityAsync({ provider: 'onnx', modelId, modelsDir,
    rootDir, onnx: onnxConfig });
  if (!embeddingArtifactReusable(modelArtifact) || modelArtifact.status !== 'verified') throw invalid('Real profile experiments require verified model/tokenizer bytes.');
  const verificationMs = performance.now() - verificationStarted;
  const modelPath = resolveOnnxModelPath({ rootDir, modelPath: onnxConfig?.modelPath, modelsDir, modelId });
  const source = await sourceIdentity(), cpuBudget = envelope?.concurrency?.cpuConcurrency?.value;
  const workload = { digest: hash(JSON.stringify(texts)), texts: texts.length, batchSize, rounds,
    utf8Bytes: texts.reduce((bytes, text) => bytes + Buffer.byteLength(text), 0) };
  const bindingFor = settings => {
    const { sessions: ignored, ...sessionSettings } = settings; void ignored;
    return createOnnxQualificationBinding({ modelArtifact, modelPath, cpuBudget, memory, source,
      workload, sessionSettings, processing: { normalize: true, pooling: 'preferred-output-or-host-mask-mean-v1', truncation: 'truncate' } });
  };
  const candidateBinding = bindingFor(candidate);
  const candidateLease = createOnnxQualificationLease({ binding: candidateBinding, candidate, memory, memoryEvidence });
  const baselineBinding = bindingFor(safeBaseline);
  const baselineLease = createOnnxQualificationLease({ binding: baselineBinding, candidate: safeBaseline, memory });
  const native = createSession === createOnnxEmbedder;
  let primary = null, reference = null, baseline = null, measured = null;
  const execute = async (settings, lease) => {
    const sessions = [], stages = { rssBefore: process.memoryUsage().rss, peakRssBytes: 0,
      threadBefore: observeProcessThreads(), initializationMs: 0, warmupMs: 0, inferenceMs: 0 };
    const ceiling = memory.rssBytes + Math.floor(memory.freeBytes / 2);
    let pressure = false;
    const sample = () => {
      const rss = process.memoryUsage().rss;
      stages.peakRssBytes = Math.max(stages.peakRssBytes, rss);
      stages.processLifetimeHighWaterRssBytes = process.resourceUsage().maxRSS * 1024;
      if (rss > ceiling) pressure = true;
    };
    const check = () => { throwIfAborted(signal); if (pressure) throw invalid('Profile crossed its sampled current-memory envelope.'); };
    sample(); const sampler = setInterval(sample, 5); sampler.unref?.();
    const beforeCpu = process.cpuUsage(); let failure = null, result = null;
    try {
      const initializeAt = performance.now();
      for (let index = 0; index < settings.sessions; index++) {
        throwIfAborted(signal);
        const session = createSession({ rootDir, modelId, modelsDir, onnxConfig, normalize: true,
          modelArtifact, qualificationLease: lease });
        sessions.push(session); await session.embedderPromise; sample(); check();
      }
      stages.initializationMs = performance.now() - initializeAt;
      stages.threadInitialized = observeProcessThreads();
      const warmAt = performance.now();
      for (const session of sessions) { await session.getEmbeddings(['pairofcleats execution profile warmup']); sample(); check(); }
      stages.warmupMs = performance.now() - warmAt;
      const inferAt = performance.now();
      let output = null;
      for (let round = 0; round < rounds; round++) {
        output = new Array(texts.length);
        for (let offset = 0; offset < texts.length; offset += batchSize * sessions.length) {
          throwIfAborted(signal);
          const active = sessions.map(async (session, index) => {
            const start = offset + index * batchSize, batch = texts.slice(start, start + batchSize);
            if (!batch.length) return;
            const vectors = await session.getEmbeddings(batch); sample(); check();
            if (!Array.isArray(vectors) || vectors.length !== batch.length) throw invalid('Profile output batch association failed.');
            for (let row = 0; row < vectors.length; row++) {
              const vector = vectors[row];
              if (!vector?.length || [...vector].some(value => !Number.isFinite(value))) throw invalid('Profile output contains missing/nonfinite coordinates.');
              output[start + row] = Float32Array.from(vector);
            }
          });
          const completed = await Promise.allSettled(active);
          const rejected = completed.find(value => value.status === 'rejected');
          if (rejected) throw rejected.reason;
        }
      }
      stages.inferenceMs = performance.now() - inferAt;
      stages.threadAfter = observeProcessThreads();
      result = { vectors: output, stages, sessions: sessions.map(session => session.executionInfo()) };
    } catch (error) { failure = error; }
    finally {
      const cleanup = [], disposeAt = performance.now();
      for (const session of sessions.reverse()) try { await session.dispose(); } catch (error) { cleanup.push(error); }
      clearInterval(sampler); sample();
      stages.disposalMs = performance.now() - disposeAt;
      stages.rssAfterDisposal = process.memoryUsage().rss;
      stages.retainedRssDeltaBytes = stages.rssAfterDisposal - stages.rssBefore;
      const cpu = process.cpuUsage(beforeCpu); stages.processCpuMicros = cpu.user + cpu.system;
      stages.disposalConfirmed = cleanup.length === 0;
      if (cleanup.length) {
        const error = failure || cleanup.shift(); error.cleanupErrors = cleanup; error.cacheOwnershipPending = true;
        error.qualificationLease = lease; failure = error;
      }
    }
    if (failure) throw failure;
    return result;
  };
  try {
    const first = await execute(safeBaseline, baselineLease);
    reference = first.vectors; baseline = { stages: first.stages, sessions: first.sessions };
    measured = await execute(candidate, candidateLease);
    const parity = compareVectors(reference, measured.vectors);
    const observedSessionBytes = Math.ceil(measured.stages.peakRssBytes - measured.stages.rssBefore);
    const qualifiedMemory = native && candidate.sessions === 1 && parity.numericalPass && !parity.topKChanged
      ? sealOnnxMemoryEvidence({ binding: candidateBinding, measuredSessionBytes: observedSessionBytes }) : null;
    return { schemaVersion: 1, kind: 'onnx-profile-experiment', status: 'observed-unaccepted',
      evidenceScope: native ? 'native-onnx-child-case' : 'inert-session-fixture', source, binding: candidateBinding,
      candidate, workload, envelope, memory, verificationMs, elapsedMs: performance.now() - started,
      nativeThreadAttribution: 'unknown-unless-runtime-observed; process-thread-inventory-is-not-provider-attribution',
      cacheState: { process: 'isolated-child-required-by-cli', modelSessions: 'fresh-capability-per-session',
        candidateOsPageCache: 'uncontrolled-after-reference-model' }, baseline,
      measured: { stages: measured.stages, sessions: measured.sessions }, parity, memoryEvidence: qualifiedMemory,
      activation: 'none', accepted: false };
  } catch (error) { primary = error; throw error; }
  finally {
    const failures = [];
    for (const lease of [candidateLease, baselineLease]) try { closeOnnxQualificationLease(lease); } catch (error) { failures.push(error); }
    if (failures.length) {
      if (primary) { primary.qualificationCleanupErrors = failures; primary.cacheOwnershipPending = true; }
      else throw Object.assign(new AggregateError(failures, 'ONNX profile ownership did not settle.'), { cacheOwnershipPending: true });
    }
  }
};
