import assert from 'node:assert/strict';
import { validateFileNameCollisions } from '../../../src/index/validate/checks.js';

const validate = rows => {
  const report = { issues: [], hints: [] };
  validateFileNameCollisions(report, 'code', rows);
  return report.issues;
};
const moduleRow = chunkUid => ({ file: 'dynamic.ts', name: '(module)', kind: 'Module', signature: null,
  startLine: 1, endLine: 1, ...(chunkUid ? { chunkUid } : {}) });

assert.deepEqual(validate([moduleRow('uid:first'), moduleRow('uid:second')]), [],
  'distinct same-line source chunks retain their published identities');
for (const rows of [
  [moduleRow('uid:first'), moduleRow('uid:first')],
  [moduleRow(), moduleRow()],
  [moduleRow(), moduleRow('uid:second')],
  [moduleRow('uid:first'), moduleRow()]
]) assert.ok(validate(rows).some(issue => issue.includes('ERR_ID_COLLISION')),
  'reused or missing source identity remains a collision');
