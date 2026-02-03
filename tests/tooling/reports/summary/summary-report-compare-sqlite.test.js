#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureSummaryReportFixture } from './summary-report-helpers.js';

const root = process.cwd();
const modelId = 'Xenova/all-MiniLM-L12-v2';
const { tempRoot, cacheRoot, repoRoot } = await ensureSummaryReportFixture({ modelId });
const outPath = path.join(tempRoot, 'compare-sqlite.json');

await fsPromises.mkdir(path.dirname(outPath), { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'reports', 'compare-models.js'),
    '--repo',
    repoRoot,
    '--models',
    modelId,
    '--baseline',
    modelId,
    '--backend',
    'sqlite',
    '--no-build',
    '--no-ann',
    '--limit',
    '5',
    '--top',
    '3',
    '--mode',
    'both',
    '--cache-root',
    cacheRoot,
    '--out',
    outPath
  ],
  { env, encoding: 'utf8', cwd: repoRoot }
);

if (result.status !== 0) {
  console.error('summary report compare (sqlite) failed: script error.');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

if (!fs.existsSync(outPath)) {
  console.error('summary report compare (sqlite) failed: output JSON missing.');
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
if (!payload.summary || !payload.results) {
  console.error('summary report compare (sqlite) failed: missing summary fields.');
  process.exit(1);
}

console.log('summary report compare (sqlite) test passed');
