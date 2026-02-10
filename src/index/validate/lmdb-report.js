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

export const buildLmdbReport = async ({ root, userConfig, indexRoot, modes, report, lmdbEnabled }) => {
  const enabled = typeof lmdbEnabled === 'boolean'
    ? lmdbEnabled
    : userConfig.lmdb?.use !== false;
  const lmdbPaths = resolveLmdbPaths(root, userConfig, indexRoot ? { indexRoot } : {});
  const lmdbTargets = new Set(modes.filter((mode) => mode === 'code' || mode === 'prose'));
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
      addIssue(report, `lmdb/${label}`, message, hint);
    };
    const addLmdbWarning = (label, message) => {
      lmdbReport.warnings.push(`${label}: ${message}`);
      report.warnings.push(`[lmdb/${label}] ${message}`);
    };
    const validateStore = (label, storePath) => {
      if (!hasLmdbStore(storePath)) {
        addLmdbWarning(label, 'db missing');
        return;
      }
      if (!openLmdb) {
        addLmdbWarning(label, 'lmdb dependency unavailable; integrity check skipped');
        return;
      }
      const db = openLmdb({ path: storePath, readOnly: true });
      try {
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
      } finally {
        db.close();
      }
    };
    if (lmdbTargets.has('code')) validateStore('code', lmdbPaths.codePath);
    if (lmdbTargets.has('prose')) validateStore('prose', lmdbPaths.prosePath);
  }

  return lmdbReport;
};
