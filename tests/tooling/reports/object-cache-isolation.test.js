#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { writePersistentCommandProbeCache, readPersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-object-cache-isolation-'));
const repo = path.join(temp, 'repo');
const cache = path.join(repo, 'custom-cache');
await fs.mkdir(cache, { recursive: true });
await fs.writeFile(path.join(repo, 'source.js'), 'export function ownedCacheBoundary(value) { return value; }\n');
await fs.writeFile(path.join(cache, 'authored.js'), 'export function authoredCacheSibling(value) { return value; }\n');
const env = applyTestEnv({ cacheRoot: path.join(temp, 'cache'), embeddings: 'off', testConfig: {
  indexing: { scm: { provider: 'none' }, workerPool: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false,
    riskAnalysisCrossFile: false, embeddings: { enabled: false, mode: 'off' } },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
} });
const cli = args => {
  const result = runNode([path.join(root, 'bin/pairofcleats.js'), ...args], args.join(' '), repo, env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 12000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  return result;
};
const build = () => cli(['index', 'build', '--repo', repo, '--stage', 'stage1', '--mode', 'code', '--threads', '1']);
const count = () => JSON.parse(cli(['index', 'stats', '--repo', repo, '--mode', 'code', '--json']).stdout).modes.code.chunkMeta.rows;
try {
  build();
  const baseline = count();
  assert.equal(baseline, 2, 'two authored functions must be indexed');
  const probe = { providerId: 'fixture', command: process.execPath, args: ['--version'],
    toolingConfig: { cache: { dir: cache } }, successTtlMs: 60000 };
  assert.equal(writePersistentCommandProbeCache({ ...probe, attempted: [{ command: process.execPath, ok: true }] }), true);
  const probeDir = path.join(cache, 'command-probes');
  const files = await fs.readdir(probeDir);
  assert.equal(files.length, 1);
  await fs.copyFile(path.join(probeDir, files[0]), path.join(repo, 'renamed-probe-data.json'));
  assert.equal(readPersistentCommandProbeCache(probe)?.ok, true, 'stamped cache remains operational');
  build();
  assert.equal(count(), baseline, 'named and renamed cache output must not add chunks');
  build();
  assert.equal(count(), baseline, 'repeated incremental runs stay at a fixed point');
  console.log('Real command-probe output stays readable and does not feed named or renamed data into repeated builds.');
} finally { await fs.rm(temp, { recursive: true, force: true }); }
