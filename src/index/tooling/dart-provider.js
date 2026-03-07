import fsSync from 'node:fs';
import path from 'node:path';
import { parseClikeSignature } from './signature-parse/clike.js';
import { readJsonFileSafe } from '../../shared/files.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgToken, normalizeCommandArgs } from './provider-utils.js';

const DART_EXTS = ['.dart'];
const DART_PACKAGE_CONFIG_REL_PATH = path.join('.dart_tool', 'package_config.json');
const DART_PACKAGE_CONFIG_MAX_BYTES = 2 * 1024 * 1024;

const ensureLanguageServerArgs = (args) => {
  const withLanguageServer = ensureCommandArgToken(args, 'language-server', { position: 'prepend' });
  return ensureCommandArgToken(withLanguageServer, '--protocol=lsp');
};

const resolveDartPackageConfigPreflight = async ({ ctx }) => {
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const pubspecPath = path.join(repoRoot, 'pubspec.yaml');
  if (!fsSync.existsSync(pubspecPath)) {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  const packageConfigPath = path.join(repoRoot, DART_PACKAGE_CONFIG_REL_PATH);
  let readError = null;
  const parsed = await readJsonFileSafe(packageConfigPath, {
    fallback: null,
    maxBytes: DART_PACKAGE_CONFIG_MAX_BYTES,
    onError: (info) => {
      readError = info;
    }
  });
  const code = String(readError?.error?.code || '').trim().toUpperCase();
  if (!readError) {
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.packages)) {
      return { state: 'ready', reasonCode: null, message: '', checks: [] };
    }
    const message = 'dart workspace package config is invalid (expected JSON object with packages array).';
    return {
      state: 'degraded',
      reasonCode: 'dart_workspace_package_config_invalid',
      message,
      checks: [{
        name: 'dart_workspace_package_config_invalid',
        status: 'warn',
        message
      }]
    };
  }
  if (code === 'ENOENT') {
    const message = 'dart workspace package config missing (.dart_tool/package_config.json); run dependency resolution to improve project-model fidelity.';
    return {
      state: 'degraded',
      reasonCode: 'dart_workspace_package_config_missing',
      message,
      checks: [{
        name: 'dart_workspace_package_config_missing',
        status: 'warn',
        message
      }]
    };
  }
  if (code === 'ERR_JSON_FILE_TOO_LARGE') {
    const message = `dart workspace package config exceeds ${DART_PACKAGE_CONFIG_MAX_BYTES} bytes.`;
    return {
      state: 'degraded',
      reasonCode: 'dart_workspace_package_config_too_large',
      message,
      checks: [{
        name: 'dart_workspace_package_config_too_large',
        status: 'warn',
        message
      }]
    };
  }
  if (String(readError?.phase || '').toLowerCase() === 'parse') {
    const message = `dart workspace package config is invalid JSON: ${readError?.error?.message || 'parse failed'}`;
    return {
      state: 'degraded',
      reasonCode: 'dart_workspace_package_config_invalid',
      message,
      checks: [{
        name: 'dart_workspace_package_config_invalid',
        status: 'warn',
        message
      }]
    };
  }
  const message = `dart workspace package config unreadable: ${readError?.error?.message || 'read failed'}`;
  return {
    state: 'degraded',
    reasonCode: 'dart_workspace_package_config_unreadable',
    message,
    checks: [{
      name: 'dart_workspace_package_config_unreadable',
      status: 'warn',
      message
    }]
  };
};

export const createDartProvider = () => createDedicatedLspProvider({
  id: 'dart',
  label: 'dart language-server (dedicated)',
  priority: 88,
  languages: ['dart'],
  configKey: 'dart',
  docExtensions: DART_EXTS,
  duplicateLabel: 'dart',
  requires: { cmd: 'dart', args: ['language-server', '--protocol=lsp'] },
  workspace: {
    markerOptions: {
      exactNames: ['pubspec.yaml']
    },
    missingCheck: {
      name: 'dart_workspace_model_missing',
      message: 'dart workspace markers not found; skipping dedicated provider.'
    }
  },
  preflightPolicy: 'required',
  preflightRuntimeRequirements: [{
    id: 'dart-sdk',
    cmd: 'dart',
    args: ['--version'],
    label: 'Dart SDK'
  }],
  command: {
    defaultCmd: 'dart',
    resolveArgs: (config) => ensureLanguageServerArgs(normalizeCommandArgs(config?.args)),
    commandUnavailableCheck: {
      name: 'dart_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for dart language-server.`
    }
  },
  parseSignature: (detail, _lang, symbolName) => parseClikeSignature(detail, symbolName),
  preflight: async ({ ctx }) => resolveDartPackageConfigPreflight({ ctx }),
  prepareCollect: ({ commandProfile, requested }) => ({
    args: ensureLanguageServerArgs(commandProfile.resolved.args || requested.args)
  })
});
