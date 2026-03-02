import fsSync from 'node:fs';
import path from 'node:path';
import { parseRubySignature } from './signature-parse/ruby.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { ensureCommandArgToken, normalizeCommandArgs } from './provider-utils.js';
import {
  resolveRuntimeProbeProfile,
  runtimeProbeMissing
} from './preflight/runtime-probe.js';

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

const resolveSolargraphRuntimeToolchainPreflight = ({ ctx }) => {
  const rubyProfile = resolveRuntimeProbeProfile({
    ctx,
    providerId: 'solargraph',
    requirementId: 'ruby',
    cmd: 'ruby',
    args: ['--version']
  });
  if (rubyProfile?.probe?.ok !== true || runtimeProbeMissing(rubyProfile)) {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  const gemProfile = resolveRuntimeProbeProfile({
    ctx,
    providerId: 'solargraph',
    requirementId: 'gem',
    cmd: 'gem',
    args: ['--version']
  });
  const bundleProfile = resolveRuntimeProbeProfile({
    ctx,
    providerId: 'solargraph',
    requirementId: 'bundle',
    cmd: 'bundle',
    args: ['--version']
  });
  const missing = [];
  if (runtimeProbeMissing(gemProfile)) missing.push('gem');
  if (runtimeProbeMissing(bundleProfile)) missing.push('bundle');
  if (!missing.length) {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  const suffix = missing.join(', ');
  const primary = missing[0];
  const reasonCode = `solargraph_runtime_toolchain_missing_${primary}`;
  const message = `solargraph ruby toolchain missing required command(s): ${suffix}.`;
  return {
    state: 'degraded',
    reasonCode,
    message,
    checks: [{
      name: reasonCode,
      status: 'warn',
      message
    }]
  };
};

const resolveFirstNonReadyPreflight = (...entries) => {
  for (const entry of entries) {
    const state = String(entry?.state || 'ready').trim().toLowerCase();
    if (state !== 'ready') return entry;
  }
  return { state: 'ready', reasonCode: null, message: '', checks: [] };
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
  preflight: async ({ ctx }) => {
    const runtimePreflight = resolveSolargraphRuntimeToolchainPreflight({ ctx });
    const workspacePreflight = resolveSolargraphWorkspaceDependencyPreflight({ ctx });
    const firstNonReady = resolveFirstNonReadyPreflight(workspacePreflight, runtimePreflight);
    if (String(firstNonReady?.state || '').toLowerCase() === 'ready') {
      return firstNonReady;
    }
    const checks = [
      ...(Array.isArray(runtimePreflight?.checks) ? runtimePreflight.checks : []),
      ...(Array.isArray(workspacePreflight?.checks) ? workspacePreflight.checks : [])
    ];
    return {
      state: firstNonReady.state || 'degraded',
      reasonCode: firstNonReady.reasonCode || null,
      message: firstNonReady.message || '',
      ...(checks.length ? { checks } : {})
    };
  },
  prepareCollect: ({ commandProfile, requested }) => ({
    args: ensureStdioArg(commandProfile.resolved.args || requested.args)
  })
});
