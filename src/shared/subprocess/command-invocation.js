import { spawnSubprocess, spawnSubprocessSync } from './runner.js';
import {
  resolveWindowsCmdInvocation,
  resolveWindowsCmdShimPath
} from './windows-cmd.js';

export const shouldUseCommandShimShell = (command, env = process.env, options = {}) => (
  process.platform === 'win32' && Boolean(resolveWindowsCmdShimPath(command, env, options))
);

export const resolveCommandInvocation = (command, args = [], env = process.env, options = {}) => {
  const resolvedCommand = String(command || '').trim();
  const resolvedArgs = Array.isArray(args) ? args : [];
  if (!shouldUseCommandShimShell(resolvedCommand, env, options)) {
    return {
      command: resolvedCommand,
      args: resolvedArgs,
      env: null
    };
  }
  return resolveWindowsCmdInvocation(resolvedCommand, resolvedArgs, env, options);
};

const mergeInvocationEnv = (baseEnv, invocationEnv) => (
  invocationEnv ? { ...baseEnv, ...invocationEnv } : baseEnv
);

export const spawnResolvedSubprocess = (command, args = [], options = {}) => {
  const effectiveEnv = options.env || process.env;
  const invocation = resolveCommandInvocation(command, args, effectiveEnv, { cwd: options.cwd });
  return spawnSubprocess(invocation.command, invocation.args, {
    ...options,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments ?? options.windowsVerbatimArguments,
    env: mergeInvocationEnv(effectiveEnv, invocation.env)
  });
};

export const spawnResolvedSubprocessSync = (command, args = [], options = {}) => {
  const effectiveEnv = options.env || process.env;
  const invocation = resolveCommandInvocation(command, args, effectiveEnv, { cwd: options.cwd });
  return spawnSubprocessSync(invocation.command, invocation.args, {
    ...options,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments ?? options.windowsVerbatimArguments,
    env: mergeInvocationEnv(effectiveEnv, invocation.env)
  });
};
