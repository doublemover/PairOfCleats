import fs from 'node:fs';
import path from 'node:path';

import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import {
  buildBenchRuntimeLiveCanarySummary,
  loadBenchRuntimeCanaryManifest,
  runBenchRuntimeLiveCanary
} from '../../../tools/bench/language/canaries.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';

export const createCleanSdkBenchmarkReport = () => buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: '/tmp/results',
  runLabel: 'bench-language small',
  config: {
    python: { label: 'Python' }
  },
  results: [
    {
      language: 'python',
      tier: 'medium',
      repo: 'basedosdados/sdk',
      summary: {
        backends: ['memory'],
        latencyMsAvg: { memory: 4 },
        hitRate: { memory: 1 },
        resultCountAvg: { memory: 3 },
        memoryRss: { memory: { mean: 1024 } },
        buildMs: { index: 50 }
      }
    }
  ]
});

export const createBenchRuntimeCanaryTargetEntry = async (root = process.cwd()) => {
  const { manifest } = await loadBenchRuntimeCanaryManifest(root);
  const sdkEntry = manifest.liveCanaries.find((entry) => entry.id === 'sdk-artifact-tail-live');
  return {
    sdkEntry,
    targetEntry: sdkEntry
      ? {
          ...sdkEntry,
          runner: {
            ...sdkEntry.runner,
            args: [
              '--fixture',
              'sdk-artifact-tail-live-target',
              '--out',
              '{outJson}'
            ]
          }
        }
      : null
  };
};

export const runSdkTargetLiveCanary = async (root = process.cwd()) => {
  const { sdkEntry, targetEntry } = await createBenchRuntimeCanaryTargetEntry(root);
  return {
    sdkEntry,
    targetEntry,
    targetResult: targetEntry ? await runBenchRuntimeLiveCanary(targetEntry, root) : null
  };
};

export const writeSdkTargetLiveSummary = async ({
  cacheName,
  root = process.cwd(),
  requireTarget = true
}) => {
  const { dir: outDir } = await prepareTestCacheDir(cacheName);
  const liveSummaryPath = path.join(outDir, 'live-summary.json');
  const { sdkEntry, targetEntry, targetResult } = await runSdkTargetLiveCanary(root);
  const liveSummary = buildBenchRuntimeLiveCanarySummary([targetResult], { requireTarget });
  fs.writeFileSync(liveSummaryPath, `${JSON.stringify(liveSummary, null, 2)}\n`);

  return {
    liveSummary,
    liveSummaryPath,
    outDir,
    sdkEntry,
    targetEntry,
    targetResult
  };
};
