import { spawnSubprocess, spawnSubprocessSync } from '../subprocess.js';
import {
  resolveWindowsCmdInvocation,
  resolveWindowsCmdShimPath
} from './windows-cmd.js';

export const shouldUseCommandShimShell = (command, env = process.env) => (
  process.platform === 'win32' && Boolean(resolveWindowsCmdShimPath(command, env))
);

export const resolveCommandInvocation = (command, args = [], env = process.env) => {
  const resolvedCommand = String(command || '').trim();
  const resolvedArgs = Array.isArray(args) ? args : [];
  if (!shouldUseCommandShimShell(resolvedCommand, env)) {
    return {
      command: resolvedCommand,
      args: resolvedArgs,
      env: null
    };
  }
  return resolveWindowsCmdInvocation(resolvedCommand, resolvedArgs, env);
};

const mergeInvocationEnv = (baseEnv, invocationEnv) => (
  invocationEnv ? { ...baseEnv, ...invocationEnv } : baseEnv
);

export const spawnResolvedSubprocess = (command, args = [], options = {}) => {
  const effectiveEnv = options.env || process.env;
  const invocation = resolveCommandInvocation(command, args, effectiveEnv);
  return spawnSubprocess(invocation.command, invocation.args, {
    ...options,
    env: mergeInvocationEnv(effectiveEnv, invocation.env)
  });
};

export const spawnResolvedSubprocessSync = (command, args = [], options = {}) => {
  const effectiveEnv = options.env || process.env;
  const invocation = resolveCommandInvocation(command, args, effectiveEnv);
  return spawnSubprocessSync(invocation.command, invocation.args, {
    ...options,
    env: mergeInvocationEnv(effectiveEnv, invocation.env)
  });
};
