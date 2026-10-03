import path from 'node:path';
import {
  buildIndex as coreBuildIndex,
  buildSqliteIndex as coreBuildSqliteIndex
} from '../../../../src/integrations/core/index.js';
import { attachObservability, buildChildObservability } from '../../../../src/shared/observability.js';
import { createProgressReporter } from '../../../../src/shared/progress-events.js';
import { clearRepoCaches } from '../../repo.js';
import { runToolWithProgress } from '../../runner.js';
import { maybeRestoreArtifacts, resolveMcpRepoContext, toolRoot } from '../helpers.js';

/**
 * Handle the MCP build_index tool call.
 * @param {object} [args]
 * @returns {object}
 */
export async function buildIndex(args = {}, context = {}) {
  const { repoPath, userConfig, runtimeEnv } = resolveMcpRepoContext(args.repoPath);
  const sqliteConfigured = userConfig.sqlite?.use !== false;
  const shouldUseSqlite = typeof args.sqlite === 'boolean' ? args.sqlite : sqliteConfigured;
  const mode = args.mode || 'all';
  const incremental = args.incremental === true;
  const stubEmbeddings = args.stubEmbeddings === true;
  const buildSqlite = shouldUseSqlite;
  const useArtifacts = args.useArtifacts === true;
  const reporter = createProgressReporter(context);
  const observability = buildChildObservability(context.observability, {
    surface: 'build',
    operation: 'build_index',
    context: {
      repoRoot: repoPath,
      mode,
      incremental
    }
  });
  const heartbeatIntervalMs = 15000;
  const withHeartbeat = async (label, fn) => {
    let timer = null;
    if (reporter) {
      reporter.start(label, { observability });
      timer = setInterval(() => {
        reporter.phase('progress', `${label} (working)`, { observability });
      }, heartbeatIntervalMs);
      timer.unref?.();
    }
    try {
      return await fn();
    } finally {
      if (timer) clearInterval(timer);
    }
  };

  let restoredArtifacts = false;
  if (useArtifacts) {
    restoredArtifacts = maybeRestoreArtifacts(repoPath, args.artifactsDir, context, runtimeEnv);
  }

  if (!restoredArtifacts) {
    await withHeartbeat(
      `Building ${mode} index${incremental ? ' (incremental)' : ''}.`,
      () => coreBuildIndex(repoPath, {
        mode,
        incremental,
        'stub-embeddings': stubEmbeddings,
        sqlite: buildSqlite,
        emitOutput: false,
        observability
      })
    );
  }

  if (buildSqlite) {
    await withHeartbeat(
      `Building SQLite index${incremental ? ' (incremental)' : ''}.`,
      () => coreBuildSqliteIndex(repoPath, {
        incremental,
        emitOutput: false
      })
    );
  }
  reporter?.done('Index build complete.', { observability });
  clearRepoCaches(repoPath);

  return attachObservability({
    repoPath,
    mode,
    sqlite: buildSqlite,
    incremental,
    restoredArtifacts
  }, observability);
}

/**
 * Handle the MCP build_sqlite_index tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function buildSqliteIndex(args = {}, context = {}) {
  const { repoPath } = resolveMcpRepoContext(args.repoPath, {
    includeRuntimeEnv: false,
    includeUserConfig: false
  });
  const reporter = createProgressReporter(context);
  reporter?.start('Building SQLite index.');
  const payload = await coreBuildSqliteIndex(repoPath, {
    mode: args.mode,
    incremental: args.incremental === true,
    compact: args.compact === true,
    asOf: args.asOf,
    snapshot: args.snapshot,
    codeDir: args.codeDir,
    proseDir: args.proseDir,
    out: args.out,
    emitOutput: false,
    exitOnError: false
  });
  clearRepoCaches(repoPath);
  reporter?.done('SQLite index build complete.');
  return payload;
}

/**
 * Handle the MCP compact_sqlite_index tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function compactSqliteIndex(args = {}, context = {}) {
  const { repoPath, runtimeEnv } = resolveMcpRepoContext(args.repoPath);
  const scriptArgs = [path.join(toolRoot, 'tools', 'build', 'compact-sqlite-index.js'), '--repo', repoPath];
  if (args.mode) scriptArgs.push('--mode', String(args.mode));
  if (args.dryRun === true) scriptArgs.push('--dry-run');
  if (args.keepBackup === true) scriptArgs.push('--keep-backup');
  const stdout = await runToolWithProgress({
    repoPath,
    scriptArgs,
    context,
    startMessage: 'Compacting SQLite index.',
    doneMessage: 'SQLite compaction complete.',
    env: runtimeEnv
  });
  return { repoPath, output: stdout.trim() };
}
