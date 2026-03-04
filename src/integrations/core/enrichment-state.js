import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../shared/json-stream.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../shared/locks/file-lock.js';
import { readJsonFileSafe } from '../../shared/files.js';

const resolveEnrichmentStatePath = (repoCacheRoot) => path.join(repoCacheRoot, 'enrichment_state.json');
const resolveEnrichmentStateLockPath = (repoCacheRoot) => path.join(repoCacheRoot, 'locks', 'enrichment-state.lock');
const ENRICHMENT_STATE_LOCK_WAIT_MS = 5000;
const ENRICHMENT_STATE_LOCK_POLL_MS = 100;
const ENRICHMENT_STATE_LOCK_STALE_MS = 30 * 60 * 1000;
const ENRICHMENT_STATE_MAX_BYTES = 2 * 1024 * 1024;

const logEnrichmentWarning = (log, message) => {
  if (typeof log === 'function') {
    log(message);
  } else {
    console.warn(message);
  }
};

const readEnrichmentState = async (statePath) => {
  let readError = null;
  const parsed = await readJsonFileSafe(statePath, {
    fallback: {},
    maxBytes: ENRICHMENT_STATE_MAX_BYTES,
    onError: (info) => {
      if (!readError) readError = info?.error || new Error('read_enrichment_state_failed');
    }
  });
  if (readError && readError?.code !== 'ENOENT') {
    throw readError;
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Enrichment state must be a JSON object.');
  }
  return parsed;
};

export const updateEnrichmentState = async (repoCacheRoot, patch, { log } = {}) => {
  if (!repoCacheRoot) return null;
  const statePath = resolveEnrichmentStatePath(repoCacheRoot);
  const lockPath = resolveEnrichmentStateLockPath(repoCacheRoot);
  await fs.mkdir(repoCacheRoot, { recursive: true });
  const lock = await acquireFileLock({
    lockPath,
    waitMs: ENRICHMENT_STATE_LOCK_WAIT_MS,
    pollMs: ENRICHMENT_STATE_LOCK_POLL_MS,
    staleMs: ENRICHMENT_STATE_LOCK_STALE_MS,
    metadata: { scope: 'enrichment-state' },
    timeoutBehavior: 'throw',
    timeoutMessage: 'Enrichment state lock timeout.'
  });
  if (!lock) {
    throw new Error('Enrichment state lock timeout.');
  }

  try {
    let state = {};
    try {
      state = await readEnrichmentState(statePath);
    } catch (err) {
      logEnrichmentWarning(log, `[enrichment] Failed to read state: ${err?.message || err}`);
      throw err;
    }
    const next = {
      ...state,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    try {
      await writeJsonObjectFile(statePath, { fields: next, atomic: true, trailingNewline: true });
    } catch (err) {
      logEnrichmentWarning(log, `[enrichment] Failed to write state: ${err?.message || err}`);
      throw err;
    }
    return next;
  } finally {
    await releaseFileLockOrThrow(lock, { releaseOptions: { force: false } });
  }
};
