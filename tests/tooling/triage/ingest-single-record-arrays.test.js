import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getTriageContext } from '../../helpers/triage.js';
import { runNode } from '../../helpers/run-node.js';

const { root, repoRoot, cacheRoot, env } = await getTriageContext({ name: 'triage-single-record-arrays' });
const input = path.join(cacheRoot, 'input.json');
const run = async payload => {
  await fs.writeFile(input, JSON.stringify(payload));
  return runNode([path.join(root, 'tools/triage/ingest.js'), '--source', 'generic', '--in', input, '--repo', repoRoot],
    'single record array admission', root, env, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
};
const record = { source: 'generic', recordType: 'finding', stableKey: 'one-with-arrays', title: 'Example finding',
  references: ['https://example.invalid/a', 'https://example.invalid/b'], cwes: ['CWE-79'], tags: ['fixture'],
  items: ['record-owned array, not a wrapper'] };
for (const payload of [record, [record], { records: [record] },
  { title: 'Export report metadata', description: 'wrapper description', records: [record] },
  { findings: [record], metadata: ['ignored'] }, { legacy: [record] }]) {
  const result = await run(payload);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.total, 1, 'record-owned arrays cannot become the input collection');
  assert.equal(receipt.written, 1);
  assert.equal(receipt.errors, 0);
  const stored = JSON.parse(await fs.readFile(receipt.records[0].jsonPath, 'utf8'));
  assert.equal(stored.stableKey, record.stableKey);
  assert.equal(stored.source, 'generic');
  assert.equal(stored.recordType, 'finding');
  assert.equal(stored.vuln.title, record.title);
  assert.deepEqual(stored.vuln.references, record.references);
  assert.deepEqual(stored.vuln.cwe, record.cwes);
  assert.deepEqual(stored.tags, record.tags);
  assert.deepEqual(stored.items, record.items);
}
const ambiguous = await run({ first: [record], second: [{ ...record, stableKey: 'other' }] });
assert.equal(ambiguous.status, 1);
assert.match(ambiguous.stderr, /ambiguous/i);
const primitives = await run(['https://example.invalid/a', null, 42, []]);
assert.equal(primitives.status, 0, 'per-entry errors retain the existing permissive ingest exit contract');
const rejected = JSON.parse(primitives.stdout);
assert.equal(rejected.written, 0);
assert.equal(rejected.errors, 4);
assert.ok(rejected.errorDetails.every(error => /object/i.test(error.message)));
const primitiveRoot = await run(null);
assert.equal(primitiveRoot.status, 1);
assert.match(primitiveRoot.stderr, /object|array/i);
console.log('Single generic records keep arrays; wrappers remain compatible and primitive records are rejected');
