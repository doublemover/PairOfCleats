import path from 'node:path';
import { toPosix } from '../../src/shared/files.js';
import { assignLane } from '../runner/run-discovery.js';
import { loadRunRules } from '../runner/run-config.js';

export const resolveCurrentTestLane = ({ repoRoot, testFilePath, fallbackLane = 'ci' } = {}) => {
  const runRules = loadRunRules({ root: repoRoot });
  const knownLanes = Array.from(runRules.knownLanes || []);
  if (!repoRoot || !testFilePath) {
    if (knownLanes.includes(fallbackLane)) return fallbackLane;
    return knownLanes[0] || fallbackLane;
  }

  const testsRoot = path.join(repoRoot, 'tests');
  const relPath = toPosix(path.relative(testsRoot, testFilePath));
  const testId = relPath.endsWith('.test.js')
    ? relPath.slice(0, -'.test.js'.length)
    : relPath;
  const lane = assignLane(testId, runRules.laneRules);
  if (lane && knownLanes.includes(lane)) return lane;
  if (knownLanes.includes(fallbackLane)) return fallbackLane;
  return knownLanes[0] || fallbackLane;
};

