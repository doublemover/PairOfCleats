#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getCapabilities } from '../../src/shared/capabilities.js';
import { getEnvConfig } from '../../src/shared/env.js';
import {
  getCacheRoot,
  getAutoPolicy,
  getRepoCacheRoot,
  resolveRepoConfig
} from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'config-dump',
  options: {
    repo: { type: 'string' },
    json: { type: 'boolean', default: false }
  }
}).parse();

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
const envConfig = getEnvConfig();
const policy = await getAutoPolicy(repoRoot, userConfig);
const cacheRoot = (userConfig.cache && userConfig.cache.root) || getCacheRoot();
const capabilities = getCapabilities();
const normalizeSelector = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const mcpModeConfig = normalizeSelector(userConfig?.mcp?.mode);
const mcpModeEnv = normalizeSelector(envConfig.mcpMode);
const mcpMode = mcpModeEnv || mcpModeConfig || 'auto';
const mcpModeSource = mcpModeEnv ? 'env' : (mcpModeConfig ? 'config' : 'default');
const payload = {
  repoRoot,
  userConfig,
  policy,
  derived: {
    cacheRoot,
    repoCacheRoot: getRepoCacheRoot(repoRoot, userConfig),
    mcp: {
      mode: mcpMode,
      modeSource: mcpModeSource,
      sdkAvailable: !!capabilities?.mcp?.sdk
    }
  }
};

if (argv.json) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.error('Config dump');
console.error(`- repo: ${repoRoot}`);
console.error(`- cache root: ${payload.derived.cacheRoot}`);
console.error(`- repo cache: ${payload.derived.repoCacheRoot}`);
console.error(`- quality: ${payload.policy.quality.value} (${payload.policy.quality.source})`);
console.error(`- mcp mode: ${payload.derived.mcp.mode} (${payload.derived.mcp.modeSource})`);
console.error(`- mcp sdk: ${payload.derived.mcp.sdkAvailable ? 'available' : 'missing'}`);
