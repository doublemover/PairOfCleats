import os from 'node:os';
import { createCli } from '../cli.js';
import { INDEX_BUILD_OPTIONS } from '../cli-option-sets.js';
import { resolveRuntimeEnv as resolveRuntimeEnvFromEnvelope } from '../runtime-envelope/env-patch.js';
import { resolveRuntimeEnvelope } from '../runtime-envelope/resolve.js';
import { loadUserConfig, getAutoPolicy } from '../../../tools/dict-utils/config.js';
import { getRuntimeConfig, resolveRuntimeEnv } from '../../../tools/dict-utils/paths/runtime.js';
import { getToolVersion } from '../../../tools/dict-utils/tool.js';

export const resolveDispatchRuntimeEnv = async ({
  root,
  scriptPath,
  extraArgs = [],
  restArgs = [],
  baseEnv = process.env
} = {}) => {
  const userConfig = loadUserConfig(root);
  if (scriptPath === 'build_index.js' || scriptPath === 'tools/index/cli-entry.js') {
    const rawArgs = [...extraArgs, ...restArgs];
    const cli = createCli({
      argv: ['node', 'build_index.js', ...rawArgs],
      options: INDEX_BUILD_OPTIONS
    }).help(false).version(false).exitProcess(false);
    const argv = typeof cli.parseSync === 'function' ? cli.parseSync() : cli.parse();
    const autoPolicy = await getAutoPolicy(root, userConfig);
    const envelope = resolveRuntimeEnvelope({
      argv,
      rawArgv: rawArgs,
      userConfig,
      autoPolicy,
      env: baseEnv,
      execArgv: process.execArgv,
      cpuCount: os.cpus().length,
      processInfo: {
        pid: process.pid,
        argv: process.argv,
        execPath: process.execPath,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuCount: os.cpus().length
      },
      toolVersion: getToolVersion()
    });
    return resolveRuntimeEnvFromEnvelope(envelope, baseEnv);
  }
  const runtimeConfig = getRuntimeConfig(root, userConfig);
  return resolveRuntimeEnv(runtimeConfig, baseEnv);
};
