import fs from 'node:fs/promises';
import path from 'node:path';
import {
  normalizeEmbeddingJob,
  readServiceBuildStateSnapshot,
  resolveEmbeddingBackendStageDir
} from './indexer-service-helpers.js';
import { loadIndexState } from '../build/embeddings/state.js';
import { publishIndexStateMutation } from '../../src/shared/index-state-publication.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';
import { assertNoSymlinkPath } from '../../src/shared/contained-file.js';
import { stableStringify } from '../../src/shared/stable-json.js';

const REPLAY_CONTRACT_VERSION = 1;
const EMBEDDING_ARTIFACT_PATHS = [
  'dense_vectors_uint8.bin',
  'dense_vectors_doc_uint8.bin',
  'dense_vectors_code_uint8.bin',
  'dense_vectors_uint8.bin.meta.json',
  'dense_vectors_doc_uint8.bin.meta.json',
  'dense_vectors_code_uint8.bin.meta.json',
  'dense_vectors_hnsw.meta.json',
  'dense_vectors_doc_hnsw.meta.json',
  'dense_vectors_code_hnsw.meta.json',
  'dense_vectors.lancedb.meta.json',
  'dense_vectors_doc.lancedb.meta.json',
  'dense_vectors_code.lancedb.meta.json',
  'dense_vectors_sqlite_vec.meta.json',
  path.join('pieces', 'manifest.json')
];

const readJson = async (filePath, fallback = null) => {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    observeStorageResource(error, { phase: 'embedding-replay-diagnostic-json' }).requireSettled();
    return fallback;
  }
};

const pathExists = async (targetPath) => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch (error) {
    observeStorageResource(error, { phase: 'embedding-replay-path-probe' }).requireSettled();
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const summarizeBuildState = async (buildRoot, mode) => {
  const snapshot = await readServiceBuildStateSnapshot(buildRoot);
  if (!snapshot) return null;
  const state = snapshot.state;
  return {
    path: snapshot.path,
    stage: state.stage || null,
    mode,
    phaseStatus: state?.phases?.stage3?.status || null,
    progress: mode && state?.progress?.[mode] && typeof state.progress[mode] === 'object'
      ? { ...state.progress[mode] }
      : null,
    updatedAt: state.updatedAt || state.generatedAt || null
  };
};

const summarizeArtifacts = async (indexDir) => {
  if (!indexDir) {
    return { presentCount: 0, presentPaths: [], missingCount: EMBEDDING_ARTIFACT_PATHS.length };
  }
  const presentPaths = [];
  const manifest = await readJson(path.join(indexDir, 'pieces', 'manifest.json'));
  for (const relPath of EMBEDDING_ARTIFACT_PATHS) {
    const nativeName = relPath.endsWith('_hnsw.meta.json')
      ? relPath.replace('.meta.json', '_meta')
      : relPath.endsWith('.lancedb.meta.json') ? relPath.replace('.lancedb.meta.json', '_lancedb_meta') : null;
    let selectedPath = relPath;
    if (nativeName && manifest) {
      const entries = Array.isArray(manifest.pieces)
        ? manifest.pieces.filter(piece => piece.name === nativeName) : [];
      if (entries.length !== 1 || typeof entries[0].path !== 'string') continue;
      selectedPath = entries[0].path;
      const relative = path.relative(path.resolve(indexDir), path.resolve(indexDir, selectedPath));
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) continue;
    }
    if (await pathExists(path.join(indexDir, selectedPath))) {
      presentPaths.push(selectedPath);
    }
  }
  return {
    presentCount: presentPaths.length,
    presentPaths,
    missingCount: Math.max(0, EMBEDDING_ARTIFACT_PATHS.length - presentPaths.length)
  };
};

const collectReplayState = async (job, suppliedState) => {
  const normalized = normalizeEmbeddingJob(job);
  const statePath = normalized.indexDir ? path.join(normalized.indexDir, 'index_state.json') : null;
  const indexState = suppliedState ?? (statePath ? loadIndexState(statePath) : {});
  const backendStageDir = resolveEmbeddingBackendStageDir(normalized, job?.mode || null);
  const backendStageExists = backendStageDir ? await pathExists(backendStageDir) : false;
  const artifacts = await summarizeArtifacts(normalized.indexDir);
  const buildState = await summarizeBuildState(normalized.buildRoot, job?.mode || null);
  const embeddingsState = indexState?.embeddings && typeof indexState.embeddings === 'object'
    ? indexState.embeddings
    : {};
  const pending = embeddingsState.pending === true;
  const ready = embeddingsState.ready === true;
  return {
    version: REPLAY_CONTRACT_VERSION,
    jobId: typeof job?.id === 'string' ? job.id : null,
    mode: job?.mode || null,
    repoRoot: normalized.repoRoot || null,
    buildRoot: normalized.buildRoot || null,
    indexDir: normalized.indexDir || null,
    indexStatePath: statePath,
    formatVersion: normalized.formatVersion,
    buildState,
    embeddings: {
      ready,
      pending,
      lastError: embeddingsState.lastError || null,
      updatedAt: embeddingsState.updatedAt || null,
      embeddingIdentityKey: embeddingsState.embeddingIdentityKey || null,
      embeddingGeneration: embeddingsState.embeddingGeneration || null,
      replay: embeddingsState.replay && typeof embeddingsState.replay === 'object'
        ? { ...embeddingsState.replay }
        : null
    },
    backendStage: {
      path: backendStageDir,
      exists: backendStageExists
    },
    artifacts,
    partialDurableState: pending || (artifacts.presentCount > 0 && !ready)
  };
};

export const collectEmbeddingReplayState = (job = {}) => collectReplayState(job);

const replayWitness = state => stableStringify(Object.fromEntries([
  ...['repoId', 'buildId', 'mode', 'artifactSurfaceVersion', 'compatibilityKey', 'cohortKey', 'profile', 'embeddings']
    .map(key => [key, state[key]]), ['runtimeAttemptId', state.extensions?.runtimeAttemptId]
]));

export async function repairEmbeddingReplayState(job = {}) {
  const normalized = normalizeEmbeddingJob(job);
  if (!normalized.buildRoot || !normalized.indexDir || normalized.indexDirUnderBuildRoot !== true) throw Object.assign(
    new Error('Embedding replay indexDir must be inside its selected buildRoot.'), { code: 'ERR_EMBEDDING_REPLAY_ROOT' });
  resolveEmbeddingBackendStageDir(normalized, job?.mode);
  assertNoSymlinkPath(normalized.buildRoot, normalized.indexDir);
  // Capture the actual original state before any asynchronous observations.
  const statePath = path.join(normalized.indexDir, 'index_state.json'), original = loadIndexState(statePath);
  const witness = replayWitness(original);
  const before = await collectReplayState(job, original);
  const actions = [];
  let repaired = false;
  if (before.backendStage.exists && before.backendStage.path) {
    // Current writers own compact random .ann- directories, not this legacy
    // pathname. Its name is no authority to recursively delete unknown data.
    actions.push({
      type: 'retain-unowned-backend-stage-dir',
      path: before.backendStage.path
    });
  }
  if (before.embeddings.pending === true && before.embeddings.ready !== true) {
    if (original.extensions?.runtimeAttemptId != null) {
      // The next real Stage3 invocation claims and initializes its own pending
      // state. A service diagnostic cannot impersonate the previous attempt.
      actions.push({ type: 'retain-owned-index-state', path: statePath });
    } else {
      await publishIndexStateMutation(normalized.indexDir, current => {
        if (replayWitness(current) !== witness) throw Object.assign(
          new Error('Embedding replay conflicts with newer generation or invocation state.'), { code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT' });
        const now = new Date().toISOString();
        current.embeddings = { ...current.embeddings, pending: false, ready: false, updatedAt: now,
          replay: { version: REPLAY_CONTRACT_VERSION, lastRecoveredAt: now, repairedBy: 'service-indexer',
            partialDurableState: before.partialDurableState, actions: actions.map(entry => entry.type) } };
      });
      repaired = true;
      actions.push({ type: 'reset-pending-index-state', path: statePath });
    }
  }
  const after = await collectEmbeddingReplayState(job);
  return {
    version: REPLAY_CONTRACT_VERSION,
    repaired,
    actions,
    before,
    after
  };
}
