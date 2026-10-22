import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { stableStringify } from '../../shared/stable-json.js';
import { throwIfAborted } from '../../shared/abort.js';
import { isPathWithinRoot } from '../../shared/file-paths.js';
import { readVerifiedContainedFile } from '../../shared/contained-file.js';
import { acquireEmbeddingArtifactLease } from '../../shared/embedding-artifact-lease.js';
import { planOnnxArtifactClosure } from '../../shared/onnx-artifact-closure.js';
import { safeOnnxRelativePath } from '../../shared/onnx-installation.js';
import { createRunQueue } from '../../shared/onnx-embeddings/run-queue.js';
import { currentOnnxQualificationRuntime } from '../../shared/onnx-embeddings/qualification.js';
import { acquireStorageSession } from '../../shared/storage/session.js';
import { validateLocalCrossEncoderProfile } from '../../contracts/validators/reranker.js';
import { LOCAL_RERANKER_VERSION } from '../../contracts/schemas/reranker.js';
import { scoreLocalCrossEncoderPairs } from './cross-encoder-scoring.js';
import { createCrossEncoderSessionOwner, crossEncoderCleanupFailure } from './local-resource-owner.js';
import { preserveRerankerFailure } from './failure-ownership.js';
import { observeEmbeddingOwnership } from '../../shared/embedding-cache-lifetime.js';

export { decodeCrossEncoderLogit } from './cross-encoder-scoring.js';

const require = createRequire(import.meta.url);
const digest = value => createHash('sha256').update(stableStringify(value)).digest('hex');
const invalid = message => Object.assign(new Error(message), { code: 'ERR_LOCAL_RERANKER_PROFILE' });
const unavailable = error => {
  const failure = preserveRerankerFailure(error, { code: { value: 'ERR_RERANK_UNAVAILABLE' },
    capability: { value: 'local-bert-cross-encoder' }, measuredModelFailure: { value: false } });
  failure.message = `Pinned local cross-encoder runtime/model is unavailable: ${failure.message}`;
  return failure;
};
const runtimeIdentity = () => {
  let directory = path.dirname(require.resolve('@huggingface/transformers')), version = null;
  for (let depth = 0; depth < 8; depth++) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file) && fs.statSync(file).size <= 64 * 1024) {
      const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (metadata.name === '@huggingface/transformers') { version = metadata.version; break; }
    }
    const parent = path.dirname(directory); if (parent === directory) break; directory = parent;
  }
  if (!version) throw invalid('Transformers runtime identity is unavailable.');
  return { transformers: `@huggingface/transformers@${version}`, onnx: currentOnnxQualificationRuntime().runtime };
};

export const admitLocalCrossEncoderProfile = input => {
  const validation = validateLocalCrossEncoderProfile(input);
  if (!validation.ok) throw invalid(`Invalid pinned cross-encoder profile: ${validation.errors.slice(0, 4).join('; ')}`);
  if (input.revision !== input.tokenizerRevision || !safeOnnxRelativePath(input.graph)
    || !safeOnnxRelativePath(input.license.path) || input.maxQueryTokens >= input.maxPairTokens) throw invalid('Cross-encoder revision, path or token policy is incompatible.');
  const profile = structuredClone(input);
  Object.freeze(profile.license); Object.freeze(profile.runtime);
  return Object.freeze(profile);
};

/** Explicit caller-provided locked local export, no download or default model
 * selection. Revision labels are bound to caller-pinned byte digests; this does
 * not manufacture upstream/license/native qualification. One request owns one
 * CPU session and serialized pair work through the existing run queue.
 */
export const createLocalOnnxCrossEncoder = async ({ profile: input, modelRoot, storage, loadSource, signal = null }) => {
  const profile = admitLocalCrossEncoderProfile(input);
  if (!path.isAbsolute(modelRoot || '') || typeof loadSource !== 'function') throw invalid('Local reranker requires an absolute model root and authoritative source loader.');
  const root = path.resolve(modelRoot), graph = path.resolve(root, ...profile.graph.split('/'));
  if (!isPathWithinRoot(graph, root)) throw invalid('Cross-encoder graph escapes its model root.');
  throwIfAborted(signal);
  const sessionLease = acquireStorageSession({ ...storage, roots: [root], scope: 'local-cross-encoder-session' });
  const queue = createRunQueue({ maxQueued: 0 });
  let artifactLease = null, tokenizer = null, session = null, Tensor = null, observedRuntime = null;
  const owner = createCrossEncoderSessionOwner({ queue, sessionLease });
  const close = owner.close;
  try {
    observedRuntime = runtimeIdentity();
    if (stableStringify(observedRuntime) !== stableStringify(profile.runtime)) throw invalid('Pinned cross-encoder runtime versions do not match.');
    const artifactOptions = { provider: 'onnx', modelId: root, modelsDir: null, rootDir: root,
      onnx: { modelPath: graph, tokenizerId: root } };
    artifactLease = await acquireEmbeddingArtifactLease(artifactOptions, { signal });
    owner.adoptArtifact(artifactLease);
    const artifact = artifactLease.artifact;
    if (artifact.status !== 'verified' || artifact.digest !== profile.artifactDigest
      || artifact.inventory.reduce((sum, row) => sum + row.bytes, 0) > 512 * 1024 * 1024
      || digest(artifact.inventory.filter(row => row.path.startsWith('tokenizer/'))) !== profile.tokenizerDigest) throw invalid('Cross-encoder graph/tokenizer bytes disagree with the pinned profile.');
    const closure = await planOnnxArtifactClosure(graph);
    if (closure.digest !== profile.graphClosureDigest || closure.files.reduce((sum, row) => sum + row.bytes, 0) > 512 * 1024 * 1024) throw invalid('Cross-encoder graph closure identity or512MiB weight bound failed.');
    await readVerifiedContainedFile(root, path.join(root, ...profile.license.path.split('/')), {
      expectedHash: profile.license.sha256, maxBytes: 256 * 1024, signal });
    const config = JSON.parse((await readVerifiedContainedFile(root, path.join(root, 'config.json'), { maxBytes: 64 * 1024, signal })).buffer.toString('utf8'));
    if (config.model_type !== 'bert' || !Array.isArray(config.architectures)
      || !config.architectures.includes('BertForSequenceClassification')
      || !(config.num_labels === 1 || Object.keys(config.id2label || {}).length === 1)
      || config.num_labels != null && config.num_labels !== 1
      || config.id2label != null && Object.keys(config.id2label).length !== 1) throw invalid('Only a single-logit BERT sequence-classification export is admitted.');
    const [{ AutoTokenizer }, runtime] = await Promise.all([import('@huggingface/transformers'), import('onnxruntime-node')]);
    tokenizer = await AutoTokenizer.from_pretrained(root, { local_files_only: true, revision: profile.tokenizerRevision });
    owner.adoptTokenizer(tokenizer);
    throwIfAborted(signal);
    Tensor = runtime.Tensor;
    session = await runtime.InferenceSession.create(graph, { executionProviders: [{ name: 'cpu', useArena: false }],
      executionMode: 'sequential', intraOpNumThreads: 1, interOpNumThreads: 1,
      graphOptimizationLevel: 'basic', enableCpuMemArena: false, enableMemPattern: false });
    owner.adoptSession(session);
    if (!Array.isArray(session.inputNames) || !session.inputNames.includes('input_ids')
      || !session.inputNames.includes('attention_mask') || session.inputNames.some(name => !['input_ids', 'attention_mask', 'token_type_ids'].includes(name))
      || !session.outputNames?.includes('logits')) throw invalid('Cross-encoder graph input/output capability is incompatible.');
    await artifactLease.verifyLoaded();
    throwIfAborted(signal);
  } catch (cause) {
    const error = typeof cause?.code === 'string' && cause.code.startsWith('ERR_LOCAL_')
      || cause?.name === 'AbortError' ? cause : unavailable(cause);
    const observe=observeEmbeddingOwnership(cause);
    if (observe&&!observe()) {
      owner.retainFailure(cause);
      throw crossEncoderCleanupFailure({ owner, hasPrimary: true, primaryError: error,
        properties: { nativeOwner: { value: cause.rerankerOwner || cause.onnxSessionOwner || cause }, storageSession: { value: sessionLease } } });
    }
    try { await close(); }
    catch (cleanupError) { throw crossEncoderCleanupFailure({ owner, hasPrimary: true, primaryError: error,
      cleanupErrors: [cleanupError], properties: { storageSession: { value: sessionLease } } }); }
    throw error;
  }
  const identity = { schemaVersion: LOCAL_RERANKER_VERSION, profile, runtime: Object.freeze(observedRuntime),
    source: 'authoritative-generation-bound-full-span.v1', execution: 'single-session-cpu-one-thread-sequential.v1' };
  const identityKey = digest(identity);
  return Object.freeze({ id: `${profile.modelId}@${profile.revision}`, identityKey, identity: Object.freeze(identity),
    formattingIdentity: digest([profile.formatting, profile.truncation, profile.maxPairTokens]),
    scoreRange: Object.freeze({ min: 0, max: 1 }), dispose: close,
    execution: Object.freeze({ provider: 'onnx-cpu', sessions: 1, passedIntraOpNumThreads: 1, actualNativeThreads: null, qualified: false }),
    rerank: async ({ query, hits, signal: operationSignal = null, sourceContext }) => {
      if (owner.stopped) {
        const error = invalid('Cross-encoder admission is closed.');
        if (owner.pending) throw crossEncoderCleanupFailure({ owner, hasPrimary: true, primaryError: error,
          properties: { storageSession: { value: sessionLease } } });
        throw error;
      }
      if (typeof query !== 'string' || !query || query.length > profile.maxQueryChars || !Array.isArray(hits)
        || hits.length > 64 || typeof sourceContext?.generation !== 'string' || !sourceContext.generation
        || sourceContext.generation.length > 4096) throw invalid('Cross-encoder request exceeds its source/pair/pool contract.');
      if (Buffer.byteLength(JSON.stringify(hits)) > 2 * 1024 * 1024) throw invalid('Cross-encoder source snapshot exceeds2MiB.');
      const members = structuredClone(hits), selectedSourceContext = structuredClone(sourceContext);
      return queue(async () => {
        try {
          return await scoreLocalCrossEncoderPairs({ profile, query, members, sourceContext: selectedSourceContext,
            loadSource, tokenizer, session, Tensor, pendingTensors: owner.pendingTensors,
            pendingTensorOwners: owner.pendingTensorOwners, signal: operationSignal });
        } catch (error) {
          const observe=observeEmbeddingOwnership(error);
          if (observe&&!observe()) {
            owner.retainFailure(error);
            throw crossEncoderCleanupFailure({ owner, hasPrimary: true, primaryError: error,
              properties: { nativeOwner: { value: error.rerankerOwner || error }, storageSession: { value: sessionLease } } });
          }
          throw error;
        }
      }, { signal: operationSignal });
    } });
};
