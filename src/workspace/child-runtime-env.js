import os from 'node:os';
import { createCli } from '../shared/cli.js';
import { INDEX_BUILD_OPTIONS } from '../shared/cli-option-sets.js';
import { validateBuildArgs } from '../shared/cli-option-validators.js';
import { resolveRuntimeEnvelope } from '../shared/runtime-envelope/resolve.js';
import { resolveRuntimeEnv } from '../shared/runtime-envelope/env-patch.js';
import { loadUserConfig, getAutoPolicy } from '../../tools/dict-utils/config.js';
import { getToolVersion } from '../../tools/dict-utils/tool.js';

/** Plan the child actually launched: it receives no parent process.execArgv. */
export const resolveWorkspaceChildRuntimePlan = async ({ repoRoot, buildArgs = [], baseEnv = process.env }) => {
  const rawArgs = [...buildArgs, '--repo', repoRoot];
  const cli = createCli({ argv: ['node', 'build_index.js', ...rawArgs], options: INDEX_BUILD_OPTIONS })
    .help(false).version(false).exitProcess(false).strictOptions().fail(message => { throw new Error(message); });
  const argv = cli.parseSync();
  validateBuildArgs(argv);
  const userConfig = loadUserConfig(repoRoot, { env: baseEnv });
  const autoPolicy = await getAutoPolicy(repoRoot, userConfig);
  const cpuCount = os.cpus().length;
  const envelope = resolveRuntimeEnvelope({ argv, rawArgv: rawArgs, userConfig, autoPolicy, env: { ...baseEnv },
    execArgv: [], cpuCount, toolVersion: getToolVersion(),
    processInfo: { pid: null, argv: rawArgs, execPath: process.execPath, nodeVersion: process.version,
      platform: process.platform, arch: process.arch, cpuCount } });
  return { env: resolveRuntimeEnv(envelope, baseEnv), evidence: { evidenceScope: 'launch-plan', repoRoot,
    runtime: envelope.runtime, concurrency: envelope.concurrency, warnings: envelope.warnings } };
};

export const resolveWorkspaceChildRuntimeEnv = async options => (await resolveWorkspaceChildRuntimePlan(options)).env;
