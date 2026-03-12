#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, 'src', 'index', 'build', 'indexer', 'steps', 'process-files.js'),
  'utf8'
);

assert.match(
  source,
  /includeChurn:\s*scmSnapshotConfig\.includeChurn\s*===\s*true/,
  'expected SCM file-meta snapshot churn collection to remain opt-in'
);

console.log('scm file-meta snapshot churn opt-in contract test passed');
