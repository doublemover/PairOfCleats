import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEmptyModeProfile } from '../../../tools/index/report-artifacts/scan-profile.js';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const showThroughputEnv = applyTestEnv({ syncProcess: false });

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const SHOW_THROUGHPUT_SCRIPT = path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js');

export const emptyScanProfileMode = createEmptyModeProfile;

export const runShowThroughputFixture = async ({
  payload,
  tempPrefix,
  resultsFolder = 'mixed',
  fixtureName = 'fixture.json'
}) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));

  try {
    const runRoot = path.join(tempRoot, 'workspace');
    const resultsDir = path.join(runRoot, 'benchmarks', 'results', resultsFolder);
    await fs.mkdir(resultsDir, { recursive: true });
    await fs.writeFile(path.join(resultsDir, fixtureName), JSON.stringify(payload, null, 2));

    const result = runNode(
      [SHOW_THROUGHPUT_SCRIPT],
      'show throughput scan fixture',
      runRoot,
      showThroughputEnv,
      { stdio: 'pipe' }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(String(result.stderr || '').trim(), '', 'expected overview text on stdout only');

    return {
      result,
      output: String(result.stdout || '').replace(ANSI_PATTERN, '')
    };
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
};
