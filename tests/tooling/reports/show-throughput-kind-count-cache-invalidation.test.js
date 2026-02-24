#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readRepoMapKindCountsSync } from '../../../tools/reports/show-throughput/analysis.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'show-throughput-kind-cache-'));
const repoMapPath = path.join(tempRoot, 'repo_map.json');
const marker = '"kind":"functiondeclaration"';

try {
  await fs.writeFile(repoMapPath, marker, 'utf8');
  const firstCounts = readRepoMapKindCountsSync(repoMapPath) || {};
  assert.equal(firstCounts.functiondeclaration, 1, 'expected initial kind count to be 1');

  await fs.writeFile(repoMapPath, `${marker}${marker}`, 'utf8');
  const now = new Date();
  await fs.utimes(repoMapPath, now, now);

  const secondCounts = readRepoMapKindCountsSync(repoMapPath) || {};
  assert.equal(secondCounts.functiondeclaration, 2, 'expected cached kind counts to invalidate after file changes');

  console.log('show-throughput kind count cache invalidation test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
