#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readRepoMapKindCountsSync } from '../../../tools/reports/show-throughput/analysis.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'show-throughput-kind-counts-'));
const repoMapPath = path.join(tempRoot, 'repo_map.json');
const oneMiB = 1024 * 1024;
const marker = '"kind":"functiondeclaration"';
const nearBoundaryPadding = Math.max(0, oneMiB - marker.length - 128);
const body = `${'x'.repeat(nearBoundaryPadding)}${marker}${'y'.repeat(512)}${marker}${'z'.repeat(32)}`;

try {
  await fs.writeFile(repoMapPath, body, 'utf8');
  const counts = readRepoMapKindCountsSync(repoMapPath) || {};
  assert.equal(
    counts.functiondeclaration,
    2,
    'stream parser should not double-count kinds from overlap tail bytes'
  );
  console.log('show-throughput kind counts streaming test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
