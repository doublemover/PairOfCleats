#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fdir } from 'fdir';

import { discoverFiles } from '../../../src/index/build/discover.js';
import { buildIgnoreMatcher } from '../../../src/index/build/ignore.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'discover-max-files-fdir-no-raw-cap');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
for (let i = 0; i < 12; i += 1) {
  await fs.writeFile(path.join(tempRoot, 'src', `file-${String(i).padStart(2, '0')}.js`), `export const v${i} = ${i};\n`);
}

const { ignoreMatcher } = await buildIgnoreMatcher({ root: tempRoot, userConfig: {} });
const originalWithMaxFiles = fdir.prototype.withMaxFiles;
let withMaxFilesCalls = 0;
fdir.prototype.withMaxFiles = function patchedWithMaxFiles(...args) {
  withMaxFilesCalls += 1;
  return originalWithMaxFiles.apply(this, args);
};

try {
  await discoverFiles({
    root: tempRoot,
    mode: 'code',
    scmProvider: null,
    scmProviderImpl: null,
    scmRepoRoot: null,
    ignoreMatcher,
    skippedFiles: [],
    maxFileBytes: null,
    maxFiles: 1
  });
} finally {
  fdir.prototype.withMaxFiles = originalWithMaxFiles;
}

assert.equal(
  withMaxFilesCalls,
  0,
  'maxFiles discovery should not impose a raw fdir candidate cap'
);

console.log('discover maxFiles fdir no raw cap test passed');
