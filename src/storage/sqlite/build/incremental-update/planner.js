import fsSync from 'node:fs';
import path from 'node:path';
import { readBundleFile } from '../../../../shared/bundle-io.js';
import {
  diffFileManifests,
  getFileManifest,
  normalizeManifestFiles,
  validateIncrementalManifest
} from '../manifest.js';

const addArrayValues = (target, values) => {
  if (!Array.isArray(values) || values.length === 0) return;
  for (const value of values) {
    target.add(value);
  }
};

/**
 * Build an incremental manifest change plan for sqlite updates.
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
 * @param {object} input
 * @param {Array<object>} input.changed
 * @param {string} input.bundleDir
 * @returns {Promise<
 *   {ok:true,bundles:Map<string,object>,tokenValues:string[],phraseValues:string[],chargramValues:string[],incomingDims:number|null}|
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
    const bundleName = entry?.bundle;
    if (!bundleName) {
      return { ok: false, reason: `missing bundle for ${fileKey}` };
    }
    const bundlePath = path.join(bundleDir, bundleName);
    if (!fsSync.existsSync(bundlePath)) {
      return { ok: false, reason: `bundle missing for ${fileKey}` };
    }
    const result = await readBundleFile(bundlePath);
    if (!result.ok) {
      return { ok: false, reason: `invalid bundle for ${fileKey}` };
    }
    const bundle = result.bundle;
    bundles.set(normalizedFile, { bundle, entry, fileKey, normalizedFile });
    for (const chunk of bundle?.chunks || []) {
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
    tokenValues: Array.from(tokenValues),
    phraseValues: Array.from(phraseValues),
    chargramValues: Array.from(chargramValues),
    incomingDims
  };
};
