import { parseRubySignature } from './signature-parse/ruby.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgToken, normalizeCommandArgs } from './provider-utils.js';

const RUBY_EXTS = ['.rb', '.rake', '.gemspec'];

const ensureStdioArg = (args) => {
  return ensureCommandArgToken(args, 'stdio');
};

export const createSolargraphProvider = () => createDedicatedLspProvider({
  id: 'solargraph',
  label: 'solargraph (dedicated)',
  priority: 84,
  languages: ['ruby'],
  configKey: 'solargraph',
  docExtensions: RUBY_EXTS,
  duplicateLabel: 'solargraph',
  requires: { cmd: 'solargraph', args: ['stdio'] },
  workspace: {
    markerOptions: {
      exactNames: ['gemfile']
    },
    missingCheck: {
      name: 'solargraph_workspace_model_missing',
      message: 'solargraph workspace markers not found; skipping dedicated provider.'
    }
  },
  command: {
    defaultCmd: 'solargraph',
    resolveArgs: (config) => ensureStdioArg(normalizeCommandArgs(config?.args)),
    commandUnavailableCheck: {
      name: 'solargraph_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for solargraph.`
    }
  },
  parseSignature: parseRubySignature,
  prepareCollect: ({ commandProfile, requested }) => ({
    args: ensureStdioArg(commandProfile.resolved.args || requested.args)
  })
});
