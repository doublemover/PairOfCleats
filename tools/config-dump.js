#!/usr/bin/env node
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import {
  getCacheRoot,
  getAutoPolicy,
  getRepoCacheRoot,
  loadUserConfig,
  resolveRepoRoot
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
const policy = await getAutoPolicy(repoRoot, userConfig);
const cacheRoot = (userConfig.cache && userConfig.cache.root) || getCacheRoot();
const payload = {
  repoRoot,
  userConfig,
  policy,
  derived: {
    cacheRoot,
    repoCacheRoot: getRepoCacheRoot(repoRoot, userConfig)
  }
};

if (argv.json) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

console.log('Config dump');
console.log(`- repo: ${repoRoot}`);
console.log(`- cache root: ${payload.derived.cacheRoot}`);
console.log(`- repo cache: ${payload.derived.repoCacheRoot}`);
console.log(`- quality: ${payload.policy.quality.value} (${payload.policy.quality.source})`);
