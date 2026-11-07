import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { writeTriageRecordArtifacts } from '../../../tools/triage/record-writer.js';
import { loadTriageRecordSnapshot } from '../../../tools/triage/record-snapshot.js';

// Only interceptable in-process admission: never create, open or probe a device,
// stream, link, record directory or actual record. Historical defects fail at the
// barrier before their first filesystem operation can touch an unsafe name.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['writer', 'reader'].includes(selected));
const blocked = new Error('unexpected filesystem operation after invalid ID admission');
const original = new Map(), originalSync = new Map(); let attempts = 0;
for (const name of ['mkdir', 'readFile', 'writeFile', 'open', 'lstat', 'stat', 'realpath']) {
  original.set(name, fs[name]);
  fs[name] = async () => { attempts++; throw blocked; };
}
for (const name of ['lstatSync', 'statSync', 'openSync', 'mkdirSync', 'readFileSync', 'writeFileSync']) {
  originalSync.set(name, fsSync[name]);
  fsSync[name] = () => { attempts++; throw blocked; };
}
try {
  const ids = selected === 'reader' ? ['../outside', 'nested\\record', '\0record']
    : [42, {}, Object.create(null), { toString() { assert.fail('invalid IDs cannot invoke user coercion'); } },
      ' padded-record ', '\0record', 'nested\\record'];
  if (process.platform === 'win32') ids.push('NUL', 'con.json', 'COM¹', 'LPT³', 'record:stream', 'record::$DATA');
  for (const recordId of ids) {
    const operation = selected === 'writer'
      ? writeTriageRecordArtifacts(path.resolve('never-created-record-admission-root'), { recordId, recordType: 'finding', source: 'fixture' })
      : loadTriageRecordSnapshot(path.resolve('never-created-record-admission-root'), recordId);
    await assert.rejects(operation, { code: 'ERR_TRIAGE_RECORD_ID_PATH' });
    assert.equal(attempts, 0);
  }
} finally {
  for (const [name, value] of original) fs[name] = value;
  for (const [name, value] of originalSync) fsSync[name] = value;
}
console.log(`triage ${selected} refuses unsafe record IDs before native IO`);
