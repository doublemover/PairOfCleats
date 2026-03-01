import { parseClikeSignature } from './signature-parse/clike.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgToken, normalizeCommandArgs } from './provider-utils.js';

const PHP_EXTS = ['.php', '.phtml'];

const ensureLanguageServerArg = (args) => {
  return ensureCommandArgToken(args, 'language-server', { position: 'prepend' });
};

export const createPhpactorProvider = () => createDedicatedLspProvider({
  id: 'phpactor',
  label: 'phpactor (dedicated)',
  priority: 86,
  languages: ['php'],
  configKey: 'phpactor',
  docExtensions: PHP_EXTS,
  duplicateLabel: 'phpactor',
  requires: { cmd: 'phpactor', args: ['language-server'] },
  workspace: {
    markerOptions: {
      exactNames: ['composer.json']
    },
    missingCheck: {
      name: 'phpactor_workspace_model_missing',
      message: 'phpactor workspace markers not found; skipping dedicated provider.'
    }
  },
  command: {
    defaultCmd: 'phpactor',
    resolveArgs: (config) => ensureLanguageServerArg(normalizeCommandArgs(config?.args)),
    commandUnavailableCheck: {
      name: 'phpactor_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for phpactor.`
    }
  },
  parseSignature: (detail, _lang, symbolName) => parseClikeSignature(detail, symbolName),
  prepareCollect: ({ commandProfile, requested }) => ({
    args: ensureLanguageServerArg(commandProfile.resolved.args || requested.args)
  })
});
