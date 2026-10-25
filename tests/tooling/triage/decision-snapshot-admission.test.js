import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getTriageContext } from '../../helpers/triage.js';
import { runNode } from '../../helpers/run-node.js';
import { getTriageConfig } from '../../../src/shared/dict-utils.js';
import { loadTriageRecordSnapshot } from '../../../tools/triage/record-snapshot.js';
import { readTriageHistoryRecord } from '../../../tools/triage/history.js';

const { root, repoRoot, cacheRoot, env } = await getTriageContext({ name: 'triage-decision-snapshot', fixtureBuilder: async () => {} });
const recordsDir = getTriageConfig(repoRoot, { cache: { root: cacheRoot } }).recordsDir;
await fs.mkdir(recordsDir, { recursive: true });
const id = 'finding-a', file = path.join(recordsDir, `${id}.json`);
const record = { recordId: id, recordType: 'finding', source: 'fixture', createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z', vuln: { title: 'first observation' }, schemaVersion: 'source-extension',
  idProvenance: { method: 'explicit', stability: 'stable', source: 'recordId' } };
const cli = ['tools/triage/decision.js', '--repo', repoRoot, '--finding', id, '--status', 'accept'];
const save = async finding => {
  const bytes = JSON.stringify(finding); await fs.writeFile(file, bytes);
  const result = runNode(cli, 'triage decision snapshot', root, env, { stdio: 'pipe', timeoutMs: 5000 });
  const output = JSON.parse(result.stdout), decision = JSON.parse(await fs.readFile(output.jsonPath, 'utf8'));
  assert.equal(decision.decision.findingRecordId, id);
  assert.equal(decision.decision.findingObservation.hash, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(decision.decision.findingObservation.bytes, Buffer.byteLength(bytes));
  return { output, decision };
};
const first = await save(record);
const second = await save({ ...record, updatedAt: '2026-10-25T00:01:00Z', vuln: { title: 'second observation' } });
assert.notEqual(first.decision.decision.findingObservation.hash, second.decision.decision.findingObservation.hash);
assert.deepEqual(JSON.parse(await fs.readFile(first.output.jsonPath, 'utf8')), first.decision,
  'same stable finding ID does not retarget the earlier saved observation');

for (const [value, code] of [[{}, 'ERR_TRIAGE_RECORD_INVALID'], [[], 'ERR_TRIAGE_RECORD_INVALID'],
  [42, 'ERR_TRIAGE_RECORD_INVALID'], [{ ...record, recordId: 'finding-b' }, 'ERR_TRIAGE_RECORD_IDENTITY'],
  [{ ...record, recordType: 'decision' }, 'ERR_TRIAGE_RECORD_INVALID']]) {
  await fs.writeFile(file, JSON.stringify(value));
  await assert.rejects(loadTriageRecordSnapshot(recordsDir, id, { recordType: 'finding' }), { code });
  const before = await fs.readdir(recordsDir);
  const result = runNode(cli, 'rejected finding has no decision', root, env,
    { stdio: 'pipe', timeoutMs: 5000, allowFailure: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, new RegExp(code));
  assert.deepEqual(await fs.readdir(recordsDir), before);
}
await fs.writeFile(file, '{broken');
await assert.rejects(loadTriageRecordSnapshot(recordsDir, id), { code: 'ERR_TRIAGE_RECORD_INVALID' });
await fs.writeFile(file, JSON.stringify(record));
await assert.rejects(loadTriageRecordSnapshot(recordsDir, id, { maxBytes: 8 }), { code: 'ERR_FILE_TOO_LARGE' });
await assert.rejects(loadTriageRecordSnapshot(recordsDir, '../outside'), { code: 'ERR_TRIAGE_RECORD_ID_PATH' });
await assert.rejects(loadTriageRecordSnapshot(recordsDir, 'missing'), { code: 'ENOENT' });
await fs.writeFile(file, JSON.stringify({ ...record, recordId: 'finding-b' }));
await assert.rejects(readTriageHistoryRecord(file), { code: 'ERR_TRIAGE_RECORD_IDENTITY' });
const stat = fsSync.lstatSync;
try {
  fsSync.lstatSync = (target, ...args) => {
    const value = stat.call(fsSync, target, ...args);
    return path.relative(String(target), file) === '' ? Object.create(value, { isSymbolicLink: { value: () => true } }) : value;
  };
  await assert.rejects(loadTriageRecordSnapshot(recordsDir, id), { code: 'ERR_UNSAFE_FILE_PATH' },
    'injected link metadata exercises the actual contained admission without creating links');
} finally { fsSync.lstatSync = stat; }
console.log('triage decision snapshot admission passed');
