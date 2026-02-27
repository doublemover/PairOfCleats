import { parseClikeSignature } from './signature-parse/clike.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgToken, normalizeCommandArgs } from './provider-utils.js';

const DART_EXTS = ['.dart'];

const ensureLanguageServerArgs = (args) => {
  const withLanguageServer = ensureCommandArgToken(args, 'language-server', { position: 'prepend' });
  return ensureCommandArgToken(withLanguageServer, '--protocol=lsp');
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
  command: {
    defaultCmd: 'dart',
    resolveArgs: (config) => ensureLanguageServerArgs(normalizeCommandArgs(config?.args)),
    commandUnavailableCheck: {
      name: 'dart_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for dart language-server.`
    }
  },
  parseSignature: (detail, _lang, symbolName) => parseClikeSignature(detail, symbolName),
  prepareCollect: ({ commandProfile, requested }) => ({
    args: ensureLanguageServerArgs(commandProfile.resolved.args || requested.args)
  })
});
