import { resolveLmdbPaths } from '../../shared/dict-utils.js';
import {
  LMDB_META_KEYS,
  LMDB_REQUIRED_ARTIFACT_KEYS,
  LMDB_SCHEMA_VERSION
} from '../../storage/lmdb/schema.js';
import {
  decodeLmdbValue,
  hasLmdbStore,
  validateLmdbArtifactKeys,
  validateLmdbSchemaAndMode
} from '../../storage/lmdb/utils.js';
import { addIssue } from './issues.js';
import { createLmdbCloseOwner } from '../../storage/lmdb/close.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { acquireNativeReaderStorage } from '../../shared/storage/native-reader.js';

export const buildLmdbReport = async ({ root, userConfig, indexRoot, modes, report, lmdbEnabled, selection = null }) => {
  const enabled = typeof lmdbEnabled === 'boolean'
    ? lmdbEnabled
    : userConfig.lmdb?.use !== false;
  const lmdbPaths = selection ? { codePath: selection.lmdbPaths.code || null, prosePath: selection.lmdbPaths.prose || null }
    : resolveLmdbPaths(root, userConfig, indexRoot ? { indexRoot } : {});
  const lmdbTargets = new Set(modes.filter(mode => (mode === 'code' || mode === 'prose')
    && (!selection || selection.indexDirs[mode]) && selection?.backendRequirements?.lmdb?.[mode] !== false));
  const lmdbReport = {
    enabled,
    ok: true,
    code: lmdbPaths.codePath,
    prose: lmdbPaths.prosePath,
    issues: [],
    warnings: []
  };
  lmdbReport.enabled = lmdbReport.enabled && lmdbTargets.size > 0;

  if (lmdbReport.enabled) {
    let openLmdb = null;
    try {
      ({ open: openLmdb } = await import('lmdb'));
    } catch {}
    const addLmdbIssue = (label, message, hint) => {
      lmdbReport.ok = false;
      lmdbReport.issues.push(`${label}: ${message}`);
      addIssue(report, ['code', 'prose'].includes(label) ? label : null, message, hint, 'issues',
        { capability: 'lmdb', displayScope: `lmdb/${label}`, code: 'ERR_INDEX_LMDB_VALIDATION' });
    };
    const addLmdbWarning = (label, message) => {
      lmdbReport.warnings.push(`${label}: ${message}`);
      addIssue(report, ['code', 'prose'].includes(label) ? label : null, message, null, 'warnings',
        { capability: 'lmdb', displayScope: `lmdb/${label}`, state: 'unverified', code: 'WARN_INDEX_LMDB_UNVERIFIED' });
    };
    const validateStore = async (label, storePath) => {
      let nativeClosed = false, db = null, attemptedOpen = false, closeOwner = null;
      const storage = storePath ? acquireNativeReaderStorage(storePath, { repoRoot: root, userConfig, nativeBackend: 'lmdb', nativeMode: label },
        () => nativeClosed || closeOwner?.isSettled() === true) : null;
      storage?.start();
      let originalClose, primary, failed = false;
      try {
        if (!hasLmdbStore(storePath)) {
          if (selection?.backendRequirements?.lmdb?.[label]) addLmdbIssue(label, 'required published db missing');
          else addLmdbWarning(label, 'db missing');
          return;
        }
        if (!openLmdb) {
          addLmdbWarning(label, 'lmdb dependency unavailable; integrity check skipped');
          return;
        }
        attemptedOpen = true;
        try { db = openLmdb({ path: storePath, readOnly: true }); }
        catch (error) { storage?.failedOpen(error); throw error; }
        originalClose = db.close;
        if (typeof originalClose !== 'function') throw new TypeError('LMDB validation requires its original close method.');
        closeOwner = createLmdbCloseOwner(db, originalClose);
        const schemaValidation = validateLmdbSchemaAndMode({
          db,
          label,
          decode: decodeLmdbValue,
          metaKeys: LMDB_META_KEYS,
          schemaVersion: LMDB_SCHEMA_VERSION
        });
        for (const issue of schemaValidation.issues) {
          addLmdbIssue(
            label,
            issue,
            'Run `pairofcleats lmdb build` (or `node tools/build/lmdb-index.js`) to rebuild LMDB artifacts.'
          );
        }
        const chunkCount = decodeLmdbValue(db.get(LMDB_META_KEYS.chunkCount));
        if (chunkCount != null && !Number.isFinite(Number(chunkCount))) {
          addLmdbWarning(label, 'meta:chunkCount invalid');
        }
        const mapSizeBytes = decodeLmdbValue(db.get(LMDB_META_KEYS.mapSizeBytes));
        if (mapSizeBytes == null) {
          addLmdbWarning(label, 'meta:mapSizeBytes missing');
        } else if (!Number.isFinite(Number(mapSizeBytes))) {
          addLmdbWarning(label, 'meta:mapSizeBytes invalid');
        }
        const mapSizeEstimatedBytes = decodeLmdbValue(db.get(LMDB_META_KEYS.mapSizeEstimatedBytes));
        if (mapSizeEstimatedBytes == null) {
          addLmdbWarning(label, 'meta:mapSizeEstimatedBytes missing');
        } else if (!Number.isFinite(Number(mapSizeEstimatedBytes))) {
          addLmdbWarning(label, 'meta:mapSizeEstimatedBytes invalid');
        }
        const artifactValidation = validateLmdbArtifactKeys({
          db,
          requiredKeys: LMDB_REQUIRED_ARTIFACT_KEYS,
          decode: decodeLmdbValue,
          metaKeys: LMDB_META_KEYS
        });
        if (artifactValidation.missingMeta) {
          addLmdbIssue(
            label,
            'meta:artifacts missing or invalid',
            'Run `pairofcleats lmdb build` (or `node tools/build/lmdb-index.js`) to rebuild LMDB artifacts.'
          );
          return;
        }
        for (const key of artifactValidation.missingArtifactKeys) {
          addLmdbIssue(
            label,
            `missing artifact key ${key}`,
            'Run `pairofcleats lmdb build` (or `node tools/build/lmdb-index.js`) to rebuild LMDB artifacts.'
          );
        }
        for (const key of artifactValidation.missingArtifactValues) {
          addLmdbIssue(
            label,
            `artifact missing: ${key}`,
            'Run `pairofcleats lmdb build` (or `node tools/build/lmdb-index.js`) to rebuild LMDB artifacts.'
          );
        }
      } catch (error) { primary = db && storage ? storage.retainFailure(error) : error; failed = true; throw primary; }
      finally {
        try {
          if (db) {
            try {
              if (!closeOwner) throw new TypeError('LMDB validation has no captured close owner.');
              await closeOwner.close(); nativeClosed = true;
            }
            catch (error) { throw storage ? storage.retainFailure(error) : error; }
          } else if (!attemptedOpen) nativeClosed = true;
          if (db || !attemptedOpen) storage?.releaseAfterClosure();
        } catch (cleanupError) { throw failed ? addStorageFailureContext(primary, {}, cleanupError, { secondaryPresent: true }) : cleanupError; }
      }
    };
    if (lmdbTargets.has('code')) await validateStore('code', lmdbPaths.codePath);
    if (lmdbTargets.has('prose')) await validateStore('prose', lmdbPaths.prosePath);
  }

  return lmdbReport;
};
