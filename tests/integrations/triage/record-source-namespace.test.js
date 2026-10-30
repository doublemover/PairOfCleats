#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { createRecordSourceReference, createRecordSourceUnion, readRecordEmbeddingSource } from '../../../src/integrations/triage/record-source.js';
import { sha1 } from '../../../src/shared/hash.js';

const { dir } = await prepareIsolatedTestCacheDir('record-source-namespace');
const repoRoot = path.join(dir, 'repo'), recordsDir = path.join(dir, 'external');
const repoFile = path.join(repoRoot, 'triage', 'records', 'incident.md'), triageFile = path.join(recordsDir, 'incident.md');
await fs.mkdir(path.dirname(repoFile), { recursive: true }); await fs.mkdir(recordsDir);
await fs.writeFile(repoFile, 'repository source'); await fs.writeFile(triageFile, 'external source');
const repositoryEntry = { abs: repoFile, record: { source: 'repo', recordType: 'record' } };
const union = reversed => {
  const owner = createRecordSourceUnion({ repoRoot, recordsDir });
  if (reversed) { owner.addTriage(triageFile); owner.addRepository(repositoryEntry); }
  else { owner.addRepository(repositoryEntry); owner.addTriage(triageFile); }
  return owner.finish();
};
const sources = union(false);
assert.deepEqual(union(true), sources);
assert.equal(sources.length, 2);
assert.equal(new Set(sources.map(row => row.recordSource.storagePath)).size, 2);
assert.equal(new Set(sources.map(row => row.recordSource.rootKey)).size, 2);
assert.equal(sources[0].recordSource.displayPath, 'triage/records/incident.md');
assert.equal(sources[1].recordSource.displayPath, 'triage/records/incident.md');
const bound = sources.map(row => ({ ...row.recordSource,
  contentHash: sha1(Buffer.from(row.recordSource.kind === 'triage' ? 'external source' : 'repository source')) }));
for (const reference of bound) {
  const result = await readRecordEmbeddingSource({ repoRoot, recordsDir, file: reference.storagePath,
    items: [{ chunk: { recordSource: reference, fileHash: reference.contentHash } }] });
  assert.equal(result.text, reference.kind === 'triage' ? 'external source' : 'repository source');
}
const external = bound.find(row => row.kind === 'triage');
const readExternal = overrides => readRecordEmbeddingSource({ repoRoot, recordsDir, file: external.storagePath,
  items: [{ chunk: { recordSource: external, fileHash: external.contentHash } }], ...overrides });
await assert.rejects(readExternal({ recordsDir: path.join(dir, 'different-root') }), { code: 'ERR_RECORD_SOURCE_REBUILD' });
await assert.rejects(readExternal({ repoRoot: path.join(dir, 'other-repo') }), { code: 'ERR_RECORD_SOURCE_REBUILD' });
await fs.writeFile(triageFile, 'changed external source');
await assert.rejects(readExternal(), { code: 'ERR_RECORD_SOURCE_REBUILD' });
await fs.rm(triageFile);
await assert.rejects(readExternal(), { code: 'ENOENT' }, 'must not fall back to same-path repository bytes');
await fs.writeFile(triageFile, 'repository source');
const equal = { ...external, contentHash: sha1(Buffer.from('repository source')) };
assert.notEqual(equal.storagePath, bound.find(row => row.kind === 'repository').storagePath,
  'equal bytes cannot merge different admitted roots');
const inside = createRecordSourceUnion({ repoRoot, recordsDir: path.dirname(repoFile) });
inside.addRepository(repositoryEntry); inside.addTriage(repoFile);
assert.equal(inside.finish().length, 1); assert.equal(inside.finish()[0].recordSource.kind, 'triage');
const insideReversed = createRecordSourceUnion({ repoRoot, recordsDir: path.dirname(repoFile) });
insideReversed.addTriage(repoFile); insideReversed.addRepository(repositoryEntry);
assert.deepEqual(insideReversed.finish(), inside.finish());
const duplicate = createRecordSourceUnion({ repoRoot, recordsDir });
duplicate.addRepository(repositoryEntry);
assert.throws(() => duplicate.addRepository({ ...repositoryEntry, record: { source: 'contradiction' } }),
  { code: 'ERR_RECORD_SOURCE_COLLISION' });
const nestedA = createRecordSourceReference({ repoRoot, recordsDir, kind: 'triage', relativePath: 'a/incident.md' });
const nestedB = createRecordSourceReference({ repoRoot, recordsDir, kind: 'triage', relativePath: 'b/incident.md' });
assert.notEqual(nestedA.storagePath, nestedB.storagePath);
assert.throws(() => createRecordSourceReference({ repoRoot, recordsDir, kind: 'triage', relativePath: '../escape.md' }));
const legacyFile = 'ordinary.md'; await fs.writeFile(path.join(repoRoot, legacyFile), 'legacy source');
const legacy = { fileHash: sha1(Buffer.from('legacy source')) };
assert.equal((await readRecordEmbeddingSource({ repoRoot, recordsDir, file: legacyFile, items: [{ chunk: legacy }] })).text, 'legacy source');
await assert.rejects(readRecordEmbeddingSource({ repoRoot, recordsDir, file: 'triage/records/incident.md', items: [{ chunk: legacy }] }),
  { code: 'ERR_RECORD_SOURCE_REBUILD' });
await assert.rejects(readRecordEmbeddingSource({ repoRoot, recordsDir, file: legacyFile, items: [{ chunk: {} }] }),
  { code: 'ERR_RECORD_SOURCE_REBUILD' });
console.log('Record source namespaces select one exact root, preserve inside-root authority and reject ambiguous legacy replay.');
