#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const requestPathFiles = [
  'src/retrieval/cli/load-indexes.js',
  'src/retrieval/cli/run-search.js',
  'src/retrieval/cli/index-loader.js',
  'src/retrieval/cli/run-search-session.js'
];
const forbiddenPatterns = [
  'existsSync(',
  'readFileSync(',
  'statSync(',
  'loadJsonArrayArtifactSync('
];

for (const relPath of requestPathFiles) {
  const absPath = path.join(root, relPath);
  const contents = fs.readFileSync(absPath, 'utf8');
  for (const pattern of forbiddenPatterns) {
    assert.equal(
      contents.includes(pattern),
      false,
      `${relPath} should not use ${pattern} in request-time codepaths`
    );
  }
}

console.log('retrieval request-path no-sync fs contract test passed');
