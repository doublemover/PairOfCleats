import fsSync from 'node:fs';
import path from 'node:path';
import { parseRubySignature } from './signature-parse/ruby.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgToken, normalizeCommandArgs } from './provider-utils.js';

const RUBY_EXTS = ['.rb', '.rake', '.gemspec'];

const ensureStdioArg = (args) => {
  return ensureCommandArgToken(args, 'stdio');
};

const resolveSolargraphWorkspaceDependencyPreflight = ({ ctx }) => {
  const repoRoot = String(ctx?.repoRoot || process.cwd());
  const gemfilePath = path.join(repoRoot, 'Gemfile');
  if (!fsSync.existsSync(gemfilePath)) {
    return { state: 'ready', reasonCode: null, message: '' };
  }
  const lockPath = path.join(repoRoot, 'Gemfile.lock');
  if (fsSync.existsSync(lockPath)) {
    return { state: 'ready', reasonCode: null, message: '' };
  }
  const message = 'solargraph workspace is missing Gemfile.lock; dependency graph/bootstrap state may be incomplete.';
  return {
    state: 'degraded',
    reasonCode: 'solargraph_workspace_gemfile_lock_missing',
    message,
    checks: [{
      name: 'solargraph_workspace_gemfile_lock_missing',
      status: 'warn',
      message
    }]
  };
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
  preflightPolicy: 'required',
  preflightRuntimeRequirements: [{
    id: 'ruby',
    cmd: 'ruby',
    args: ['--version'],
    label: 'Ruby runtime'
  }, {
    id: 'gem',
    cmd: 'gem',
    args: ['--version'],
    label: 'RubyGems'
  }, {
    id: 'bundle',
    cmd: 'bundle',
    args: ['--version'],
    label: 'Bundler'
  }],
  command: {
    defaultCmd: 'solargraph',
    resolveArgs: (config) => ensureStdioArg(normalizeCommandArgs(config?.args)),
    commandUnavailableCheck: {
      name: 'solargraph_command_unavailable',
      message: (requestedCmd) => `${requestedCmd} command not available for solargraph.`
    }
  },
  parseSignature: parseRubySignature,
  preflight: async ({ ctx }) => resolveSolargraphWorkspaceDependencyPreflight({ ctx }),
  prepareCollect: ({ commandProfile, requested }) => ({
    args: ensureStdioArg(commandProfile.resolved.args || requested.args)
  })
});
