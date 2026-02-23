import path from 'node:path';
import fs from 'node:fs';
import { resolveSqlitePaths } from '../../shared/dict-utils.js';
import {
  MAX_JSON_BYTES,
  loadChunkMeta,
  loadJsonArrayArtifact,
  readJsonFile
} from '../../shared/artifact-io.js';
import { addIssue } from './issues.js';
import { validateSchema } from './schema.js';
import { validateRiskInterproceduralArtifacts } from './risk-interprocedural.js';
import {
  validateChunkIds,
  validateChunkIdentity,
  validateMetaV2Equivalence,
  validateMetaV2Types,
  validateSqliteMetaV2Parity
} from './checks.js';

const SQLITE_META_V2_PARITY_SAMPLE = 10;
const VALIDATION_ARTIFACT_MAX_CAP_BYTES = 1024 * 1024 * 1024; // 1 GiB safety cap
const VALIDATION_ARTIFACT_HEADROOM_BYTES = 8 * 1024 * 1024; // absorb small metadata drift

export const resolveArtifactValidationMaxBytes = ({
  manifest,
  artifactNames,
  baseMaxBytes = MAX_JSON_BYTES
}) => {
  let resolved = Number.isFinite(Number(baseMaxBytes))
    ? Math.max(1, Math.floor(Number(baseMaxBytes)))
    : MAX_JSON_BYTES;
  const names = artifactNames instanceof Set
    ? artifactNames
    : new Set(Array.isArray(artifactNames) ? artifactNames : []);
  if (!names.size) return resolved;
  const pieces = Array.isArray(manifest?.pieces) ? manifest.pieces : [];
  for (const piece of pieces) {
    const name = typeof piece?.name === 'string' ? piece.name : '';
    if (!names.has(name)) continue;
    const bytes = Number(piece?.bytes);
    if (!Number.isFinite(bytes) || bytes <= 0) continue;
    const candidate = Math.min(
      VALIDATION_ARTIFACT_MAX_CAP_BYTES,
      Math.max(1, Math.floor(bytes + VALIDATION_ARTIFACT_HEADROOM_BYTES))
    );
    if (candidate > resolved) resolved = candidate;
  }
  return resolved;
};

const isMissingOptionalFileMetaError = (err, { strict }) => {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return !strict && (
    code === 'ERR_ARTIFACT_MISSING'
    || code === 'ERR_MANIFEST_MISSING'
    || code === 'ENOENT'
    || /Missing manifest entry for file_meta/i.test(message)
    || /Missing pieces manifest/i.test(message)
  );
};

const buildFileMetaById = (fileMeta) => {
  const fileMetaById = new Map();
  for (const entry of Array.isArray(fileMeta) ? fileMeta : []) {
    if (!entry || entry.id == null) continue;
    fileMetaById.set(entry.id, entry);
  }
  return fileMetaById;
};

const normalizeChunkMetaFallbackPayload = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.chunkMeta)) return raw.chunkMeta;
  if (Array.isArray(raw.rows)) return raw.rows;
  const keys = Object.keys(raw);
  if (!keys.length) return null;
  if (!keys.every((key) => /^\d+$/.test(key))) return null;
  return keys
    .map((key) => Number(key))
    .sort((a, b) => a - b)
    .map((key) => raw[String(key)])
    .filter(Boolean);
};

const readChunkMetaFallbackPayload = (dir, chunkMetaMaxBytes) => {
  try {
    return readJsonFile(path.join(dir, 'chunk_meta.json'), {
      maxBytes: chunkMetaMaxBytes
    });
  } catch {
    return null;
  }
};

const enrichChunkMeta = (chunkMeta, fileMetaById) => {
  const chunkUidSet = new Set();
  const canHydrateFromFileMeta = fileMetaById.size > 0;
  for (const entry of chunkMeta) {
    if (!entry) continue;
    if (canHydrateFromFileMeta) {
      if (!entry.chunkId && entry.metaV2?.chunkId) entry.chunkId = entry.metaV2.chunkId;
      const meta = fileMetaById.get(entry.fileId);
      if (meta) {
        if (!entry.file && meta.file) entry.file = meta.file;
        if (!entry.ext && meta.ext) entry.ext = meta.ext;
        if (!entry.fileHash && meta.hash) entry.fileHash = meta.hash;
        if (!entry.fileHashAlgo && meta.hashAlgo) entry.fileHashAlgo = meta.hashAlgo;
        if (!Number.isFinite(entry.fileSize) && Number.isFinite(meta.size)) entry.fileSize = meta.size;
      }
    }
    const uid = entry?.chunkUid || entry?.metaV2?.chunkUid || null;
    if (uid) chunkUidSet.add(uid);
  }
  return chunkUidSet;
};

export const loadAndValidateChunkMeta = async ({
  report,
  mode,
  dir,
  manifest,
  strict,
  modeReport,
  root,
  userConfig,
  indexRoot,
  sqliteEnabled,
  readJsonArtifact,
  shouldLoadOptional,
  checkPresence
}) => {
  let chunkMeta = null;
  let fileMeta = null;
  const indexState = readJsonArtifact('index_state', { required: strict });

  const chunkMetaMaxBytes = resolveArtifactValidationMaxBytes({
    manifest,
    artifactNames: new Set([
      'chunk_meta',
      'chunk_meta_binary_columnar',
      'chunk_meta_cold'
    ])
  });
  try {
    chunkMeta = await loadChunkMeta(dir, {
      manifest,
      strict,
      maxBytes: chunkMetaMaxBytes
    });
  } catch (err) {
    const fallback = normalizeChunkMetaFallbackPayload(
      readChunkMetaFallbackPayload(dir, chunkMetaMaxBytes)
      || readJsonArtifact('chunk_meta', { required: false, allowOversize: true })
    );
    if (fallback) {
      chunkMeta = fallback;
      modeReport.warnings.push('chunk_meta fallback parser used');
      report.warnings.push(`[${mode}] chunk_meta fallback parser used`);
    } else {
      addIssue(report, mode, `chunk_meta load failed (${err?.code || err?.message || err})`, 'Rebuild index artifacts for this mode.');
      modeReport.ok = false;
    }
  }
  if (!chunkMeta) {
    return {
      chunkMeta: null,
      fileMeta: null,
      indexState,
      chunkUidSet: new Set()
    };
  }

  validateSchema(report, mode, 'chunk_meta', chunkMeta, 'Rebuild index artifacts for this mode.', { strictSchema: strict });

  const fileMetaMaxBytes = resolveArtifactValidationMaxBytes({
    manifest,
    artifactNames: new Set(['file_meta'])
  });
  try {
    fileMeta = await loadJsonArrayArtifact(dir, 'file_meta', {
      manifest,
      strict,
      maxBytes: fileMetaMaxBytes
    });
  } catch (err) {
    if (!isMissingOptionalFileMetaError(err, { strict })) {
      addIssue(report, mode, `file_meta load failed (${err?.code || err?.message || err})`, 'Rebuild index artifacts for this mode.');
      if (strict) modeReport.ok = false;
    }
  }

  const fileMetaById = buildFileMetaById(fileMeta);
  const chunkUidSet = enrichChunkMeta(chunkMeta, fileMetaById);

  validateChunkIds(report, mode, chunkMeta);

  await validateRiskInterproceduralArtifacts({
    report,
    mode,
    dir,
    manifest,
    strict,
    chunkUidSet,
    indexState,
    readJsonArtifact,
    shouldLoadOptional,
    checkPresence
  });

  if (strict) {
    validateChunkIdentity(report, mode, chunkMeta);
    validateMetaV2Types(report, mode, chunkMeta);
    validateMetaV2Equivalence(report, mode, chunkMeta, { maxSamples: 25, maxErrors: 10 });
    if (sqliteEnabled && (mode === 'code' || mode === 'prose')) {
      const sqlitePaths = resolveSqlitePaths(root, userConfig, indexRoot ? { indexRoot } : {});
      const dbPath = mode === 'code' ? sqlitePaths.codePath : sqlitePaths.prosePath;
      if (dbPath && fs.existsSync(dbPath)) {
        let Database = null;
        try {
          ({ default: Database } = await import('better-sqlite3'));
        } catch {
          addIssue(report, mode, 'sqlite parity check skipped: better-sqlite3 unavailable');
        }
        if (Database) {
          const db = new Database(dbPath, { readonly: true });
          try {
            const rows = db.prepare(
              'SELECT id, chunk_id, metaV2_json FROM chunks WHERE mode = ? ORDER BY id LIMIT ?'
            ).all(mode, SQLITE_META_V2_PARITY_SAMPLE);
            validateSqliteMetaV2Parity(report, mode, chunkMeta, rows, { maxErrors: 10 });
          } finally {
            db.close();
          }
        }
      }
    }
  }

  return {
    chunkMeta,
    fileMeta,
    indexState,
    chunkUidSet
  };
};

export const validateFileMetaConsistency = ({
  report,
  mode,
  strict,
  fileMeta,
  chunkMeta
}) => {
  if (!fileMeta) return;
  validateSchema(report, mode, 'file_meta', fileMeta, 'Rebuild index artifacts for this mode.', { strictSchema: strict });
  const fileIds = new Set();
  for (const entry of Array.isArray(fileMeta) ? fileMeta : []) {
    if (!Number.isFinite(entry?.id)) continue;
    if (fileIds.has(entry.id)) {
      addIssue(report, mode, `file_meta duplicate id ${entry.id}`, 'Rebuild index artifacts for this mode.');
      break;
    }
    fileIds.add(entry.id);
  }
  for (const chunk of chunkMeta) {
    const fileId = chunk?.fileId;
    if (fileId == null) continue;
    if (!fileIds.has(fileId)) {
      addIssue(report, mode, `chunk_meta fileId missing in file_meta (${fileId})`, 'Rebuild index artifacts for this mode.');
      break;
    }
  }
};
