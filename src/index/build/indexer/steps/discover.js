import { log, logLine } from '../../../../shared/progress.js';
import { compareStrings } from '../../../../shared/sort.js';
import { sha1 } from '../../../../shared/hash.js';
import { stableStringifyForSignature } from '../../../../shared/stable-json.js';
import { discoverFiles } from '../../discover.js';
import { coerceAbortSignal, throwIfAborted } from '../../../../shared/abort.js';

const MODE_LABEL_WIDTH = 'Extracted Prose'.length;

const formatModeLabel = (value) => {
  if (!value) return '';
  return String(value)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join(' ');
};

/**
 * Run discovery step (or reuse shared discovery) and normalize ordering.
 *
 * @param {object} input
 * @returns {Promise<Array<object>>}
 */
export const runDiscovery = async ({
  runtime,
  mode,
  discovery,
  state,
  timing,
  stageNumber = 1,
  abortSignal = null
}) => {
  const effectiveAbortSignal = coerceAbortSignal(abortSignal);
  throwIfAborted(effectiveAbortSignal);
  if (discovery && Array.isArray(discovery.skippedFiles) && state?.skippedFiles) {
    for (const file of discovery.skippedFiles) {
      state.skippedFiles.push(file);
    }
  }
  const modeLabel = formatModeLabel(mode).padStart(MODE_LABEL_WIDTH, ' ');
  const stageLabel = `Stage ${Number.isFinite(stageNumber) ? stageNumber : 1}`;
  logLine(`[${modeLabel} | ${stageLabel}]`, { kind: 'status', key: 'discovery' });
  const discoverStart = Date.now();
  let entries = null;
  if (discovery && Array.isArray(discovery.entries)) {
    entries = discovery.entries.slice();
    log('→ Reusing shared discovery results.');
  } else {
    entries = await runtime.queues.io.add(
      () => discoverFiles({
        root: runtime.root,
        mode,
        documentExtractionConfig: runtime.indexingConfig?.documentExtraction || null,
        recordsDir: runtime.recordsDir,
        recordsConfig: runtime.recordsConfig,
        scmProvider: runtime.scmProvider,
        scmProviderImpl: runtime.scmProviderImpl,
        scmRepoRoot: runtime.scmRepoRoot,
        ignoreMatcher: runtime.ignoreMatcher,
        generatedPolicy: runtime.generatedPolicy,
        skippedFiles: state?.skippedFiles || [],
        maxFileBytes: runtime.maxFileBytes,
        fileCaps: runtime.fileCaps,
        maxDepth: runtime.guardrails?.maxDepth ?? null,
        maxFiles: runtime.guardrails?.maxFiles ?? null,
        abortSignal: effectiveAbortSignal
      }),
      { signal: effectiveAbortSignal }
    );
  }
  throwIfAborted(effectiveAbortSignal);
  entries.sort((a, b) => compareStrings(a.rel, b.rel));
  entries = entries.map((entry, index) => ({
    ...entry,
    canonicalOrderIndex: index,
    orderIndex: index
  }));
  if (state) {
    const discoveryList = entries.map((entry) => ({
      file: entry.rel,
      size: Number.isFinite(entry?.stat?.size) ? entry.stat.size : null,
      mtimeMs: Number.isFinite(entry?.stat?.mtimeMs) ? entry.stat.mtimeMs : null
    }));
    state.discoveredFiles = entries.map((entry) => entry.rel);
    state.discoveryHash = sha1(stableStringifyForSignature(discoveryList));
    state.fileListHash = sha1(stableStringifyForSignature(state.discoveredFiles));
  }
  log(`→ Found ${entries.length} files.`);
  if (timing) timing.discoverMs = Date.now() - discoverStart;
  return entries;
};
