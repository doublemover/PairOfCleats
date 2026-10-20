import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getTriageContext, runJson } from '../../helpers/triage.js';
import { normalizeGeneric } from '../../../src/integrations/triage/normalize/generic.js';
import { buildRecordId } from '../../../src/integrations/triage/record-utils.js';

const { root, repoRoot, cacheRoot, env } = await getTriageContext({ name: 'triage-fallback-identity' });
const input = path.join(cacheRoot, 'input.json');
const ingest = async records => {
  await fs.writeFile(input, JSON.stringify(records));
  return runJson('full fallback identities', [path.join(root, 'tools/triage/ingest.js'),
    '--source', 'generic', '--in', input, '--repo', repoRoot], { env });
};
const prefix = 'same Unicode prefix 😀漢字 '.repeat(900);
const a = { source: 'generic', recordType: 'finding', title: 'Long finding', description: prefix, tail: 'A' };
const b = { ...a, tail: 'B' };
assert.ok(Buffer.byteLength(JSON.stringify(a)) > 16384);
assert.equal(Buffer.byteLength(JSON.stringify(a)), Buffer.byteLength(JSON.stringify(b)));
assert.equal(JSON.stringify(a).slice(0, 17000), JSON.stringify(b).slice(0, 17000));
const imported = await ingest([a, b]);
assert.equal(imported.errors, 0);
assert.equal(imported.written, 2);
assert.equal(new Set(imported.recordIds).size, 2, 'full admitted suffix must contribute to identity');
for (const [index, raw] of [a, b].entries()) {
  assert.equal(imported.recordIds[index], buildRecordId('generic', JSON.stringify(raw)), 'fallback policy hashes full JSON serialization in field order');
  const stored = JSON.parse(await fs.readFile(imported.records[index].jsonPath, 'utf8'));
  assert.equal(stored.tail, raw.tail);
  assert.equal(stored.description, prefix, 'raw description remains intact');
  assert.equal(stored.vuln.description, prefix.trim(), 'normalized descriptions retain the existing whitespace policy');
  assert.equal(stored.idProvenance.method, 'fallback-hash');
  assert.equal(stored.idProvenance.stability, 'lower-trust');
  assert.ok(stored.parseWarnings.includes('missing stable key; using raw payload hash'));
}
const repeated = await ingest([a]);
assert.deepEqual(repeated.recordIds, [imported.recordIds[0]], 'exact reimports are stable despite generated timestamps');
assert.equal(repeated.errors, 0);
const reordered = Object.fromEntries(Object.entries(a).reverse());
assert.notEqual(normalizeGeneric(reordered).recordId, normalizeGeneric(a).recordId, 'declared fallback policy preserves JSON field order');
const explicit = normalizeGeneric({ ...a, recordId: 'explicit-id' });
assert.equal(explicit.recordId, 'explicit-id');
assert.equal(explicit.idProvenance.stability, 'stable');
assert.equal(normalizeGeneric({ ...a, stableKey: 'owner-key' }).recordId, buildRecordId('generic', 'owner-key'));
const identities = await ingest([reordered, { ...a, recordId: 'explicit-id' }, { ...a, stableKey: 'owner-key' }]);
assert.equal(identities.written, 3);
assert.equal(identities.errors, 0);
assert.deepEqual(identities.recordIds, [normalizeGeneric(reordered).recordId, 'explicit-id', buildRecordId('generic', 'owner-key')]);
for (const artifact of identities.records) assert.equal(JSON.parse(await fs.readFile(artifact.jsonPath, 'utf8')).recordId, artifact.recordId);
const cyclic = { title: 'not admitted JSON' }; cyclic.self = cyclic;
assert.throws(() => normalizeGeneric(cyclic), { code: 'ERR_TRIAGE_RECORD_IDENTITY' });

// Simulate an existing conflicting artifact at the derived path, independently
// of the now-fixed truncated identity, and prove it cannot be overwritten.
const jsonPath = imported.records[0].jsonPath;
const tampered = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
tampered.tail = 'conflicting persisted bytes';
const before = JSON.stringify(tampered);
await fs.writeFile(jsonPath, before);
const mdBefore = await fs.readFile(imported.records[0].mdPath, 'utf8');
const conflict = await ingest([a]);
assert.equal(conflict.written, 0);
assert.equal(conflict.errors, 1);
assert.match(conflict.errorDetails[0].message, /derived.*identity.*conflict/i);
assert.equal(await fs.readFile(jsonPath, 'utf8'), before);
assert.equal(await fs.readFile(imported.records[0].mdPath, 'utf8'), mdBefore);
console.log('Full Unicode fallback payloads retain distinct artifacts, repeatable IDs and conflict protection');
