import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeEmbeddingJob } from './indexer-service-helpers.js';
import { loadIndexState, writeIndexState } from '../build/embeddings/state.js';

const BUILD_STATE_FILE = 'build_state.json';
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
  } catch {
    return fallback;
  }
};

const pathExists = async (targetPath) => {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const resolveBackendStageDir = (buildRoot, indexDir, mode) => {
  if (!mode) return null;
  const base = buildRoot || indexDir || null;
  if (!base) return null;
  return path.join(base, '.embeddings-backend-staging', `index-${mode}`);
};

const summarizeBuildState = async (buildRoot, mode) => {
  if (!buildRoot) return null;
  const statePath = path.join(buildRoot, BUILD_STATE_FILE);
  const state = await readJson(statePath, null);
  if (!state || typeof state !== 'object') return null;
  return {
    path: statePath,
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
  for (const relPath of EMBEDDING_ARTIFACT_PATHS) {
    if (await pathExists(path.join(indexDir, relPath))) {
      presentPaths.push(relPath);
    }
  }
  return {
    presentCount: presentPaths.length,
    presentPaths,
    missingCount: Math.max(0, EMBEDDING_ARTIFACT_PATHS.length - presentPaths.length)
  };
};

export async function collectEmbeddingReplayState(job = {}) {
  const normalized = normalizeEmbeddingJob(job);
  const statePath = normalized.indexDir ? path.join(normalized.indexDir, 'index_state.json') : null;
  const indexState = statePath ? loadIndexState(statePath) : {};
  const backendStageDir = resolveBackendStageDir(normalized.buildRoot, normalized.indexDir, job?.mode || null);
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
      replay: embeddingsState.replay && typeof embeddingsState.replay === 'object'
        ? { ...embeddingsState.replay }
        : null
    },
    backendStage: {
      path: backendStageDir,
      exists: backendStageExists
    },
    artifacts,
    partialDurableState: pending || backendStageExists || (artifacts.presentCount > 0 && !ready)
  };
}

export async function repairEmbeddingReplayState(job = {}) {
  const before = await collectEmbeddingReplayState(job);
  const actions = [];
  if (before.backendStage.exists && before.backendStage.path) {
    await fs.rm(before.backendStage.path, { recursive: true, force: true });
    actions.push({
      type: 'remove-backend-stage-dir',
      path: before.backendStage.path
    });
  }
  if (before.indexStatePath && before.embeddings.pending === true && before.embeddings.ready !== true) {
    const indexState = loadIndexState(before.indexStatePath);
    const now = new Date().toISOString();
    indexState.generatedAt = indexState.generatedAt || now;
    indexState.updatedAt = now;
    indexState.embeddings = {
      ...(indexState.embeddings || {}),
      pending: false,
      ready: false,
      updatedAt: now,
      replay: {
        version: REPLAY_CONTRACT_VERSION,
        lastRecoveredAt: now,
        repairedBy: 'service-indexer',
        partialDurableState: before.partialDurableState,
        actions: actions.map((entry) => entry.type)
      }
    };
    await writeIndexState(before.indexStatePath, indexState);
    actions.push({
      type: 'reset-pending-index-state',
      path: before.indexStatePath
    });
  }
  const after = await collectEmbeddingReplayState(job);
  return {
    version: REPLAY_CONTRACT_VERSION,
    repaired: actions.length > 0,
    actions,
    before,
    after
  };
}
