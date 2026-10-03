#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildAutoPolicy } from '../../../src/shared/auto-policy/build.js';
import { validateConfig } from '../../../src/config/validate.js';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope/resolve.js';
import { loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'shared-config-contract-matrix');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

{
  const scanRoot = path.join(tempRoot, 'auto-policy-scan');
  await fs.mkdir(path.join(scanRoot, 'src'), { recursive: true });
  await fs.mkdir(path.join(scanRoot, 'node_modules', 'pkg'), { recursive: true });
  await fs.mkdir(path.join(scanRoot, 'benchmarks', 'repos', 'fixture'), { recursive: true });
  await fs.writeFile(path.join(scanRoot, 'README.md'), '# fixture\n', 'utf8');
  await fs.writeFile(path.join(scanRoot, 'src', 'index.js'), 'export const value = 1;\n', 'utf8');
  await fs.writeFile(path.join(scanRoot, 'node_modules', 'pkg', 'ignored.js'), 'module.exports = 1;\n', 'utf8');
  await fs.writeFile(path.join(scanRoot, 'benchmarks', 'repos', 'fixture', 'ignored.txt'), 'ignore me\n', 'utf8');
  await fs.writeFile(path.join(scanRoot, '.gitignore'), 'benchmarks/\n', 'utf8');

  const logs = [];
  const policy = await buildAutoPolicy({
    repoRoot: scanRoot,
    config: { quality: 'max' },
    resources: { cpuCount: 16, memoryGb: 64 },
    scanLimits: { statConcurrency: 4 },
    logger: (line) => logs.push(String(line || ''))
  });
  assert.equal(policy.quality.value, 'max');
  assert.equal(policy.repo.fileCount, 2);
  assert.ok(logs.some((line) => line.includes('loaded ignore files') && line.includes('.gitignore')));
  assert.ok(logs.some((line) => line.includes('auto policy scan: starting')));
  assert.ok(logs.some((line) => line.includes('auto policy scan: done in')));
  assert.ok(logs.some((line) => line.includes('auto policy resolved:')));
}

{
  const baseRepo = { fileCount: 1000, totalBytes: 1024, truncated: false, huge: false };
  const fastPolicy = await buildAutoPolicy({
    config: { quality: 'auto' },
    resources: { cpuCount: 4, memoryGb: 8 },
    repo: baseRepo
  });
  assert.equal(fastPolicy.quality.value, 'fast');

  const hugePolicy = await buildAutoPolicy({
    config: { quality: 'auto' },
    resources: { cpuCount: 16, memoryGb: 64 },
    repo: { ...baseRepo, huge: true }
  });
  assert.equal(hugePolicy.quality.value, 'balanced');
  assert.equal(hugePolicy?.indexing?.hugeRepoProfile?.id, 'huge-repo');
  assert.equal(hugePolicy?.indexing?.hugeRepoProfile?.overrides?.scheduler?.queues?.['stage2.write']?.weight, 5);
  assert.equal(hugePolicy?.indexing?.hugeRepoProfile?.overrides?.scheduler?.queues?.['stage4.sqlite']?.weight, 5);
  assert.equal(hugePolicy?.indexing?.hugeRepoProfile?.overrides?.pipelineOverlap?.enabled, true);
  assert.equal(hugePolicy?.indexing?.hugeRepoProfile?.overrides?.documentExtraction?.enabled, false);
  assert.equal(hugePolicy?.indexing?.hugeRepoProfile?.overrides?.typeInferenceCrossFile, false);

  const explicitPolicy = await buildAutoPolicy({
    config: { quality: 'balanced' },
    resources: { cpuCount: 16, memoryGb: 64 },
    repo: { ...baseRepo, huge: true }
  });
  assert.equal(explicitPolicy.quality.value, 'balanced');
}

{
  const configRoot = path.join(tempRoot, 'normalization');
  await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(configRoot, '.pairofcleats.json'), JSON.stringify({
    quality: 'fast',
    threads: 6,
    search: { hyperlinks: 'vscode' }
  }, null, 2));

  const userConfig = loadUserConfig(configRoot);
  assert.equal(userConfig.quality, 'fast');
  assert.equal(userConfig.threads, 6);
  assert.equal(userConfig?.search?.hyperlinks, 'vscode');

  const policy = await buildAutoPolicy({
    config: userConfig,
    resources: { cpuCount: 8, memoryGb: 16 },
    repo: { fileCount: 100, totalBytes: 1024, truncated: false, huge: false }
  });
  assert.equal(policy.quality.value, 'fast');

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
  assert.equal(envelope.concurrency.threads.value, 6);
}

{
  const schema = {
    type: 'object',
    required: ['alpha'],
    additionalProperties: false
  };
  const result = validateConfig(schema, { beta: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((err) => err.includes('#/alpha is required')));
  assert.ok(result.errors.some((err) => err.includes('#/beta is not allowed')));
  assert.equal(validateConfig(schema, { alpha: 1 }).ok, true);
}

console.log('shared config contract matrix test passed');
