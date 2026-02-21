#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { filterCoverageEntriesToChanged } from '../../../tools/testing/coverage/index.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const relPath = 'tests/runner/harness/coverage-changed-untracked-temp.generated.js';
const absPath = path.join(root, relPath);
await fsPromises.writeFile(absPath, 'export const x = 1;\n', 'utf8');

try {
  const filtered = filterCoverageEntriesToChanged({
    root,
    entries: [
      { path: relPath, coveredRanges: 1, totalRanges: 1 },
      { path: 'src/shared/files.js', coveredRanges: 1, totalRanges: 2 }
    ]
  });

  if (!filtered.some((entry) => entry.path === relPath)) {
    console.error('coverage changed untracked test failed: expected untracked path to be included');
    process.exit(1);
  }
} finally {
  await fsPromises.rm(absPath, { force: true });
}

console.log('coverage changed untracked test passed');
