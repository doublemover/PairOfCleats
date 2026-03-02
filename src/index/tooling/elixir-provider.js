import fsSync from 'node:fs';
import path from 'node:path';
import { parseElixirSignature } from './signature-parse/elixir.js';
import { createDedicatedLspProvider } from './dedicated-lsp-provider.js';
import { normalizeCommandArgs } from './provider-utils.js';
import {
  resolveRuntimeProbeProfile,
  runtimeProbeMissing,
  runtimeProbeOk,
  runtimeProbeText
} from './preflight/runtime-probe.js';

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

const parseOtpMajorFromText = (text) => {
  const source = String(text || '');
  if (!source) return null;
  const otpMatch = source.match(/Erlang\/OTP\s+(\d{1,3})/i);
  if (otpMatch) {
    const value = Number(otpMatch[1]);
    return Number.isFinite(value) ? value : null;
  }
  const fallbackMatch = source.match(/\bOTP[-/\s]*(\d{1,3})\b/i);
  if (!fallbackMatch) return null;
  const value = Number(fallbackMatch[1]);
  return Number.isFinite(value) ? value : null;
};

const resolveElixirRuntimeMismatchPreflight = ({ ctx }) => {
  const elixirProfile = resolveRuntimeProbeProfile({
    ctx,
    providerId: 'elixir-ls',
    requirementId: 'elixir',
    cmd: 'elixir',
    args: ['--version']
  });
  const erlProfile = resolveRuntimeProbeProfile({
    ctx,
    providerId: 'elixir-ls',
    requirementId: 'erl',
    cmd: 'erl',
    args: ['-version']
  });
  if (!runtimeProbeOk(elixirProfile) || !runtimeProbeOk(erlProfile)) {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  if (runtimeProbeMissing(elixirProfile) || runtimeProbeMissing(erlProfile)) {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  const elixirOtp = parseOtpMajorFromText(runtimeProbeText(elixirProfile));
  const erlOtp = parseOtpMajorFromText(runtimeProbeText(erlProfile));
  if (!Number.isFinite(elixirOtp) || !Number.isFinite(erlOtp) || elixirOtp === erlOtp) {
    return { state: 'ready', reasonCode: null, message: '', checks: [] };
  }
  const message = `elixir runtime OTP mismatch detected (elixir expects OTP ${elixirOtp}, erl reports OTP ${erlOtp}); provider may run with degraded correctness.`;
  return {
    state: 'degraded',
    reasonCode: 'elixir_runtime_otp_mismatch',
    message,
    checks: [{
      name: 'elixir_runtime_otp_mismatch',
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
  preflight: async ({ ctx }) => {
    const runtimePreflight = resolveElixirRuntimeMismatchPreflight({ ctx });
    const workspacePreflight = resolveElixirWorkspaceBootstrapPreflight({ ctx });
    const firstNonReady = resolveFirstNonReadyPreflight(runtimePreflight, workspacePreflight);
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
  }
});
