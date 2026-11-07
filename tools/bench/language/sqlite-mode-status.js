import fs from 'node:fs';
import path from 'node:path';
import { validateSqliteZeroStateManifest } from '../../../src/storage/sqlite/zero-state.js';
import { readVerifiedContainedFileSync } from '../../../src/shared/contained-file.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';

const readBoundedJson = (file, maxBytes) => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
    readVerifiedContainedFileSync(path.dirname(file), file, { maxBytes }).buffer)); }
  catch (error) {
    observeStorageResource(error, { phase: 'benchmark-zero-state-read' }).requireSettled();
    return null;
  }
};
const samePath = (value, selected) => typeof value === 'string' && path.isAbsolute(value)
  && path.relative(path.toNamespacedPath(path.resolve(value)), path.toNamespacedPath(path.resolve(selected))) === '';

/** Require current ready state and the canonical, source-bound empty proof. */
export const resolveBenchSqliteModeStatus = async ({ mode, indexDir, dbPath }) => {
  const zeroStateManifestPath = path.join(indexDir, 'pieces', 'sqlite-zero-state.json');
  const receipt = readBoundedJson(zeroStateManifestPath, 64 * 1024);
  const state = readBoundedJson(path.join(indexDir, 'index_state.json'), 1024 * 1024);
  const generatedAt = Date.parse(receipt?.generatedAt), stateGeneratedAt = Date.parse(state?.generatedAt);
  let zeroState = false;
  const current = state?.mode === mode && state.sqlite?.status === 'ready'
    && state.sqlite.ready !== false && state.sqlite.pending !== true
    && state.sqlite?.stats?.reason === 'empty-' + mode + '-artifacts'
    && samePath(state.sqlite?.stats?.zeroStateManifestPath, zeroStateManifestPath)
    && Number.isFinite(generatedAt) && Number.isFinite(stateGeneratedAt) && stateGeneratedAt <= generatedAt;
  if (current) {
    try { zeroState = await validateSqliteZeroStateManifest({ indexDir, mode, outputPath: dbPath, payload: receipt }); }
    catch (error) {
      // Invalid proof means unavailable. Unconfirmed descriptor/native ownership
      // still propagates through the original storage observation.
      observeStorageResource(error, { phase: 'benchmark-zero-state-validation' }).requireSettled();
    }
  }
  return { dbExists: fs.existsSync(dbPath), zeroState, zeroStateManifestPath,
    zeroStateObservation: zeroState ? 'confirmed-empty' : receipt ? 'unverified-receipt' : 'absent-or-invalid' };
};
