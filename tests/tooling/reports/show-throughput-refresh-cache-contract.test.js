#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getMetricsDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadFeatureMetricsCached } from '../../../tools/reports/show-throughput/load.js';
import {
  loadOrComputeBenchAnalysis,
  loadOrComputeIndexingSummary,
  readRepoMapKindCountsSync,
  resolveRepoHistoryKey,
  resolveRepoIdentity
} from '../../../tools/reports/show-throughput/analysis.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toPosix = (value) => String(value || '').replace(/[\\/]+/g, '/');

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'show-throughput-refresh-cache-'));

try {
  const repoRoot = path.join(tempRoot, 'project-alpha');
  const cacheRoot = path.join(tempRoot, 'cache');
  await fsPromises.mkdir(repoRoot, { recursive: true });
  await fsPromises.mkdir(cacheRoot, { recursive: true });
  await fsPromises.writeFile(
    path.join(repoRoot, '.pairofcleats.json'),
    JSON.stringify({ cache: { root: cacheRoot } }, null, 2)
  );

  const userConfig = loadUserConfig(repoRoot);
  const metricsDir = getMetricsDir(repoRoot, userConfig);
  await fsPromises.mkdir(metricsDir, { recursive: true });
  const metricsPath = path.join(metricsDir, 'feature-metrics-run.json');

  await fsPromises.writeFile(
    metricsPath,
    JSON.stringify({
      modes: {
        code: {
          totals: { count: 1, lines: 10, bytes: 100, durationMs: 1000 }
        }
      }
    }, null, 2)
  );
  const firstMetrics = loadFeatureMetricsCached(repoRoot);
  assert.equal(firstMetrics?.modes?.code?.totals?.lines, 10);

  await sleep(25);
  await fsPromises.writeFile(
    metricsPath,
    JSON.stringify({
      modes: {
        code: {
          totals: { count: 1, lines: 25, bytes: 250, durationMs: 1000 }
        }
      }
    }, null, 2)
  );
  const secondMetrics = loadFeatureMetricsCached(repoRoot);
  assert.equal(
    secondMetrics?.modes?.code?.totals?.lines,
    25,
    'expected metrics cache to refresh after source file changes'
  );

  const repoMapPath = path.join(tempRoot, 'repo_map.json');
  await fsPromises.writeFile(repoMapPath, '{"kind":"functiondeclaration"}\n');
  const firstCounts = readRepoMapKindCountsSync(repoMapPath);
  assert.equal(firstCounts?.functiondeclaration, 1);

  await sleep(25);
  await fsPromises.writeFile(
    repoMapPath,
    '{"kind":"functiondeclaration"}\n{"kind":"functiondeclaration"}\n'
  );
  const secondCounts = readRepoMapKindCountsSync(repoMapPath);
  assert.equal(
    secondCounts?.functiondeclaration,
    2,
    'expected repo_map kind-count cache to invalidate after file changes'
  );

  const indexingPayload = {
    artifacts: {
      throughput: {
        code: { files: 1, bytes: 128, totalMs: 1000 },
        prose: { files: 0, bytes: 0, totalMs: 0 },
        extractedProse: { files: 0, bytes: 0, totalMs: 0 },
        records: { files: 0, bytes: 0, totalMs: 0 }
      }
    }
  };
  const firstIndexing = loadOrComputeIndexingSummary({
    payload: indexingPayload,
    featureMetrics: null,
    refreshJson: true
  });
  assert.equal(firstIndexing.changed, true);
  assert.equal(indexingPayload.artifacts.indexing?.modes?.code?.files, 1);

  indexingPayload.artifacts.throughput.code.files = 3;
  const refreshedIndexing = loadOrComputeIndexingSummary({
    payload: indexingPayload,
    featureMetrics: null,
    refreshJson: true
  });
  assert.equal(refreshedIndexing.changed, true);
  assert.equal(
    indexingPayload.artifacts.indexing?.modes?.code?.files,
    3,
    'expected refreshJson to recompute indexing summary even when cached summary is valid'
  );

  const buildA = path.join(cacheRoot, 'builds', 'build-a');
  const buildZ = path.join(cacheRoot, 'builds', 'build-z');
  await fsPromises.mkdir(buildA, { recursive: true });
  await fsPromises.mkdir(buildZ, { recursive: true });
  await fsPromises.writeFile(
    path.join(cacheRoot, 'builds', 'current.json'),
    JSON.stringify({ buildId: 'build-a' }, null, 2)
  );

  const writeBuildState = async (buildRoot, repoMapCount) => {
    await fsPromises.writeFile(
      path.join(buildRoot, 'build_state.json'),
      JSON.stringify({
        orderingLedger: {
          stages: {
            'stage2:code': {
              artifacts: {
                repo_map: { count: repoMapCount },
                file_relations: { count: 1 },
                graph_relations: { count: 1 }
              }
            }
          }
        },
        counts: {
          code: { files: 1, chunks: 1 }
        }
      }, null, 2)
    );
  };
  await writeBuildState(buildA, 2);
  await writeBuildState(buildZ, 9);

  const benchPayload = {
    artifacts: {
      repo: { cacheRoot },
      analysis: {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        buildRoot: buildZ,
        modes: {},
        totals: { symbols: 999, classes: 0, functions: 0, imports: 0, fileLinks: 0, graphLinks: 0 }
      }
    }
  };
  const refreshedBench = loadOrComputeBenchAnalysis({
    payload: benchPayload,
    featureMetrics: null,
    indexingSummary: null,
    refreshJson: true,
    deepAnalysis: false
  });
  assert.equal(refreshedBench.changed, true);
  assert.equal(
    toPosix(refreshedBench.analysis?.buildRoot),
    toPosix(buildA),
    'expected build-root resolution to prefer current build pointer over directory sort order'
  );
  assert.equal(
    refreshedBench.analysis?.totals?.symbols,
    2,
    'expected refreshJson to recompute analysis even when existing analysis is valid'
  );

  const repoAliasPath = path.join(repoRoot, '..', path.basename(repoRoot));
  assert.equal(
    resolveRepoIdentity({
      payload: { repo: { root: repoAliasPath } },
      file: 'fallback.json'
    }),
    path.basename(repoRoot)
  );
  const expectedHistoryKey = toPosix(fs.realpathSync.native(repoRoot));
  const actualHistoryKey = toPosix(resolveRepoHistoryKey({
    payload: { repo: { root: repoAliasPath } },
    file: 'fallback.json'
  }));
  if (process.platform === 'win32') {
    assert.equal(actualHistoryKey.toLowerCase(), expectedHistoryKey.toLowerCase());
  } else {
    assert.equal(actualHistoryKey, expectedHistoryKey);
  }

  console.log('show-throughput refresh/cache contract test passed');
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}
