import { log } from '../../../../shared/progress.js';
import { discoverFiles } from '../../discover.js';

export const runDiscovery = async ({ runtime, mode, discovery, state, timing }) => {
  if (discovery && Array.isArray(discovery.skippedFiles) && state?.skippedFiles) {
    for (const file of discovery.skippedFiles) {
      state.skippedFiles.push(file);
    }
  }
  log('Discovering files...');
  const discoverStart = Date.now();
  let entries = null;
  if (discovery && Array.isArray(discovery.entries)) {
    entries = discovery.entries.slice();
    log('→ Reusing shared discovery results.');
  } else {
    entries = await runtime.queues.io.add(() => discoverFiles({
      root: runtime.root,
      mode,
      ignoreMatcher: runtime.ignoreMatcher,
      skippedFiles: state?.skippedFiles || [],
      maxFileBytes: runtime.maxFileBytes,
      fileCaps: runtime.fileCaps,
      maxDepth: runtime.guardrails?.maxDepth ?? null,
      maxFiles: runtime.guardrails?.maxFiles ?? null
    }));
  }
  entries.sort((a, b) => a.rel.localeCompare(b.rel));
  entries.forEach((entry, index) => {
    entry.orderIndex = index;
  });
  log(`→ Found ${entries.length} files.`);
  if (timing) timing.discoverMs = Date.now() - discoverStart;
  return entries;
};
