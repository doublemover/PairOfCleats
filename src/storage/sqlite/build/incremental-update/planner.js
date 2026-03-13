import fsSync from 'node:fs';
import { readBundleFile, resolveManifestBundleNames } from '../../../../shared/bundle-io.js';
import { toArray } from '../../../../shared/iterables.js';
import { joinPathSafe } from '../../../../shared/path-normalize.js';
import {
  diffFileManifests,
  getFileManifest,
  normalizeManifestFiles,
  validateIncrementalManifest
} from '../manifest.js';

/**
 * Add optional string arrays into a dedupe set.
 *
 * @param {Set<string>} target
 * @param {any} values
 * @returns {void}
 */
const addArrayValues = (target, values) => {
  const list = toArray(values);
  if (!list.length) return;
  for (const value of list) {
    target.add(value);
  }
};

const mergeBundleShards = (shards) => {
  if (!Array.isArray(shards) || !shards.length) return null;
  let merged = null;
  for (const shard of shards) {
    if (!shard || typeof shard !== 'object') return null;
    const chunks = Array.isArray(shard.chunks) ? shard.chunks : null;
    if (!chunks) return null;
    if (!merged) {
      merged = {
        ...shard,
        chunks: [...chunks]
      };
      continue;
    }
    merged.chunks.push(...chunks);
    if (!merged.fileRelations && shard.fileRelations) merged.fileRelations = shard.fileRelations;
    if (!Array.isArray(merged.vfsManifestRows) && Array.isArray(shard.vfsManifestRows)) {
      merged.vfsManifestRows = shard.vfsManifestRows;
    }
  }
  return merged;
};

/**
 * Build an incremental manifest change plan for sqlite updates.
 *
 * Guard invariants:
 * - Incremental manifests must validate and normalize without path conflicts.
 * - Change ratio checks are delegated to the caller-supplied guard function.
 * - A non-empty chunks table requires a non-empty file_manifest baseline.
 *
 * @param {object} input
 * @param {import('better-sqlite3').Database} input.db
 * @param {string} input.mode
 * @param {object} input.manifest
 * @param {(input:{mode:string,totalFiles:number,changedCount:number,deletedCount:number}) => {ok:boolean,changeRatio:number,maxChangeRatio:number}} input.evaluateChangeGuard
 * @returns {{ok:true,changed:Array<object>,deleted:string[],manifestUpdates:Array<object>,changeSummary:object}|{ok:false,reason:string,changeSummary?:object}}
 */
export const resolveIncrementalChangePlan = ({
  db,
  mode,
  manifest,
  evaluateChangeGuard
}) => {
  const manifestValidation = validateIncrementalManifest(manifest);
  if (!manifestValidation.ok) {
    return {
      ok: false,
      reason: `invalid manifest (${manifestValidation.errors.join('; ')})`
    };
  }

  const manifestFiles = manifest.files || {};
  const manifestLookup = normalizeManifestFiles(manifestFiles);
  if (!manifestLookup.entries.length) {
    return { ok: false, reason: 'incremental manifest empty' };
  }
  if (manifestLookup.conflicts.length) {
    return { ok: false, reason: 'manifest path conflicts' };
  }

  const dbFiles = getFileManifest(db, mode);
  if (!dbFiles.size) {
    const chunkRow = db.prepare('SELECT COUNT(*) AS total FROM chunks WHERE mode = ?')
      .get(mode) || {};
    if (Number.isFinite(chunkRow.total) && chunkRow.total > 0) {
      return { ok: false, reason: 'file manifest empty' };
    }
  }

  const { changed, deleted, manifestUpdates } = diffFileManifests(manifestLookup.entries, dbFiles);
  const totalFiles = manifestLookup.entries.length;
  const changeSummary = {
    totalFiles,
    changedFiles: changed.length,
    deletedFiles: deleted.length,
    manifestUpdates: manifestUpdates.length
  };
  const changeGuard = evaluateChangeGuard({
    mode,
    totalFiles,
    changedCount: changed.length,
    deletedCount: deleted.length
  });
  if (!changeGuard.ok) {
    return {
      ok: false,
      reason: `change ratio ${changeGuard.changeRatio.toFixed(2)} (changed=${changed.length}, deleted=${deleted.length}, total=${totalFiles}) exceeds ${changeGuard.maxChangeRatio}`,
      changeSummary
    };
  }
  return { ok: true, changed, deleted, manifestUpdates, changeSummary };
};

/**
 * Load changed bundles and collect insertion vocabulary/dense shape state in
 * one pass to avoid an additional bundle iteration.
 *
 * Invariants:
 * - Every changed file must resolve to an existing readable bundle.
 * - Embedding dimensions must match across all loaded changed bundles.
 *
 * @param {object} input
 * @param {Array<object>} input.changed
 * @param {string} input.bundleDir
 * @returns {Promise<
 *   {ok:true,bundles:Map<string,object>,tokenValues:Set<string>,phraseValues:Set<string>,chargramValues:Set<string>,incomingDims:number|null}|
 *   {ok:false,reason:string}
 * >}
 */
export const loadBundlesAndCollectState = async ({ changed, bundleDir }) => {
  const bundles = new Map();
  const tokenValues = new Set();
  const phraseValues = new Set();
  const chargramValues = new Set();
  let incomingDims = null;

  for (const record of changed) {
    const fileKey = record.file;
    const normalizedFile = record.normalized;
    const entry = record.entry;
    const bundleNames = resolveManifestBundleNames(entry);
    if (!bundleNames.length) {
      return { ok: false, reason: `missing bundle for ${fileKey}` };
    }
    const loadedShards = [];
    for (const bundleName of bundleNames) {
      const bundlePath = joinPathSafe(bundleDir, [bundleName]);
      if (!bundlePath) {
        return { ok: false, reason: `invalid bundle path for ${fileKey}` };
      }
      if (!fsSync.existsSync(bundlePath)) {
        return { ok: false, reason: `bundle missing for ${fileKey}` };
      }
      const result = await readBundleFile(bundlePath);
      if (!result.ok) {
        return { ok: false, reason: `invalid bundle for ${fileKey}` };
      }
      loadedShards.push(result.bundle);
    }
    const bundle = mergeBundleShards(loadedShards);
    if (!bundle) {
      return { ok: false, reason: `invalid bundle for ${fileKey}` };
    }
    bundles.set(normalizedFile, { bundle, entry, fileKey, normalizedFile });
    for (const chunk of toArray(bundle?.chunks)) {
      addArrayValues(tokenValues, chunk?.tokens);
      addArrayValues(phraseValues, chunk?.ngrams);
      addArrayValues(chargramValues, chunk?.chargrams);
      if (Array.isArray(chunk?.embedding) && chunk.embedding.length) {
        const dims = chunk.embedding.length;
        if (incomingDims === null) {
          incomingDims = dims;
        } else if (incomingDims !== dims) {
          return { ok: false, reason: 'embedding dims mismatch across bundles' };
        }
      }
    }
  }

  return {
    ok: true,
    bundles,
    tokenValues,
    phraseValues,
    chargramValues,
    incomingDims
  };
};
