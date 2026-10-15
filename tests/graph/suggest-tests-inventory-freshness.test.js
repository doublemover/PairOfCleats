import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';
import { buildRiskGuidance } from '../../src/context-pack/assemble/guidance.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-inventory-'));
const write = (relative) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'export const test = 1;');
};
try {
  write('tests/app.js'); write('__tests__/app.js'); write('nested/tests/app.js');
  write('custom/app.js'); write('app.test.js'); write('src/app.js');
  const build = (options = {}) => buildSuggestTestsReport({
    changed: ['src/app.js'], repoRoot: root, indexSignature: 'generation-1',
    ...options
  });
  const paths = build().suggestions.map((row) => row.testPath);
  for (const expected of ['tests/app.js', '__tests__/app.js', 'nested/tests/app.js', 'app.test.js']) {
    assert.ok(paths.includes(expected), expected);
  }
  assert.ok(!paths.includes('custom/app.js'));
  assert.deepEqual(build({ testPatterns: ['custom/**/*.js'] }).suggestions.map((row) => row.testPath), ['custom/app.js']);
  const cold = build({ caps: { maxCandidates: 1 } });
  const warm = build({ caps: { maxCandidates: 1 } });
  assert.deepEqual(warm.truncation, cold.truncation);
  assert.equal(warm.fidelity.graph.candidateTruncated, true);
  fs.unlinkSync(path.join(root, 'tests/app.js')); write('tests/app-new.js');
  const sameGeneration = build().suggestions.map((row) => row.testPath);
  assert.ok(!sameGeneration.includes('tests/app.js'));
  assert.ok(sameGeneration.includes('tests/app-new.js'));
  const refreshed = build({ indexSignature: 'generation-2' }).suggestions.map((row) => row.testPath);
  assert.ok(!refreshed.includes('tests/app.js'));
  assert.ok(refreshed.includes('tests/app-new.js'));
  const guidance = () => buildRiskGuidance({
    flows: [{ source: { chunkUid: 'app' } }], repoRoot: root, indexCompatKey: 'compat',
    indexSignature: 'generation-2', chunkIndex: {},
    graphIndex: { callGraphIndex: new Map([['app', { file: 'src/app.js' }]]) }
  });
  assert.ok(guidance().tests.some((row) => row.testPath === '__tests__/app.js'));
  fs.unlinkSync(path.join(root, '__tests__/app.js'));
  assert.ok(!guidance().tests.some((row) => row.testPath === '__tests__/app.js'));
  assert.ok(guidance().tests.some((row) => row.testPath === 'tests/app-new.js'));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('suggest tests inventory freshness and root paths test passed');
