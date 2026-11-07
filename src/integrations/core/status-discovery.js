import { getTriageConfig } from '../../shared/dict-utils.js';
import { normalizeRecordsConfig } from '../../index/build/records.js';
import { buildGeneratedIndexingPolicyConfig } from '../../index/build/runtime/config.js';
import { resolveFileCapsAndGuardrails } from '../../index/build/runtime/caps.js';
import { buildIgnoreMatcher } from '../../index/build/ignore.js';
import { discoverFilesForModes } from '../../index/build/discover.js';

/** Use indexing's routing/ignore owners, including untracked files, within a bounded scan. */
export const discoverFreshnessFiles = async ({ repoRoot, userConfig = {}, maxFiles = 5000, timeoutMs = 2000 }) => {
  const modes = ['code', 'prose', 'extracted-prose', 'records'];
  const skippedByMode = Object.fromEntries(modes.map(mode => [mode, []]));
  const abortSignal = AbortSignal.timeout(timeoutMs);
  try {
    const generatedPolicy = buildGeneratedIndexingPolicyConfig(userConfig.indexing || {});
    const { maxFileBytes, fileCaps } = resolveFileCapsAndGuardrails(userConfig.indexing || {});
    const { ignoreMatcher } = await buildIgnoreMatcher({ root: repoRoot, userConfig, generatedPolicy });
    const entries = await discoverFilesForModes({ root: repoRoot, modes, ignoreMatcher,
      skippedByMode, maxFiles, abortSignal, strictTraversal: true, generatedPolicy, maxFileBytes, fileCaps,
      recordsDir: getTriageConfig(repoRoot, userConfig).recordsDir,
      documentExtractionConfig: userConfig.indexing?.documentExtraction,
      recordsConfig: normalizeRecordsConfig(userConfig.records || {}) });
    const truncated = Object.values(skippedByMode).some(rows => rows.some(row => ['max_files_reached', 'stat-failed'].includes(row.reason)));
    return { status: truncated ? 'partial' : 'complete',
      files: Object.fromEntries(modes.map(mode => [mode, entries[mode].map(entry => entry.rel)])) };
  } catch (error) {
    return { status: abortSignal.aborted ? 'timeout' : 'unavailable', code: error.code || null, files: null };
  }
};
