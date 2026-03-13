import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parseClikeSignature } from './signature-parse/clike.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { acquireFileLock, releaseFileLockOrThrow } from '../../shared/locks/file-lock.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgPair, normalizeCommandArgs } from './provider-utils.js';

const JAVA_EXTS = ['.java'];
const JAVA_COMMAND_TOKENS = new Set(['java', 'java.exe']);

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

const resolveWorkspaceRuntimeLockPath = (workspaceDataDir) => (
  path.join(String(workspaceDataDir || ''), '.workspace.runtime.lock.json')
);

const resolveLaunchArgValue = (args, flag) => {
  const normalized = Array.isArray(args) ? args.map((entry) => String(entry || '')) : [];
  const index = normalized.findIndex((entry) => entry === flag);
  if (index < 0) return { present: false, value: null };
  const value = typeof normalized[index + 1] === 'string' ? normalized[index + 1].trim() : '';
  if (!value || value.startsWith('-')) return { present: true, value: null };
  return { present: true, value };
};

const resolveLaunchPath = (repoRoot, value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isAbsolutePathNative(raw)) return raw;
  return path.resolve(repoRoot || process.cwd(), raw);
};

const resolveCommandToken = (value) => (
  path.basename(String(value || '').trim()).toLowerCase()
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
  preflight: async ({ ctx, config, abortSignal, requestedCommand, commandProfile }) => {
    const repoRoot = ctx?.repoRoot || process.cwd();
    const requestedCmd = String(commandProfile?.resolved?.cmd || requestedCommand?.cmd || '').trim();
    const commandToken = resolveCommandToken(requestedCmd);
    const launchArgs = Array.isArray(commandProfile?.resolved?.args)
      ? commandProfile.resolved.args
      : (Array.isArray(requestedCommand?.args) ? requestedCommand.args : normalizeCommandArgs(config?.args));
    const configurationArg = resolveLaunchArgValue(launchArgs, '-configuration');
    const jarArg = resolveLaunchArgValue(launchArgs, '-jar');
    if (JAVA_COMMAND_TOKENS.has(commandToken) && (!configurationArg.present || !jarArg.present)) {
      return {
        state: 'blocked',
        reasonCode: 'jdtls_launch_script_mismatch',
        blockProvider: true,
        check: {
          name: 'jdtls_launch_script_mismatch',
          status: 'warn',
          message: 'jdtls launch command points to java directly but is missing required -jar/-configuration launch args.'
        }
      };
    }
    if (configurationArg.present && !configurationArg.value) {
      return {
        state: 'blocked',
        reasonCode: 'jdtls_launch_contract_invalid',
        blockProvider: true,
        check: {
          name: 'jdtls_launch_contract_invalid',
          status: 'warn',
          message: 'jdtls launch args include -configuration but no configuration path value.'
        }
      };
    }
    if (configurationArg.value) {
      const configurationPath = resolveLaunchPath(repoRoot, configurationArg.value);
      if (!configurationPath || !await fsPromises.access(configurationPath).then(() => true).catch(() => false)) {
        return {
          state: 'blocked',
          reasonCode: 'jdtls_launch_configuration_missing',
          blockProvider: true,
          check: {
            name: 'jdtls_launch_configuration_missing',
            status: 'warn',
            message: `jdtls launch configuration path not found: ${configurationArg.value}`
          }
        };
      }
    }
    if (jarArg.present && !jarArg.value) {
      return {
        state: 'blocked',
        reasonCode: 'jdtls_launch_contract_invalid',
        blockProvider: true,
        check: {
          name: 'jdtls_launch_contract_invalid',
          status: 'warn',
          message: 'jdtls launch args include -jar but no launcher jar path value.'
        }
      };
    }
    if (jarArg.value) {
      const jarPath = resolveLaunchPath(repoRoot, jarArg.value);
      if (!jarPath || !await fsPromises.access(jarPath).then(() => true).catch(() => false)) {
        return {
          state: 'blocked',
          reasonCode: 'jdtls_launch_jar_missing',
          blockProvider: true,
          check: {
            name: 'jdtls_launch_jar_missing',
            status: 'warn',
            message: `jdtls launcher jar path not found: ${jarArg.value}`
          }
        };
      }
    }

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
      await releaseFileLockOrThrow(lock);
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
    const runtimeLock = await acquireFileLock({
      lockPath: resolveWorkspaceRuntimeLockPath(workspaceDataDir),
      waitMs: 0,
      pollMs: 25,
      staleMs: 5 * 60 * 1000,
      signal: ctx?.abortSignal || null,
      metadata: { scope: 'jdtls-workspace-runtime' },
      forceStaleCleanup: true
    });
    if (!runtimeLock) {
      return {
        skip: true,
        checks: [{
          name: 'jdtls_workspace_lock_unavailable',
          status: 'warn',
          message: 'jdtls workspace runtime lock unavailable; skipping dedicated provider.'
        }]
      };
    }
    return {
      args: ensureWorkspaceDataArg(commandProfile.resolved.args || requested.args, workspaceDataDir),
      collectOptions: {
        sessionPoolingEnabled: false
      },
      cleanup: async () => {
        await releaseFileLockOrThrow(runtimeLock);
      }
    };
  }
});
