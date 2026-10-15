#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServiceRuntimeEnvResolver } from '../../../tools/service/indexer-service-helpers.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-service-revalidation-'));
const repo = path.join(temp, 'repo');
fs.mkdirSync(repo);
const config = path.join(repo, '.pairofcleats.json');
const trusted = path.join(temp, 'trusted.json');
const write = (filename, heap) => fs.writeFileSync(filename, JSON.stringify({ runtime: { maxOldSpaceMb: heap } }));
const originalNow = Date.now;
let now = 10000;
Date.now = () => now;
try {
  write(config, 128);
  const resolver = createServiceRuntimeEnvResolver({ baseEnv: {}, revalidateMs: 1000 });
  assert.equal(resolver.getCachedRuntimeConfig(repo).maxOldSpaceMb, 128);
  write(config, 256);
  for (let index = 0; index < 6; index += 1) {
    now += 250;
    assert.equal(resolver.getCachedRuntimeConfig(repo).maxOldSpaceMb, index < 3 ? 128 : 256);
  }
  write(trusted, 512);
  const env = { PAIROFCLEATS_TRUSTED_CONFIG: trusted };
  assert.equal(resolver.getCachedRuntimeConfig(repo, env).maxOldSpaceMb, 512);
  const old = fs.statSync(trusted);
  write(trusted + '.replacement', 768);
  fs.utimesSync(trusted + '.replacement', old.atime, old.mtime);
  fs.renameSync(trusted + '.replacement', trusted);
  now += 1000;
  const replaced = resolver.getCachedRuntimeConfig(repo, env);
  assert.equal(replaced.maxOldSpaceMb, 768, 'trusted replacement detected even at same mtime/size');
  assert.equal(replaced.configSources.files.length, 2);
  assert.equal(replaced.configValidatedAt, new Date(now).toISOString());
  write(config, 1024);
  const launch = resolver.resolveRepoRuntimeEnv(repo, { ...env,
    UV_THREADPOOL_SIZE: '3', NODE_OPTIONS: '--max-old-space-size=384 --enable-source-maps' });
  assert.equal(launch.UV_THREADPOOL_SIZE, '3');
  assert.equal(launch.NODE_OPTIONS, '--max-old-space-size=384 --enable-source-maps');
  fs.writeFileSync(config, JSON.stringify({ runtime: { nodeOptions: '--trace-warnings' } }));
  now += 1000;
  assert.equal(resolver.getCachedRuntimeConfig(repo, {}).nodeOptions, '');
  assert.equal(resolver.getCachedRuntimeConfig(repo, {
    PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([repo])
  }).nodeOptions, '--trace-warnings', 'launch trust changes invalidate configuration immediately');
  console.log('service runtime config revalidation test passed');
} finally {
  Date.now = originalNow;
  fs.rmSync(temp, { recursive: true, force: true });
}
