import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'polyglot-pattern-'));
try {
  fs.mkdirSync(path.join(root,'tests'));
  for (const name of ['test_app.py','app_test.go','app.test.js','unrelated.py']) fs.writeFileSync(path.join(root,'tests',name), 'test');
  assert.throws(() => buildSuggestTestsReport({ changed: ['src/app.js'], repoRoot: root }), /requires indexSignature/);
  const build = testPatterns => buildSuggestTestsReport({ changed: ['src/app.js'], repoRoot: root, testPatterns,
    indexSignature: 'polyglot-pattern-fixture-v1' });
  assert.deepEqual(build(['**/test_*.py']).suggestions.map(row => row.testPath), ['tests/test_app.py']);
  assert.deepEqual(build(['**/*_test.go']).suggestions.map(row => row.testPath), ['tests/app_test.go']);
  assert.deepEqual(build(null).suggestions.map(row => row.testPath), ['tests/app.test.js']);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('explicit polyglot test patterns passed');
