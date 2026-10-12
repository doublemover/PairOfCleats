#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runNode } from '../../helpers/run-node.js';
import { getRepoCacheRoot } from '../../../src/shared/repo-paths.js';
const { dir } = await prepareIsolatedTestCacheDir('runtime-streamed-receipts');
const repo = path.join(dir, 'repo');
await fs.mkdir(repo);
await fs.writeFile(path.join(repo, 'tiny.js'), 'export const value = 1;\n');
const env = applyTestEnv({ cacheRoot: path.join(dir, 'cache'), embeddings: 'stub', testConfig: {
  threads: 1, sqlite: { use: false },
  indexing: { scm: { provider: 'none' }, workerPool: { enabled: false }, treeSitter: { enabled: false },
    typeInference: false, typeInferenceCrossFile: false, riskAnalysis: false, riskAnalysisCrossFile: false,
    embeddings: { hnsw: { enabled: false }, lancedb: { enabled: false } } },
  tooling: { autoEnableOnDetect: false, lsp: { enabled: false } }
} });
runNode([path.resolve('build_index.js'), '--repo', repo, '--mode', 'code', '--threads', '1', '--dims', '8', '--stub-embeddings', '--progress', 'off'], 'tiny streaming receipt fixture', process.cwd(), env, { stdio: 'pipe' });
const buildsRoot = path.join(getRepoCacheRoot(repo), 'builds');
const builds = (await fs.readdir(buildsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
assert.equal(builds.length, 1);
const buildRoot = path.join(buildsRoot, builds[0].name);
const state = JSON.parse(await fs.readFile(path.join(buildRoot, 'build_state.json')));
const parent = state.runtime.attempts.find((entry) => entry.stage === 'stage2');
const child = state.runtime.attempts.find((entry) => entry.stage === 'stage3');
assert.ok(parent);
assert.ok(child);
assert.equal(parent.lifecycle, 'succeeded');
assert.equal(child.lifecycle, 'succeeded');
assert.equal(child.parentAttemptId, parent.attemptId);
assert.equal(child.buildId, parent.buildId);
assert.notEqual(child.attemptId, parent.attemptId);
assert.notEqual(child.runtime.observed.processInstanceId, parent.runtime.observed.processInstanceId);
assert.equal(parent.embeddings.observation.state, 'not-started');
assert.equal(child.embeddings.observation.state, 'ready');
assert.equal(child.embeddings.observation.stub, true);
assert.equal(child.embeddings.observation.dims, 8);
assert.ok(child.inputs.resolvedPlanDigest);
const index = JSON.parse(await fs.readFile(path.join(buildRoot, 'index-code', 'index_state.json')));
assert.equal(index.extensions.runtimeAttemptId, child.attemptId);
console.log('streamed parent/child runtime receipts preserve generation and actual stub observations');
