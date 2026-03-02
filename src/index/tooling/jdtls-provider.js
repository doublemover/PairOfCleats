import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parseClikeSignature } from './signature-parse/clike.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { acquireFileLock } from '../../shared/locks/file-lock.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgPair, normalizeCommandArgs } from './provider-utils.js';

const JAVA_EXTS = ['.java'];

const resolveWorkspaceDataDir = (ctx, config) => {
  const configured = typeof config?.workspaceDataDir === 'string'
    ? config.workspaceDataDir.trim()
    : '';
  if (configured) {
    return isAbsolutePathNative(configured)
      ? configured
      : path.resolve(ctx?.repoRoot || process.cwd(), configured);
  }
  const baseRoot = ctx?.cache?.dir || ctx?.buildRoot || ctx?.repoRoot || process.cwd();
  return path.join(baseRoot, 'tooling', 'lsp-workspaces', 'jdtls');
};

const ensureWorkspaceDataArg = (args, workspaceDataDir) => {
  return ensureCommandArgPair(normalizeCommandArgs(args), '-data', workspaceDataDir);
};

const resolveWorkspaceBootstrapLockPath = (workspaceDataDir) => (
  path.join(String(workspaceDataDir || ''), '.workspace.bootstrap.lock.json')
);

export const createJdtlsProvider = () => createDedicatedLspProvider({
  id: 'jdtls',
  preflightId: 'jdtls.workspace-bootstrap',
  preflightClass: 'workspace',
  label: 'jdtls (dedicated)',
  priority: 82,
  languages: ['java'],
  configKey: 'jdtls',
  docExtensions: JAVA_EXTS,
  duplicateLabel: 'jdtls',
  requires: { cmd: 'jdtls' },
  workspace: {
    markerOptions: {
      exactNames: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']
    },
    missingCheck: {
      name: 'jdtls_workspace_model_missing',
      message: 'jdtls workspace model markers not found; skipping dedicated provider.'
    }
  },
  preflightPolicy: 'required',
  preflightRuntimeRequirements: [{
    id: 'java',
    cmd: 'java',
    args: ['--version'],
    label: 'Java runtime'
  }, {
    id: 'javac',
    cmd: 'javac',
    args: ['--version'],
    label: 'Java compiler (JDK)'
  }],
  command: {
    defaultCmd: 'jdtls',
    resolveArgs: (config) => normalizeCommandArgs(config?.args),
    commandUnavailableCheck: {
      name: 'jdtls_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for jdtls.`
    }
  },
  parseSignature: (detail, _lang, symbolName) => parseClikeSignature(detail, symbolName),
  getPreflightKey: ({ ctx, config }) => resolveWorkspaceDataDir(ctx, config),
  preflight: async ({ ctx, config, abortSignal }) => {
    const workspaceDataDir = resolveWorkspaceDataDir(ctx, config);
    const lockPath = resolveWorkspaceBootstrapLockPath(workspaceDataDir);
    const lock = await acquireFileLock({
      lockPath,
      waitMs: 0,
      pollMs: 25,
      staleMs: 5 * 60 * 1000,
      signal: abortSignal || null,
      metadata: { scope: 'jdtls-workspace-bootstrap' },
      forceStaleCleanup: true
    });
    if (!lock) {
      return {
        state: 'blocked',
        reasonCode: 'jdtls_workspace_lock_unavailable',
        blockProvider: true,
        workspaceDataDir,
        workspaceReady: false,
        check: {
          name: 'jdtls_workspace_lock_unavailable',
          status: 'warn',
          message: 'jdtls workspace bootstrap lock unavailable; skipping dedicated provider.'
        }
      };
    }
    try {
      await fsPromises.mkdir(workspaceDataDir, { recursive: true });
      return {
        state: 'ready',
        workspaceDataDir,
        workspaceReady: true
      };
    } catch (error) {
      return {
        state: 'blocked',
        reasonCode: 'jdtls_workspace_data_dir_unavailable',
        blockProvider: true,
        workspaceDataDir,
        workspaceReady: false,
        check: {
          name: 'jdtls_workspace_data_dir_unavailable',
          status: 'warn',
          message: `jdtls workspace data directory unavailable: ${error?.message || String(error)}`
        }
      };
    } finally {
      try {
        await lock.release();
      } catch {}
    }
  },
  prepareCollect: async ({ ctx, config, preflight, requested, commandProfile }) => {
    const workspaceDataDir = String(
      preflight?.workspaceDataDir || resolveWorkspaceDataDir(ctx, config)
    );
    if (preflight?.workspaceReady !== true) {
      try {
        await fsPromises.mkdir(workspaceDataDir, { recursive: true });
      } catch {}
    }
    return {
      args: ensureWorkspaceDataArg(commandProfile.resolved.args || requested.args, workspaceDataDir)
    };
  }
});
