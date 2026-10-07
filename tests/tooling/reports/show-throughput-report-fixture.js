import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const showThroughputEnv = applyTestEnv({ syncProcess: false });

export const createShowThroughputTempRoot = (prefix) => fs.mkdtemp(path.join(os.tmpdir(), prefix));

export const createShowThroughputPayload = ({
  repoRoot,
  chunksPerSec,
  buildIndexMs = 100
}) => ({
  generatedAt: '2026-03-21T00:00:00.000Z',
  repo: { root: repoRoot },
  summary: {
    buildMs: { index: buildIndexMs, sqlite: 40 },
    queryWallMsPerQuery: 10,
    queryWallMsPerSearch: 20,
    latencyMs: { memory: { mean: 2, p95: 4 } }
  },
  artifacts: {
    throughput: {
      code: {
        files: 10,
        chunks: chunksPerSec * 10,
        tokens: 1000,
        bytes: 10000,
        totalMs: 10000,
        filesPerSec: 5,
        chunksPerSec,
        tokensPerSec: 100,
        bytesPerSec: 1000
      }
    }
  }
});

export const writeShowThroughputPayload = async (
  resultsRoot,
  {
    folder,
    repoName,
    chunksPerSec,
    buildIndexMs = 100,
    repoRoot = `C:/repo/${repoName}`
  }
) => {
  const dir = path.join(resultsRoot, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${repoName}.json`),
    JSON.stringify(createShowThroughputPayload({ repoRoot, chunksPerSec, buildIndexMs }), null, 2),
    'utf8'
  );
  return resultsRoot;
};

export const runShowThroughputReport = (args = [], {
  cwd = process.cwd(),
  allowFailure = false
} = {}) => runNode(
  [path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js'), ...args],
  'show throughput report',
  cwd,
  showThroughputEnv,
  {
    stdio: 'pipe',
    allowFailure
  }
);
