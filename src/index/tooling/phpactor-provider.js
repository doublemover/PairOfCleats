import { parsePhpSignature } from './signature-parse/php.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgToken, normalizeCommandArgs } from './provider-utils.js';
import { resolvePhpactorComposerPreflight } from './preflight/phpactor-composer.js';

const ensureLanguageServerArg = args => ensureCommandArgToken(args, 'language-server', { position: 'prepend' });

export const createPhpactorProvider = () => createDedicatedLspProvider({
  id: 'phpactor', version: '1.1.0', preflightId: 'phpactor.workspace-model',
  label: 'phpactor (dedicated)', priority: 86, languages: ['php'], configKey: 'phpactor',
  docExtensions: ['.php', '.phtml'], duplicateLabel: 'phpactor', requiresWorkspaceExecution: true,
  requires: { cmd: 'phpactor', args: ['language-server'] },
  workspace: {
    markerOptions: { exactNames: ['composer.json'] },
    missingCheck: { name: 'phpactor_workspace_model_missing', message: 'phpactor workspace markers not found; skipping dedicated provider.' }
  },
  preflightPolicy: 'required',
  preflightRuntimeRequirements: [{ id: 'php', cmd: 'php', args: ['--version'], label: 'PHP runtime' }],
  command: {
    defaultCmd: 'phpactor', resolveArgs: config => ensureLanguageServerArg(normalizeCommandArgs(config?.args)),
    commandUnavailableCheck: { name: 'phpactor_command_unavailable', message: requestedCmd => `${requestedCmd} command not available for phpactor.` }
  },
  parseSignature: detail => parsePhpSignature(detail),
  preflight: resolvePhpactorComposerPreflight,
  prepareCollect: ({ commandProfile, requested }) => ({ args: ensureLanguageServerArg(commandProfile.resolved.args || requested.args) })
});
