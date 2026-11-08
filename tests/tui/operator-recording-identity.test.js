import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiRecordings } from '../../tools/tui/operator/recordings.js';
import { formatProgressEvent, PROGRESS_PROTOCOL } from '../../src/shared/cli/progress-events.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('native-recording-identity');
const directory = path.join(dir, 'selected'); await fs.mkdir(directory);
const file = path.join(directory, 'session.jsonl'), meta = path.join(directory, 'session.meta.json');
const metadata = { schemaVersion: 1, protocol: PROGRESS_PROTOCOL, supervisorProtocol: 'poc.tui@1',
  supervisorVersion: 'fixture', runId: 'selected-run', startedAt: new Date().toISOString() };
const bytes = `${JSON.stringify(formatProgressEvent('hello', { runId: metadata.runId, seq: 1,
  session: { mode: 'supervised', controllable: true } }))}\n`;
const actor = createTuiRecordings();
const restore = async () => { await fs.writeFile(file, bytes); await fs.writeFile(meta, JSON.stringify(metadata)); };
const choose = async () => {
  const listed = await actor.list({ directory, filename: 'session.jsonl' });
  return { directoryId: listed.directoryId, entryId: listed.entries[0].id };
};
try {
  await restore();
  const selected = await choose();
  await fs.writeFile(meta, JSON.stringify({ ...metadata, runId: 'replacement-run' }));
  await assert.rejects(actor.load(selected), { code: 'ERR_TUI_RECORDING_STALE' });
  await restore();
  const replacedFile = await choose();
  await fs.rename(file, path.join(directory, 'old-session.jsonl'));
  await fs.writeFile(file, bytes);
  await assert.rejects(actor.load(replacedFile), { code: 'ERR_FILE_CHANGED' });
  const replacedDirectory = await choose();
  await fs.rename(directory, path.join(dir, 'previous-directory'));
  await fs.mkdir(directory); await restore();
  await assert.rejects(actor.load(replacedDirectory), { code: 'ERR_TUI_RECORDING_STALE' });
  const appended = await choose();
  await fs.appendFile(file, `${JSON.stringify(formatProgressEvent('log', { runId: metadata.runId, seq: 2,
    message: 'same unfinished recording grew after listing' }))}\n`);
  const loaded = await actor.load(appended);
  assert.equal(loaded.eventCount, 2, 'a stable file object can supply a finite snapshot of an unfinished recording');
  assert.equal(loaded.controllable, false);
  await fs.writeFile(meta, '{}');
  const invalid = await actor.list({ directory, filename: 'session.jsonl' });
  assert.equal(invalid.entries[0].valid, false);
  await fs.writeFile(meta, JSON.stringify(metadata));
  await assert.rejects(actor.load({ directoryId: invalid.directoryId, entryId: invalid.entries[0].id }),
    { code: 'ERR_TUI_RECORDING_METADATA' }, 'an invalid listed entry retains its original diagnosis and cannot silently become an admitted recording');
} finally { actor.dispose(); }
console.log('Saved-session capabilities bind selected directory, metadata revision and actual log object');
