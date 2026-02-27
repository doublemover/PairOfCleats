import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { parseClikeSignature } from './signature-parse/clike.js';
import { isAbsolutePathNative } from '../../shared/files.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { normalizeCommandArgs } from './provider-utils.js';

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
  const normalizedArgs = normalizeCommandArgs(args);
  for (let i = 0; i < normalizedArgs.length; i += 1) {
    if (normalizedArgs[i] !== '-data') continue;
    if (normalizedArgs[i + 1]) return normalizedArgs;
  }
  return [...normalizedArgs, '-data', workspaceDataDir];
};

export const createJdtlsProvider = () => createDedicatedLspProvider({
  id: 'jdtls',
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
  command: {
    defaultCmd: 'jdtls',
    resolveArgs: (config) => normalizeCommandArgs(config?.args),
    commandUnavailableCheck: {
      name: 'jdtls_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for jdtls.`
    }
  },
  parseSignature: (detail, _lang, symbolName) => parseClikeSignature(detail, symbolName),
  prepareCollect: async ({ ctx, config, requested, commandProfile }) => {
    const workspaceDataDir = resolveWorkspaceDataDir(ctx, config);
    try {
      await fsPromises.mkdir(workspaceDataDir, { recursive: true });
    } catch {}
    return {
      args: ensureWorkspaceDataArg(commandProfile.resolved.args || requested.args, workspaceDataDir)
    };
  }
});
