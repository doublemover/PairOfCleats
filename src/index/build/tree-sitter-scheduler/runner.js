import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { throwIfAborted } from '../../../shared/abort.js';
import { resolveRuntimeEnv } from '../../../shared/runtime-envelope.js';
import { spawnSubprocess } from '../../../shared/subprocess.js';
import { buildTreeSitterSchedulerPlan } from './plan.js';
import { createTreeSitterSchedulerLookup } from './lookup.js';

const SCHEDULER_EXEC_PATH = fileURLToPath(new URL('./subprocess-exec.js', import.meta.url));

const loadIndexEntries = async ({ grammarKeys, paths }) => {
  const index = new Map();
  for (const grammarKey of grammarKeys || []) {
    const indexPath = paths.resultsIndexPathForGrammarKey(grammarKey);
    const text = await fs.readFile(indexPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const row = JSON.parse(trimmed);
      const virtualPath = row?.virtualPath || null;
      if (!virtualPath) continue;
      index.set(virtualPath, row);
    }
  }
  return index;
};

export const runTreeSitterScheduler = async ({
  mode,
  runtime,
  entries,
  outDir,
  fileTextCache = null,
  abortSignal = null,
  log = null
}) => {
  throwIfAborted(abortSignal);
  const planResult = await buildTreeSitterSchedulerPlan({
    mode,
    runtime,
    entries,
    outDir,
    fileTextCache,
    abortSignal,
    log
  });
  if (!planResult) return null;

  // Execute the plan in a separate Node process to isolate native parser memory
  // churn from the main indexer process.
  const runtimeEnv = runtime?.envelope
    ? resolveRuntimeEnv(runtime.envelope, process.env)
    : process.env;
  const grammarKeys = Array.isArray(planResult.plan?.grammarKeys) ? planResult.plan.grammarKeys : [];
  for (let i = 0; i < grammarKeys.length; i += 1) {
    const grammarKey = grammarKeys[i];
    if (log) log(`[tree-sitter:schedule] exec ${i + 1}/${grammarKeys.length}: ${grammarKey}`);
    await spawnSubprocess(process.execPath, [SCHEDULER_EXEC_PATH, '--outDir', outDir, '--grammarKey', grammarKey], {
      cwd: runtime?.root || undefined,
      env: runtimeEnv,
      stdio: 'inherit',
      shell: false,
      signal: abortSignal,
      killTree: true,
      rejectOnNonZeroExit: true
    });
  }

  const index = await loadIndexEntries({
    grammarKeys,
    paths: planResult.paths
  });
  const lookup = createTreeSitterSchedulerLookup({
    outDir,
    index,
    log
  });

  return {
    ...lookup,
    plan: planResult.plan,
    schedulerStats: planResult.plan
      ? { grammarKeys: (planResult.plan.grammarKeys || []).length, jobs: planResult.plan.jobs || 0 }
      : null
  };
};
