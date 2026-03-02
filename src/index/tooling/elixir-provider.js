import { parseElixirSignature } from './signature-parse/elixir.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { normalizeCommandArgs } from './provider-utils.js';

const ELIXIR_EXTS = ['.ex', '.exs'];

export const createElixirProvider = () => createDedicatedLspProvider({
  id: 'elixir-ls',
  label: 'elixir-ls (dedicated)',
  priority: 85,
  languages: ['elixir'],
  configKey: 'elixir',
  docExtensions: ELIXIR_EXTS,
  duplicateLabel: 'elixir-ls',
  requires: { cmd: 'elixir-ls' },
  workspace: {
    markerOptions: {
      exactNames: ['mix.exs']
    },
    missingCheck: {
      name: 'elixir_workspace_model_missing',
      message: 'elixir workspace markers not found; skipping dedicated provider.'
    }
  },
  preflightPolicy: 'required',
  preflightRuntimeRequirements: [{
    id: 'elixir',
    cmd: 'elixir',
    args: ['--version'],
    label: 'Elixir runtime'
  }, {
    id: 'erl',
    cmd: 'erl',
    args: ['-version'],
    label: 'Erlang runtime'
  }],
  command: {
    defaultCmd: 'elixir-ls',
    resolveArgs: (config) => normalizeCommandArgs(config?.args),
    commandUnavailableCheck: {
      name: 'elixir_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for elixir-ls.`
    }
  },
  parseSignature: parseElixirSignature
});
