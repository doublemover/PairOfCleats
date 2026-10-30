import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { MAP_SAVED_INPUT_BYTES, parseSavedMap, readSavedMap } from '../../tools/analysis/map-saved-input.js';
import { createMapSnapshotTransport } from '../../tools/analysis/map-snapshot-transport.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';

const model = { version: MAP_MODEL_VERSION, root: { id: 'saved-fixture' }, nodes: [{ path: '雪😀.ts', members: [] }], edges: [] };
const bytes = Buffer.from(JSON.stringify(model)), hash = value => createHash('sha256').update(value).digest('hex');
const fixture = ({ raw = bytes, beforeChange = {}, afterChange = {}, currentChange = {}, signal = null, onCurrent = null } = {}) => {
  const base = { dev: 1n, ino: 2n, size: BigInt(raw.length), mtimeNs: 10n, ctimeNs: 11n, isFile: () => true };
  const state = { opened: 0, closed: 0, stats: 0, streamed: 0 };
  const fsImpl = {
    async open() {
      state.opened++;
      return {
        async stat(options) { assert.equal(options.bigint, true); return { ...base, ...(state.stats++ === 0 ? beforeChange : afterChange) }; },
        async *createReadStream(options) {
          assert.equal(options.autoClose, false); assert.equal(options.signal, signal);
          for (let index = 0; index < raw.length; index += 3) { state.streamed++; yield raw.subarray(index, index + 3); }
        },
        async close() { state.closed++; }
      };
    },
    async stat(file, options) { assert.equal(options.bigint, true); onCurrent?.(); return { ...base, ...currentChange }; }
  };
  return { state, read: () => readSavedMap('saved-model.json', { fsImpl, signal }) };
};
const stable = fixture(), admitted = await stable.read();
assert.equal(admitted.sha256, hash(bytes)); assert.equal(admitted.bytes, bytes.length);
assert.deepEqual(admitted.model, model); assert.equal(stable.state.opened, 1); assert.equal(stable.state.closed, 1);
assert.ok(stable.state.streamed > 1, 'multibyte characters split across stream chunks retain original UTF-8 byte identity');
for (const options of [{ afterChange: { mtimeNs: 12n } }, { afterChange: { ctimeNs: 12n } },
  { currentChange: { ino: 3n } }, { currentChange: { dev: 2n } }, { beforeChange: { size: BigInt(bytes.length - 1) } }]) {
  const changed = fixture(options);
  await assert.rejects(changed.read(), /changed|replaced/); assert.equal(changed.state.closed, 1);
}
const invalidUtf8 = Buffer.from(bytes); invalidUtf8[invalidUtf8.indexOf(Buffer.from('雪'))] = 255;
const malformed = fixture({ raw: invalidUtf8 });
await assert.rejects(malformed.read(), /not valid UTF-8/); assert.equal(malformed.state.closed, 1);
const tooLarge = fixture({ beforeChange: { size: BigInt(MAP_SAVED_INPUT_BYTES + 1) } });
await assert.rejects(tooLarge.read(), /32 MiB/); assert.equal(tooLarge.state.streamed, 0); assert.equal(tooLarge.state.closed, 1);
const pre = new AbortController(); pre.abort(); const preCancelled = fixture({ signal: pre.signal });
await assert.rejects(preCancelled.read(), error => error.name === 'AbortError'); assert.equal(preCancelled.state.opened, 0);
const during = new AbortController(), cancelled = fixture({ signal: during.signal, onCurrent: () => during.abort() });
await assert.rejects(cancelled.read(), error => error.name === 'AbortError'); assert.equal(cancelled.state.closed, 1);
assert.throws(() => parseSavedMap(Buffer.from('{}')), /UTF-8 text/);
const typedModel = { ...model, nodes: [{ path: 'typed.ts', members: [{ id: 0, name: 'numeric' }, { id: '0', name: 'textual' }] }] };
const typedInput = parseSavedMap(JSON.stringify(typedModel));
const typed = createMapSnapshotTransport({ model: typedInput.model, snapshotId: typedInput.sha256 });
for (const [id, name] of [[0, 'numeric'], ['0', 'textual']]) {
  const resolved = JSON.parse(typed.respond({ protocol: MAP_DATA_PROTOCOL, snapshot: typedInput.sha256,
    request: 1, revision: 0, kind: 'resolve', entity: { type: 'member', id } }));
  assert.equal(resolved.entity.id, id); assert.equal(resolved.entity.name, name, 'saved-input admission and actual transport retain typed opaque identity');
}
typed.dispose();
assert.throws(() => parseSavedMap(JSON.stringify({ ...model, nodes: [{ path: 'duplicate.ts', members: [{ id: 0 }, { id: 0 }] }] })), /Duplicate/);
assert.equal(admitted.provenance.generationHealth, 'not-revalidated', 'stable byte admission does not certify current index health');
console.log('Saved map original UTF8/hash/file-instance admission and descriptor cleanup assertions complete; runtime source unvalidated');
