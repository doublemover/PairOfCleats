#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const fixtureDir = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'perl-reset-regression');

const script = `
import fs from 'node:fs';
import path from 'node:path';
import { buildTreeSitterChunks } from './src/lang/tree-sitter/chunking.js';

const fixtureDir = ${JSON.stringify(fixtureDir)};
const files = [
  path.join(fixtureDir, '03_pragmas.t'),
  path.join(fixtureDir, '05_utils_pod.t')
];

for (const filePath of files) {
  const text = fs.readFileSync(filePath, 'utf8');
  const chunks = buildTreeSitterChunks({
    text,
    languageId: 'perl',
    ext: '.t',
    options: {
      treeSitter: {
        enabled: true,
        strict: true,
        nativeOnly: true,
        worker: { enabled: false }
      }
    }
  });
  if (!Array.isArray(chunks) || chunks.length <= 0) {
    throw new Error('expected perl chunks for ' + filePath);
  }
}

console.log('perl-native-reset-ok');
`;

const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
  cwd: root,
  env: { ...process.env, PAIROFCLEATS_TESTING: '1' },
  encoding: 'utf8'
});

assert.equal(
  result.status,
  0,
  [
    `expected perl tree-sitter reset path to exit cleanly; status=${String(result.status)} signal=${String(result.signal)}`,
    String(result.stdout || '').trim(),
    String(result.stderr || '').trim()
  ].join('\n')
);
assert.match(String(result.stdout || ''), /perl-native-reset-ok/);

console.log('tree-sitter perl native reset regression test passed');
