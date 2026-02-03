#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { buildAutoPolicy } from '../../../src/shared/auto-policy.js';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'config-normalization');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const configPath = path.join(tempRoot, '.pairofcleats.json');
await fs.writeFile(
  configPath,
  JSON.stringify({ quality: 'fast', threads: 6 }, null, 2)
);

const userConfig = loadUserConfig(tempRoot);
if (userConfig.quality !== 'fast') {
  console.error(`expected quality to be preserved, got ${userConfig.quality}`);
  process.exit(1);
}
if (userConfig.threads !== 6) {
  console.error(`expected threads to be preserved, got ${userConfig.threads}`);
  process.exit(1);
}

const policy = await buildAutoPolicy({
  config: userConfig,
  resources: { cpuCount: 8, memoryGb: 16 },
  repo: { fileCount: 100, totalBytes: 1024, truncated: false, huge: false }
});
if (policy.quality.value !== 'fast') {
  console.error(`expected auto policy to use config quality, got ${policy.quality.value}`);
  process.exit(1);
}

const envelope = resolveRuntimeEnvelope({
  argv: {},
  rawArgv: [],
  userConfig,
  autoPolicy: policy,
  env: {},
  execArgv: [],
  cpuCount: 8,
  processInfo: { pid: 1, argv: [], execPath: 'node', nodeVersion: 'v0.0.0', platform: 'test', arch: 'x64', cpuCount: 8 },
  toolVersion: 'test'
});

if (envelope.concurrency.threads.value !== 6) {
  console.error(`expected runtime envelope threads to be 6, got ${envelope.concurrency.threads.value}`);
  process.exit(1);
}

console.log('config normalization quality/threads test passed');
