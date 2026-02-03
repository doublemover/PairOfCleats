import path from 'node:path';
import { loadUserConfig } from '../../../shared/dict-utils.js';
import {
  buildIndex as coreBuildIndex,
  buildSqliteIndex as coreBuildSqliteIndex
} from '../../../../src/integrations/core/index.js';
import { clearRepoCaches, resolveRepoPath } from '../../repo.js';
import { runToolWithProgress } from '../../runner.js';
import { maybeRestoreArtifacts, resolveRepoRuntimeEnv, toolRoot } from '../helpers.js';

/**
 * Handle the MCP build_index tool call.
 * @param {object} [args]
 * @returns {object}
 */
export async function buildIndex(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const userConfig = loadUserConfig(repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, userConfig);
  const sqliteConfigured = userConfig.sqlite?.use !== false;
  const shouldUseSqlite = typeof args.sqlite === 'boolean' ? args.sqlite : sqliteConfigured;
  const mode = args.mode || 'all';
  const incremental = args.incremental === true;
  const stubEmbeddings = args.stubEmbeddings === true;
  const buildSqlite = shouldUseSqlite;
  const useArtifacts = args.useArtifacts === true;
  const progress = typeof context.progress === 'function' ? context.progress : null;

  let restoredArtifacts = false;
  if (useArtifacts) {
    restoredArtifacts = maybeRestoreArtifacts(repoPath, args.artifactsDir, progress, runtimeEnv);
  }

  if (!restoredArtifacts) {
    if (progress) {
      progress({
        message: `Building ${mode} index${incremental ? ' (incremental)' : ''}.`,
        phase: 'start'
      });
    }
    await coreBuildIndex(repoPath, {
      mode,
      incremental,
      'stub-embeddings': stubEmbeddings,
      sqlite: buildSqlite,
      emitOutput: true
    });
  }

  if (buildSqlite) {
    if (progress) {
      progress({
        message: `Building SQLite index${incremental ? ' (incremental)' : ''}.`,
        phase: 'start'
      });
    }
    await coreBuildSqliteIndex(repoPath, {
      incremental,
      emitOutput: true
    });
  }
  if (progress) {
    progress({
      message: 'Index build complete.',
      phase: 'done'
    });
  }
  clearRepoCaches(repoPath);

  return {
    repoPath,
    mode,
    sqlite: buildSqlite,
    incremental,
    restoredArtifacts
  };
}

/**
 * Handle the MCP build_sqlite_index tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function buildSqliteIndex(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const progress = typeof context.progress === 'function' ? context.progress : null;
  if (progress) {
    progress({ message: 'Building SQLite index.', phase: 'start' });
  }
  const payload = await coreBuildSqliteIndex(repoPath, {
    mode: args.mode,
    incremental: args.incremental === true,
    compact: args.compact === true,
    codeDir: args.codeDir,
    proseDir: args.proseDir,
    out: args.out,
    emitOutput: true,
    exitOnError: false
  });
  clearRepoCaches(repoPath);
  if (progress) {
    progress({ message: 'SQLite index build complete.', phase: 'done' });
  }
  return payload;
}

/**
 * Handle the MCP compact_sqlite_index tool call.
 * @param {object} [args]
 * @returns {Promise<object>}
 */
export async function compactSqliteIndex(args = {}, context = {}) {
  const repoPath = resolveRepoPath(args.repoPath);
  const runtimeEnv = resolveRepoRuntimeEnv(repoPath, loadUserConfig(repoPath));
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
