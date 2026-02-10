#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { repoRoot } from '../../helpers/root.js';

applyTestEnv();

const root = repoRoot();
const hotFiles = [
  'src/index/build/artifacts/file-meta.js',
  'src/index/build/artifacts/token-postings.js',
  'src/index/build/vfs-manifest-collector.js',
  'src/retrieval/pipeline/candidates.js',
  'src/graph/neighborhood.js'
];

const membershipPattern = /\.(includes|indexOf)\s*\(/;
const loopPattern = /\b(for|while)\s*\(/;
const allowPattern = /hotpath-membership-allow/;

const violations = [];

for (const relPath of hotFiles) {
  const fullPath = path.join(root, relPath);
  const text = fs.readFileSync(fullPath, 'utf8');
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!membershipPattern.test(line) || allowPattern.test(line)) continue;
    const start = Math.max(0, i - 5);
    const context = lines.slice(start, i + 1);
    if (context.some((entry) => loopPattern.test(entry))) {
      violations.push(`${relPath}:${i + 1}`);
    }
  }
}

assert.equal(
  violations.length,
  0,
  `hotpath membership guard failed; list-membership in/near loops:\n${violations.join('\n')}`
);

console.log('hotpath membership guard test passed');
