import { MAX_JSON_BYTES, loadPiecesManifest, readCompatibilityKey } from '../../../shared/artifact-io.js';
import { requireIndexDir, resolveIndexDir } from '../../cli-index.js';
import { hasIndexMetaAsync } from '../index-loader.js';

const createIndexMetaCache = (indexMetaByMode = null) => {
  const indexMetaCacheByDir = new Map();
  const initialMetaByMode = indexMetaByMode instanceof Map
    ? indexMetaByMode
    : null;

  return async (dir, mode = null) => {
    if (!dir) return false;
    if (mode && initialMetaByMode?.has(mode)) {
      return initialMetaByMode.get(mode) === true;
    }
    if (indexMetaCacheByDir.has(dir)) return indexMetaCacheByDir.get(dir);
    const value = await hasIndexMetaAsync(dir);
    indexMetaCacheByDir.set(dir, value);
    if (mode && initialMetaByMode) {
      initialMetaByMode.set(mode, value);
    }
    return value;
  };
};

const ensureStrictManifest = (dir) => {
  if (!dir) return;
  loadPiecesManifest(dir, { maxBytes: MAX_JSON_BYTES, strict: true });
};

const hasMixedCompatibilityKeys = (entries) => (new Set(entries.values())).size > 1;

export async function resolveSearchIndexMetadata({
  rootDir,
  userConfig,
  searchMode,
  runProse,
  runExtractedProse,
  loadExtractedProse = false,
  runCode,
  runRecords,
  useSqlite,
  emitOutput,
  exitOnError,
  strict = true,
  allowUnsafeMix = false,
  indexMetaByMode = null,
  indexDirByMode = null,
  indexBaseRootByMode = null,
  explicitRef = false
}) {
  const resolveOptions = {
    indexDirByMode,
    indexBaseRootByMode,
    explicitRef
  };
  const proseIndexDir = runProse ? resolveIndexDir(rootDir, 'prose', userConfig, resolveOptions) : null;
  const codeIndexDir = runCode ? resolveIndexDir(rootDir, 'code', userConfig, resolveOptions) : null;
  const proseDir = runProse && !useSqlite
    ? requireIndexDir(rootDir, 'prose', userConfig, { emitOutput, exitOnError, resolveOptions })
    : proseIndexDir;
  const codeDir = runCode && !useSqlite
    ? requireIndexDir(rootDir, 'code', userConfig, { emitOutput, exitOnError, resolveOptions })
    : codeIndexDir;
  const recordsDir = runRecords
    ? requireIndexDir(rootDir, 'records', userConfig, { emitOutput, exitOnError, resolveOptions })
    : null;

  let extractedProseDir = null;
  let resolvedRunExtractedProse = runExtractedProse;
  let resolvedLoadExtractedProse = runExtractedProse || loadExtractedProse;
  const hasIndexMetaCached = createIndexMetaCache(indexMetaByMode);

  const disableOptionalExtractedProse = (reason = null) => {
    if (!resolvedLoadExtractedProse || resolvedRunExtractedProse) return false;
    if (reason && emitOutput) {
      console.warn(`[search] ${reason}; skipping extracted-prose comment joins.`);
    }
    resolvedLoadExtractedProse = false;
    extractedProseDir = null;
    return true;
  };

  if (resolvedLoadExtractedProse) {
    if (resolvedRunExtractedProse && (searchMode === 'extracted-prose' || searchMode === 'default')) {
      extractedProseDir = requireIndexDir(rootDir, 'extracted-prose', userConfig, {
        emitOutput,
        exitOnError,
        resolveOptions
      });
    } else {
      try {
        extractedProseDir = resolveIndexDir(rootDir, 'extracted-prose', userConfig, resolveOptions);
      } catch (error) {
        if (error?.code !== 'NO_INDEX') throw error;
        resolvedRunExtractedProse = false;
        resolvedLoadExtractedProse = false;
        extractedProseDir = null;
      }
      if (resolvedLoadExtractedProse && !await hasIndexMetaCached(extractedProseDir, 'extracted-prose')) {
        if (resolvedRunExtractedProse && emitOutput) {
          console.warn('[search] extracted-prose index not found; skipping.');
        }
        resolvedRunExtractedProse = false;
        resolvedLoadExtractedProse = false;
        extractedProseDir = null;
      }
    }
  }

  if (strict) {
    if (runCode) ensureStrictManifest(codeDir);
    if (runProse) ensureStrictManifest(proseDir);
    if (runRecords) ensureStrictManifest(recordsDir);
    if (resolvedRunExtractedProse && resolvedLoadExtractedProse) ensureStrictManifest(extractedProseDir);
  }

  const compatibilityTargetCandidates = [
    runCode ? { mode: 'code', dir: codeDir } : null,
    runProse ? { mode: 'prose', dir: proseDir } : null,
    runRecords ? { mode: 'records', dir: recordsDir } : null,
    resolvedLoadExtractedProse ? { mode: 'extracted-prose', dir: extractedProseDir } : null
  ].filter((entry) => entry && entry.dir);
  const compatibilityChecks = await Promise.all(
    compatibilityTargetCandidates.map(async (entry) => ({
      entry,
      hasMeta: await hasIndexMetaCached(entry.dir, entry.mode)
    }))
  );
  const compatibilityTargets = compatibilityChecks
    .filter((check) => check.hasMeta)
    .map((check) => check.entry);
  if (compatibilityTargets.length) {
    const compatibilityResults = await Promise.all(
      compatibilityTargets.map(async (entry) => {
        const strictCompatibilityKey = strict && (entry.mode !== 'extracted-prose' || resolvedRunExtractedProse);
        const { key } = readCompatibilityKey(entry.dir, {
          maxBytes: MAX_JSON_BYTES,
          strict: strictCompatibilityKey
        });
        return { mode: entry.mode, key };
      })
    );
    let keysToValidate = new Map(compatibilityResults.map((entry) => [entry.mode, entry.key]));
    if (hasMixedCompatibilityKeys(keysToValidate) && !resolvedRunExtractedProse && keysToValidate.has('extracted-prose')) {
      const filtered = new Map(Array.from(keysToValidate.entries()).filter(([mode]) => mode !== 'extracted-prose'));
      if (!hasMixedCompatibilityKeys(filtered)) {
        disableOptionalExtractedProse('extracted-prose index mismatch');
        keysToValidate = filtered;
      }
    }
    if (hasMixedCompatibilityKeys(keysToValidate)) {
      const details = Array.from(keysToValidate.entries())
        .map(([mode, key]) => `- ${mode}: ${key}`)
        .join('\n');
      if (allowUnsafeMix === true) {
        if (emitOutput) {
          console.warn(
            '[search] compatibilityKey mismatch overridden via --allow-unsafe-mix. ' +
            'Results may combine incompatible index cohorts:\n' +
            details
          );
        }
      } else {
        throw new Error(`Incompatible indexes detected (compatibilityKey mismatch):\n${details}`);
      }
    }
  }

  return {
    resolveOptions,
    proseIndexDir,
    codeIndexDir,
    proseDir,
    codeDir,
    recordsDir,
    extractedProseDir,
    resolvedRunExtractedProse,
    resolvedLoadExtractedProse
  };
}
