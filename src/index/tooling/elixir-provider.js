import fsSync from 'node:fs';
import path from 'node:path';
import { parseElixirSignature } from './signature-parse/elixir.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { normalizeCommandArgs } from './provider-utils.js';

const ELIXIR_EXTS = ['.ex', '.exs'];

const resolveElixirWorkspaceBootstrapPreflight = ({ ctx }) => {
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const mixExsPath = path.join(repoRoot, 'mix.exs');
  if (!fsSync.existsSync(mixExsPath)) {
    return { state: 'ready', reasonCode: null, message: '' };
  }
  const mixLockPath = path.join(repoRoot, 'mix.lock');
  if (fsSync.existsSync(mixLockPath)) {
    return { state: 'ready', reasonCode: null, message: '' };
  }
  const message = 'elixir workspace is missing mix.lock; dependency graph/bootstrap state may be incomplete.';
  return {
    state: 'degraded',
    reasonCode: 'elixir_workspace_mix_lock_missing',
    message,
    checks: [{
      name: 'elixir_workspace_mix_lock_missing',
      status: 'warn',
      message
    }]
  };
};

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
  }, {
    id: 'mix',
    cmd: 'mix',
    args: ['--version'],
    label: 'Mix build tool'
  }],
  command: {
    defaultCmd: 'elixir-ls',
    resolveArgs: (config) => normalizeCommandArgs(config?.args),
    commandUnavailableCheck: {
      name: 'elixir_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for elixir-ls.`
    }
  },
  parseSignature: parseElixirSignature,
  preflight: async ({ ctx }) => resolveElixirWorkspaceBootstrapPreflight({ ctx })
});
