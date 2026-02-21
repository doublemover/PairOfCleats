#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { collectV8CoverageEntries } from '../../../tools/testing/coverage/index.js';
import { repoRoot } from '../../helpers/root.js';

const ROOT = repoRoot();
const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-coverage-paths-'));
const absA = path.join(ROOT, 'src', 'shared', 'a.js');
const absB = path.join(ROOT, 'src', 'shared', 'b.js');

const payloadA = {
  result: [
    {
      url: pathToFileURL(absB).href,
      functions: [{ ranges: [{ count: 1 }, { count: 0 }] }]
    }
  ]
};
const payloadB = {
  result: [
    {
      url: absA,
      functions: [{ ranges: [{ count: 2 }] }]
    }
  ]
};

await fsPromises.writeFile(path.join(tempDir, 'z.json'), JSON.stringify(payloadA), 'utf8');
await fsPromises.writeFile(path.join(tempDir, 'a.json'), JSON.stringify(payloadB), 'utf8');

const entries = await collectV8CoverageEntries({ root: ROOT, coverageDir: tempDir });

if (entries.length !== 2) {
  console.error('coverage path normalization test failed: expected two entries');
  process.exit(1);
}
if (entries[0].path !== 'src/shared/a.js' || entries[1].path !== 'src/shared/b.js') {
  console.error('coverage path normalization test failed: expected repo-relative POSIX sorted paths');
  process.exit(1);
}
if (entries.some((entry) => entry.path.includes('\\'))) {
  console.error('coverage path normalization test failed: unexpected backslashes');
  process.exit(1);
}

console.log('coverage path normalization test passed');
