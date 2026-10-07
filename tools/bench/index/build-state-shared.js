import fs from 'node:fs/promises';
import path from 'node:path';

import { initBuildState } from '../../../src/index/build/build-state.js';

export const prepareBuildStateBenchRun = async ({ benchRoot, label }) => {
  const runRoot = path.join(benchRoot, label);
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  await initBuildState({
    buildRoot: runRoot,
    buildId: `bench-${label}`,
    stage: 'bench',
    toolVersion: 'bench',
    signatureVersion: 1
  });
  return runRoot;
};
