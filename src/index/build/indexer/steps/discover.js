import { log, logLine } from '../../../../shared/progress.js';
import { compareStrings } from '../../../../shared/sort.js';
import { discoverFiles } from '../../discover.js';

const MODE_LABEL_WIDTH = 'Extracted Prose'.length;

const formatModeLabel = (value) => {
  if (!value) return '';
  return String(value)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ''}${part.slice(1)}`)
    .join(' ');
};

export const runDiscovery = async ({ runtime, mode, discovery, state, timing, stageNumber = 1 }) => {
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
    entries = await runtime.queues.io.add(() => discoverFiles({
      root: runtime.root,
      mode,
      recordsDir: runtime.recordsDir,
      recordsConfig: runtime.recordsConfig,
      ignoreMatcher: runtime.ignoreMatcher,
      skippedFiles: state?.skippedFiles || [],
      maxFileBytes: runtime.maxFileBytes,
      fileCaps: runtime.fileCaps,
      maxDepth: runtime.guardrails?.maxDepth ?? null,
      maxFiles: runtime.guardrails?.maxFiles ?? null
    }));
  }
  entries.sort((a, b) => compareStrings(a.rel, b.rel));
  entries.forEach((entry, index) => {
    entry.orderIndex = index;
  });
  log(`→ Found ${entries.length} files.`);
  if (timing) timing.discoverMs = Date.now() - discoverStart;
  return entries;
};
