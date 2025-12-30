#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import minimist from 'minimist';
import { pipeline, env } from '@xenova/transformers';
import { DEFAULT_MODEL_ID, getModelConfig, loadUserConfig, resolveRepoRoot } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  string: ['model', 'cache-dir', 'repo'],
  default: {
    model: DEFAULT_MODEL_ID
  }
});

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const modelConfig = getModelConfig(root, userConfig);
const cacheDir = argv['cache-dir']
  ? path.resolve(argv['cache-dir'])
  : modelConfig.dir;
const modelId = argv.model || modelConfig.id || DEFAULT_MODEL_ID;

await fs.mkdir(cacheDir, { recursive: true });
env.cacheDir = cacheDir;

await pipeline('feature-extraction', modelId);

console.log(`Downloaded model ${modelId} to ${cacheDir}`);
