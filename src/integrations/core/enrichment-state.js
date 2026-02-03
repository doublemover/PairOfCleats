import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../shared/json-stream.js';

const resolveEnrichmentStatePath = (repoCacheRoot) => path.join(repoCacheRoot, 'enrichment_state.json');

export const updateEnrichmentState = async (repoCacheRoot, patch, { log } = {}) => {
  if (!repoCacheRoot) return null;
  const statePath = resolveEnrichmentStatePath(repoCacheRoot);
  let state = {};
  try {
    state = JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      if (typeof log === 'function') {
        log(`[enrichment] Failed to read state: ${err?.message || err}`);
      } else {
        console.warn(`[enrichment] Failed to read state: ${err?.message || err}`);
      }
    }
  }
  const next = {
    ...state,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  try {
    await fs.mkdir(repoCacheRoot, { recursive: true });
    await writeJsonObjectFile(statePath, { fields: next, atomic: true, trailingNewline: true });
  } catch (err) {
    if (typeof log === 'function') {
      log(`[enrichment] Failed to write state: ${err?.message || err}`);
    } else {
      console.warn(`[enrichment] Failed to write state: ${err?.message || err}`);
    }
  }
  return next;
};
