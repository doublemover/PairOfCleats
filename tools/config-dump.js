#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { getEnvConfig } from '../src/shared/env.js';
import {
  getCacheRoot,
  getCacheRuntimeConfig,
  getModelConfig,
  getRepoCacheRoot,
  getRuntimeConfig,
  getToolingConfig,
  loadUserConfig,
  resolveLmdbPaths,
  resolveRepoRoot,
  resolveSqlitePaths
} from './dict-utils.js';

const argv = createCli({
  scriptName: 'config-dump',
  options: {
    repo: { type: 'string' },
    json: { type: 'boolean', default: false }
  }
}).parse();

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const repoRoot = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(repoRoot);
const envConfig = getEnvConfig();

const runtimeConfig = getRuntimeConfig(repoRoot, userConfig);
const parsedUv = Number(process.env.UV_THREADPOOL_SIZE);
const effectiveUvThreadpoolSize = Number.isFinite(parsedUv) && parsedUv > 0 ? Math.floor(parsedUv) : null;


const cacheRoot = (userConfig.cache && userConfig.cache.root) || envConfig.cacheRoot || getCacheRoot();
const payload = {
  repoRoot,
  profile: userConfig.profile || null,
  env: envConfig,
  userConfig,
  derived: {
    cacheRoot,
    repoCacheRoot: getRepoCacheRoot(repoRoot, userConfig),
    runtime: { ...runtimeConfig, effectiveUvThreadpoolSize },
    cacheRuntime: getCacheRuntimeConfig(repoRoot, userConfig),
    model: getModelConfig(repoRoot, userConfig),
    tooling: getToolingConfig(repoRoot, userConfig),
    lmdb: resolveLmdbPaths(repoRoot, userConfig),
    sqlite: resolveSqlitePaths(repoRoot, userConfig)
  }
};

if (argv.json) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.log('Config dump');
console.log(`- repo: ${repoRoot}`);
console.log(`- profile: ${payload.profile || 'none'}`);
console.log(`- cache root: ${payload.derived.cacheRoot}`);
console.log(`- repo cache: ${payload.derived.repoCacheRoot}`);
console.log(`- runtime UV_THREADPOOL_SIZE: ${payload.derived.runtime.effectiveUvThreadpoolSize ?? 'default'}`);
console.log(`- model: ${payload.derived.model.id}`);
console.log(`- lmdb code: ${payload.derived.lmdb.codePath}`);
console.log(`- lmdb prose: ${payload.derived.lmdb.prosePath}`);
console.log(`- sqlite code: ${payload.derived.sqlite.codePath}`);
console.log(`- sqlite prose: ${payload.derived.sqlite.prosePath}`);
console.log(`- env overrides: ${Object.entries(envConfig).filter(([, value]) => value !== '' && value != null).map(([key]) => key).join(', ') || 'none'}`);
