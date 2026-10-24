import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTuiRecordings } from '../../tools/tui/operator/recordings.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';
import { recordSupervisorFixture } from '../helpers/recorded-supervisor.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('operator-recordings');
const source = await recordSupervisorFixture(path.join(dir, 'publisher'));
const directory = path.join(dir, 'selected'); await fs.mkdir(directory);
const file = path.join(directory, 'session.jsonl'), meta = path.join(directory, 'session.meta.json');
const actor = createTuiRecordings();
const restore = async () => { await fs.writeFile(file, source.bytes); await fs.writeFile(meta, source.metadataBytes); };
const choose = async () => {
  const listed = await actor.list({ directory, filename: 'session.jsonl' });
  return { directoryId: listed.directoryId, entryId: listed.entries[0].id };
};
const negative = async (mutate, code) => {
  await restore(); await mutate(); const selected = await choose();
  await assert.rejects(actor.load(selected), { code });
};
try {
  await restore(); const loaded = await actor.load(await choose());
  assert.equal(loaded.mode, 'replay'); assert.equal(loaded.connection, 'offline'); assert.equal(loaded.controllable, false);
  assert.equal(loaded.frameCount, source.frames.length);
  const events = []; let offset = 0;
  while (offset !== null) {
    const page = actor.page({ recordingId: loaded.recordingId, offset, count: 128 });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 1024 * 1024, 'the existing operation output cap remains unchanged');
    events.push(...page.events); offset = page.nextOffset;
  }
  assert.equal(events.length, loaded.eventCount);
  assert.equal(events[0].event, 'hello'); assert.equal(events[0].session.controllable, true,
    'recorded control claims are retained as data, never a live authority witness');
  assert.ok(events.some(e => e.event === 'job:end' && e.jobId === 'recorded-job' && e.status === 'done'));
  assert.ok(events.some(e => e.event === 'log' && e.message === 'x'.repeat(70000)));
  assert.ok(events.every(e => e.event !== 'event:chunk'), 'logical event pages must reassemble every complete chunk set');
  assert.deepEqual(await fs.readFile(file), source.bytes, 'reading never rewrites publisher evidence');
  await negative(() => fs.appendFile(file, '{'), 'ERR_TUI_RECORDING_TRUNCATED');
  await negative(() => fs.appendFile(file, '{"bad":"frame"}\n'), 'ERR_TUI_RECORDING_FRAME');
  await negative(() => fs.writeFile(meta, JSON.stringify({ ...source.metadata, schemaVersion: 2 })), 'ERR_TUI_RECORDING_VERSION');
  await negative(() => fs.writeFile(meta, JSON.stringify({ ...source.metadata, protocol: 'poc.progress@1' })), 'ERR_TUI_RECORDING_VERSION');
  await negative(async () => {
    const frames = structuredClone(source.frames); frames[1].runId = 'foreign';
    await fs.writeFile(file, frames.map(JSON.stringify).join('\n') + '\n');
  }, 'ERR_TUI_RECORDING_RUN');
  const chunk = source.frames.findIndex(e => e.event === 'event:chunk'); assert.ok(chunk >= 0);
  await negative(() => fs.writeFile(file, source.frames.filter((_, i) => i !== chunk).map(JSON.stringify).join('\n') + '\n'),
    'ERR_TUI_RECORDING_TRUNCATED');
  await negative(() => fs.writeFile(file, [...source.frames.slice(0, chunk), source.frames[chunk],
    ...source.frames.slice(chunk)].map(JSON.stringify).join('\n') + '\n'), 'ERR_TUI_RECORDING_CHUNK');
  await negative(async () => {
    const frames = structuredClone(source.frames); let payload = {};
    for (let i = 0; i < 80; i++) payload = { nested: payload };
    frames[0].payload = payload;
    await fs.writeFile(file, frames.map(JSON.stringify).join('\n') + '\n');
  }, 'ERR_TUI_RECORDING_LIMIT');
  await restore();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await actor.load(await choose())).recordingId);
  assert.throws(() => actor.page({ recordingId: ids[0] }), { code: 'ERR_TUI_RECORDING_STALE' });
  assert.equal(actor.discard({ recordingId: ids[2] }).discarded, true);
  assert.throws(() => actor.page({ recordingId: ids[2] }), { code: 'ERR_TUI_RECORDING_STALE' });
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(actor.list({ directory }, { signal: aborted.signal }));
  for (const params of [{ directory, command: 'never execute' }, { directory, filename: '../session.jsonl' }]) {
    await assert.rejects(async () => actor.list(params));
  }
} finally { actor.dispose(); }
console.log('Actual supervisor recordings retain content, strict admission, passive authority and bounded complete paging.');
