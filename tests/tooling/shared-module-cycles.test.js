#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { findSharedModuleCycles } from '../../tools/testing/shared-module-cycles.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-module-cycles-'));

try {
  const sharedRoot = path.join(tempRoot, 'src', 'shared');
  await fs.mkdir(sharedRoot, { recursive: true });
  await fs.writeFile(path.join(sharedRoot, 'alpha.js'), "import './beta.js';\nexport const alpha = true;\n", 'utf8');
  await fs.writeFile(path.join(sharedRoot, 'beta.js'), "import './alpha.js';\nexport const beta = true;\n", 'utf8');
  await fs.writeFile(path.join(sharedRoot, 'gamma.js'), "export const gamma = true;\n", 'utf8');

  const report = await findSharedModuleCycles({
    root: tempRoot,
    roots: ['src/shared']
  });

  assert.equal(report.fileCount, 3);
  assert.equal(report.cycleCount, 1, 'expected one synthetic cycle');
  assert.deepEqual(report.cycles[0].nodes, ['src/shared/alpha.js', 'src/shared/beta.js']);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('shared module cycles test passed');
