import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertTuiRecordingRequest } from '../../src/contracts/validators/tui-recording.js';

const id = randomUUID();
const valid = {
  dispatch: { proto: 'poc.tui@1', op: 'recording:run', jobId: 'recorded-1', method: 'load', params: { directoryId: id, entryId: id } },
  list: { directory: 'C:/saved sessions', filename: 'selected.jsonl' },
  load: { directoryId: id, entryId: id }, page: { recordingId: id, offset: 0, count: 128 }, discard: { recordingId: id }
};
for (const [name, value] of Object.entries(valid)) {
  assert.equal(assertTuiRecordingRequest(name, value), value);
  assert.throws(() => assertTuiRecordingRequest(name, { ...value, command: 'never execute' }), { code: 'ERR_TUI_RECORDING_REQUEST' });
}
for (const [name, value] of [
  ['dispatch', { ...valid.dispatch, op: 'job:run' }], ['dispatch', { ...valid.dispatch, proto: 'poc.tui@2' }],
  ['dispatch', { ...valid.dispatch, method: 'launch' }], ['dispatch', { ...valid.dispatch, jobId: '../foreign' }],
  ['load', { directoryId: 'author-cache', entryId: id }], ['page', { recordingId: id, count: 129 }],
  ['page', { recordingId: id, offset: -1 }], ['page', { recordingId: id, offset: 32769 }],
  ['page', { recordingId: id, count: '1' }], ['list', { directory: 'x'.repeat(4097) }],
  ['list', { directory: 'selected', filename: null }], ['discard', { recordingId: id, pid: 123 }]
]) assert.throws(() => assertTuiRecordingRequest(name, value), { code: 'ERR_TUI_RECORDING_REQUEST' });
const circular = {}; circular.self = circular;
assert.throws(() => assertTuiRecordingRequest('dispatch', circular), { code: 'ERR_TUI_RECORDING_REQUEST' });
let deep = {}; for (let i = 0; i < 25; i++) deep = { nested: deep };
assert.throws(() => assertTuiRecordingRequest('dispatch', deep), { code: 'ERR_TUI_RECORDING_REQUEST' });
console.log('Recorded-session operations retain strict read-only method, authority, JSON and resource contracts.');
