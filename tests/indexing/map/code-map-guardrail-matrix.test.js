#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();

const createLargeMapFixture = async ({ tempName, functionCount }) => {
  const tempRoot = resolveTestCachePath(root, tempName);
  const repoRoot = path.join(tempRoot, 'repo');
  const cacheRoot = path.join(tempRoot, 'cache');

  await fsPromises.rm(tempRoot, { recursive: true, force: true });
  await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });

  const funcs = [];
  for (let index = 0; index < functionCount; index += 1) {
    funcs.push(`export function fn${index}() { return ${index}; }`);
  }
  await fsPromises.writeFile(path.join(repoRoot, 'src', 'many.js'), funcs.join('\n'));

  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: {
      indexing: {
        scm: { provider: 'none' },
        typeInference: false,
        typeInferenceCrossFile: false,
        riskAnalysis: false,
        riskAnalysisCrossFile: false
      },
      tooling: {
        autoEnableOnDetect: false,
        lsp: {
          enabled: false
        }
      }
    },
    extraEnv: {
      PAIROFCLEATS_WORKER_POOL: 'off'
    }
  });

  const buildResult = runNode(
    [
      path.join(root, 'build_index.js'),
      '--stub-embeddings',
      '--stage',
      'stage1',
      '--mode',
      'code',
      '--scm-provider',
      'none',
      '--repo',
      repoRoot
    ],
    'build code-map guardrail fixture',
    repoRoot,
    env,
    { stdio: 'inherit', allowFailure: true }
  );
  assert.equal(buildResult.status, 0, 'expected code-map guardrail fixture build to succeed');

  return { repoRoot, env };
};

const cases = [
  {
    name: 'map guardrails truncate oversized outputs and record dropped members',
    async run() {
      const { repoRoot, env } = await createLargeMapFixture({
        tempName: 'code-map-guardrails-matrix-guardrails',
        functionCount: 120
      });
      const mapResult = runNode(
        [
          path.join(root, 'tools', 'reports/report-code-map.js'),
          '--format',
          'json',
          '--repo',
          repoRoot,
          '--max-members-per-file',
          '5',
          '--max-files',
          '1',
          '--max-edges',
          '2'
        ],
        'report-code-map guardrail truncation',
        repoRoot,
        env,
        { stdio: 'pipe', allowFailure: true }
      );
      assert.equal(mapResult.status, 0);
      const payload = JSON.parse(mapResult.stdout || '{}');
      const summary = payload.summary || {};
      const dropped = summary.dropped || {};
      assert.equal(summary.truncated, true);
      assert.equal((dropped.members || 0) >= 1, true);
    }
  },
  {
    name: 'map generation stays within the configured performance budget',
    async run() {
      const { repoRoot, env } = await createLargeMapFixture({
        tempName: 'code-map-guardrails-matrix-performance',
        functionCount: 180
      });
      const budgetMs = Number(process.env.PAIROFCLEATS_TEST_CODE_MAP_BUDGET_MS);
      const maxMs = Number.isFinite(budgetMs) ? budgetMs : 8000;
      const startedAt = performance.now();
      const mapResult = runNode(
        [path.join(root, 'tools', 'reports/report-code-map.js'), '--format', 'json', '--repo', repoRoot],
        'report-code-map performance budget',
        repoRoot,
        env,
        { stdio: 'pipe', allowFailure: true }
      );
      const elapsedMs = performance.now() - startedAt;
      assert.equal(mapResult.status, 0);
      assert.doesNotThrow(() => JSON.parse(mapResult.stdout || '{}'));
      assert.equal(elapsedMs <= maxMs, true, `expected ${Math.round(elapsedMs)}ms <= ${maxMs}ms`);
    }
  }
];

for (const entry of cases) {
  await entry.run();
}

console.log('code map guardrail matrix test passed');
