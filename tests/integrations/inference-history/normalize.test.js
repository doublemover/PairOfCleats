#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  hashCanonicalJson,
  normalizeConversation,
  normalizeTimestamp
} from '../../../src/integrations/inference-history/normalize.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv();

const message = (id, text, extra = {}) => ({
  id,
  author: { role: 'assistant' },
  content: { content_type: 'text', parts: [text] },
  create_time: 1700000000,
  ...extra
});
const node = (id, parent, children, body = null) => ({ id, parent, children, message: body });
const conversation = (mapping, current = null, extra = {}) => ({
  id: 'synthetic-conversation',
  mapping,
  current_node: current,
  ...extra
});
const codes = (normalized) => new Set(normalized.diagnostics.map((entry) => entry.code));
const byId = (normalized, id) => normalized.nodes.find((entry) => entry.nodeId === id);
const rejectInput = (callback) => assert.throws(callback, (error) => (
  error.code === 'ERR_INFERENCE_HISTORY_INPUT'
  && error.message === 'Invalid inference history conversation input.'
));

const raw = conversation({
  root: node('root', null, ['prompt']),
  prompt: node('prompt', 'root', ['selected', 'retry'], message('m-prompt', 'Question', { author: { role: 'user' } })),
  selected: node('selected', 'prompt', [], message('m-selected', 'Selected answer')),
  retry: node('retry', 'prompt', ['longer'], message('m-retry', 'Rejected retry')),
  longer: node('longer', 'retry', ['longest'], message('m-longer', 'Longer alternate branch')),
  longest: node('longest', 'longer', [], message('m-longest', 'Newest alternate branch', { create_time: 1800000000 }))
}, 'selected', { unknown_metadata: { retained: true } });
const before = JSON.stringify(raw);
const normalized = normalizeConversation(raw);
assert.equal(normalized.raw, raw, 'raw evidence retains its original identity');
assert.equal(JSON.stringify(raw), before, 'normalization does not change source data');
assert.equal(normalized.nodes.length, 6, 'null roots and alternate branches are retained');
assert.equal(byId(normalized, 'root').messageId, null);
assert.equal(byId(normalized, 'root').role, null);
assert.equal(byId(normalized, 'selected').messageId, 'm-selected', 'mapping key is distinct from message id');
assert.equal(byId(normalized, 'selected').pathState, 'on_selected_path');
assert.equal(byId(normalized, 'prompt').pathState, 'on_selected_path');
assert.equal(byId(normalized, 'root').pathState, 'on_selected_path');
assert.equal(byId(normalized, 'longest').pathState, 'off_selected_path', 'never select the newest or longest branch');
assert.deepEqual(normalized.diagnostics, []);

const noCurrent = normalizeConversation({ ...raw, current_node: null });
assert(noCurrent.nodes.every((entry) => entry.pathState === 'unknown'));
assert(codes(noCurrent).has('missing_current_node'));
const danglingCurrent = normalizeConversation({ ...raw, current_node: 'absent' });
assert.equal(danglingCurrent.currentNode, 'absent');
assert(danglingCurrent.nodes.every((entry) => entry.pathState === 'unknown'));
assert(codes(danglingCurrent).has('dangling_current_node'));

const anomalous = normalizeConversation(conversation({
  root: node('root', null, ['wrong', 'missing', 'wrong']),
  wrong: node('wrong', 'orphan', []),
  unlisted: node('unlisted', 'root', [])
}, 'wrong'));
for (const code of ['dangling_parent', 'dangling_child', 'parent_child_mismatch', 'child_parent_mismatch', 'duplicate_child_reference', 'incomplete_selected_path']) {
  assert(codes(anomalous).has(code), `diagnose ${code}`);
}
assert(anomalous.nodes.every((entry) => entry.pathState === 'unknown'));
assert.deepEqual(byId(anomalous, 'root').children, ['wrong', 'missing', 'wrong'], 'valid edge references are lossless');

const cycleRaw = conversation({
  a: node('a', 'b', ['b']),
  b: node('b', 'a', ['a']),
  outside: node('outside', null, [])
}, 'a');
const cycles = normalizeConversation(cycleRaw);
assert(codes(cycles).has('parent_cycle'));
assert(codes(cycles).has('child_cycle'));
assert(codes(cycles).has('incomplete_selected_path'));
assert(cycles.nodes.every((entry) => entry.pathState === 'unknown'));
assert.deepEqual(cycles.diagnostics.filter((entry) => entry.code === 'parent_cycle').map((entry) => entry.nodeId), ['a', 'b']);

const malformedEdges = normalizeConversation(conversation({
  a: { id: 'a', message: null, children: [null, '', 42, 'a'], parent: { private: 'retained' } }
}, 'a'));
assert(codes(malformedEdges).has('invalid_parent'));
assert(codes(malformedEdges).has('invalid_child_reference'));
assert(codes(malformedEdges).has('child_cycle'));
assert.equal(malformedEdges.nodes[0].pathState, 'unknown');
assert.deepEqual(malformedEdges.raw.mapping.a.parent, { private: 'retained' });

const content = {
  content_type: 'multimodal_text',
  parts: [
    'first',
    { content_type: 'text', text: 'second', metadata: { kept: true } },
    { content_type: 'code', language: 'js', text: 'third()' },
    { content_type: 'future_part', text: 'unknown text is evidence only', data: [1, 2] },
    { content_type: 'image_asset_pointer', asset_pointer: 'file-service://synthetic-image' },
    { content_type: 'audio_asset_pointer', audio_asset_pointer: 'sediment://synthetic-audio' },
    { content_type: 'image_url', image_url: { url: 'https://example.invalid/synthetic.png' } },
    'attachment://synthetic-file',
    null,
    17
  ],
  text: 'tail',
  code: 'last()'
};
const multimodalRaw = conversation({ a: node('a', null, [], message('m-a', '', { content })) }, 'a');
const multimodal = normalizeConversation(multimodalRaw);
const multimodalNode = multimodal.nodes[0];
assert.equal(multimodalNode.text, 'first\nsecond\nthird()\ntail\nlast()');
assert.equal(multimodalNode.parts[3].type, 'future_part');
assert.equal(multimodalNode.parts[3].raw, content.parts[3]);
assert.equal(multimodalNode.parts[8].raw, null);
assert.equal(multimodalNode.parts[9].raw, 17);
assert.equal(multimodalNode.assets.length, 4);
assert(multimodalNode.assets.every((asset) => asset.state === 'unresolved'));
assert.deepEqual(multimodalNode.assets.map((asset) => asset.pointer), [
  'file-service://synthetic-image',
  'sediment://synthetic-audio',
  'https://example.invalid/synthetic.png',
  'attachment://synthetic-file'
]);
const clipped = normalizeConversation(multimodalRaw, { maxTextChars: 8 });
assert.equal(clipped.nodes[0].text, 'first\nse');
assert.equal(clipped.nodes[0].parts[1].text, 'second', 'full evidence text is not clipped');
assert.equal(clipped.nodes[0].parts[1].raw, content.parts[1]);
assert(codes(clipped).has('text_truncated'));
const zeroText = normalizeConversation(multimodalRaw, { maxTextChars: 0 });
assert.equal(zeroText.nodes[0].text, '');
assert(codes(zeroText).has('text_truncated'));
const emoji = normalizeConversation(conversation({ a: node('a', null, [], message('m-a', '😀word')) }, 'a'), { maxTextChars: 1 });
assert.equal(emoji.nodes[0].text, '', 'query text never ends in a split surrogate');

assert.deepEqual(normalizeTimestamp(undefined), { raw: null, utc: null, state: 'missing' });
assert.deepEqual(normalizeTimestamp(null), { raw: null, utc: null, state: 'null' });
assert.deepEqual(normalizeTimestamp(0), { raw: 0, utc: '1970-01-01T00:00:00.000Z', state: 'valid' });
assert.equal(normalizeTimestamp(1700000000.125).utc, '2023-11-14T22:13:20.125Z');
assert.equal(normalizeTimestamp('2024-02-29T12:00:00+02:00').utc, '2024-02-29T10:00:00.000Z');
assert.equal(normalizeTimestamp('2024-02-29T12:00:00').state, 'ambiguous');
assert.equal(normalizeTimestamp('2024-02-29').state, 'ambiguous');
for (const value of ['2024-02-30T12:00:00Z', '2023-02-29T12:00:00Z', '2024-13-01T00:00:00Z', '2024-01-01T25:00:00Z', '2024-02-30', '2024-13-01T00:00', '1700000000', 'tomorrow', 8640000000001, Infinity]) {
  assert.equal(normalizeTimestamp(value).state, 'invalid', `timestamp must not be guessed: ${value}`);
}
const timeStates = normalizeConversation(conversation({
  missing: node('missing', null, [], { id: 'm-missing', author: { role: 'user' }, content: 'text' }),
  explicit: node('explicit', null, [], message('m-null', '', { create_time: null })),
  bad: node('bad', null, [], message('m-bad', '', { create_time: 'not a timestamp' })),
  ambiguous: node('ambiguous', null, [], message('m-ambiguous', '', { create_time: '2024-02-29' }))
}, 'missing', { create_time: 1700000000, update_time: 1800000000 }));
assert.equal(byId(timeStates, 'missing').createdAt.state, 'missing', 'conversation dates are not fallback message dates');
assert.equal(byId(timeStates, 'explicit').createdAt.state, 'null');
assert(codes(timeStates).has('invalid_created_at'));
assert(codes(timeStates).has('ambiguous_created_at'));

const special = JSON.parse('{"z":1,"__proto__":{"retained":true},"constructor":{"x":2},"a":[3,{"b":4,"a":5}]}');
const specialReordered = JSON.parse('{"a":[3,{"a":5,"b":4}],"constructor":{"x":2},"__proto__":{"retained":true},"z":1}');
const expectedCanonical = '{"__proto__":{"retained":true},"a":[3,{"a":5,"b":4}],"constructor":{"x":2},"z":1}';
assert.equal(canonicalJson(special), expectedCanonical);
assert.equal(hashCanonicalJson(special), createHash('sha256').update(expectedCanonical).digest('hex'));
assert.equal(hashCanonicalJson(special), hashCanonicalJson(specialReordered));
assert.notEqual(hashCanonicalJson(special), hashCanonicalJson({ ...special, ['__proto__']: { retained: false } }));
assert.notEqual(hashCanonicalJson(special), hashCanonicalJson({ ...special, constructor: { x: 9 } }));
assert.equal(Object.prototype.retained, undefined, 'special JSON keys never mutate prototypes');
const dangerousKeysRaw = conversation(JSON.parse('{"__proto__":{"id":"__proto__","message":null,"parent":null,"children":["constructor"]},"constructor":{"id":"constructor","message":{"id":"message-id","author":{"role":"user"},"content":{"parts":["safe"]}},"parent":"__proto__","children":[]}}'), 'constructor');
const dangerousKeys = normalizeConversation(dangerousKeysRaw);
assert.equal(dangerousKeys.nodes.length, 2);
assert(dangerousKeys.nodes.every((entry) => entry.pathState === 'on_selected_path'));
assert.equal(dangerousKeys.diagnostics.length, 0);
assert.equal(normalizeConversation({ ...raw, mapping: Object.fromEntries(Object.entries(raw.mapping).reverse()) }).snapshotHash, normalized.snapshotHash);
assert.notEqual(normalizeConversation({ ...raw, unknown_metadata: { retained: false } }).snapshotHash, normalized.snapshotHash);

rejectInput(() => normalizeConversation({ mapping: {} }));
rejectInput(() => normalizeConversation({ ...raw, conversation_id: 'conflicting-id' }));
rejectInput(() => normalizeConversation({ ...raw, id: '' }));
rejectInput(() => normalizeConversation({ ...raw, mapping: [] }));
rejectInput(() => normalizeConversation(conversation({ a: node('different-id', null, []) })));
rejectInput(() => normalizeConversation(conversation({ '': node('', null, []) })));
rejectInput(() => normalizeConversation(conversation({ a: node('a', null, [], { author: { role: 'user' }, content: 'private-body' }) })));
rejectInput(() => normalizeConversation(conversation({ a: node('a', null, [], message('same-id', 'a')), b: node('b', null, [], message('same-id', 'b')) })));
rejectInput(() => normalizeConversation(raw, { maxNodes: 5 }));
rejectInput(() => normalizeConversation(raw, { maxTextChars: -1 }));
rejectInput(() => normalizeConversation(raw, { maxNodes: 2.5 }));
rejectInput(() => normalizeConversation(raw, null));
assert.equal(normalizeConversation(conversation({ a: { parent: null, children: [], message: null } }, 'a')).nodes[0].nodeId, 'a', 'mapping identity is sufficient when node.id is absent');

let getterInvoked = false;
const accessor = {};
Object.defineProperty(accessor, 'private', { enumerable: true, get: () => { getterInvoked = true; return 'secret'; } });
rejectInput(() => hashCanonicalJson(accessor));
assert.equal(getterInvoked, false, 'hashing never invokes source accessors');
const cyclicJson = {};
cyclicJson.self = cyclicJson;
for (const value of [cyclicJson, { unsupported: undefined }, { unsupported: NaN }, { unsupported: 1n }, new Date(), Array(1)]) {
  rejectInput(() => hashCanonicalJson(value));
}
const shared = { repeated: true };
assert.equal(canonicalJson({ a: shared, b: shared }), '{"a":{"repeated":true},"b":{"repeated":true}}', 'shared references are valid when they are not cycles');

const largeMapping = Object.create(null);
for (let index = 0; index < 10000; index += 1) {
  const id = `n${index}`;
  largeMapping[id] = node(id, index ? `n${index - 1}` : null, index < 9999 ? [`n${index + 1}`] : []);
}
const large = normalizeConversation(conversation(largeMapping, 'n9999'));
assert.equal(large.nodes.length, 10000);
assert(large.nodes.every((entry) => entry.pathState === 'on_selected_path'));
assert.equal(large.diagnostics.length, 0);
rejectInput(() => normalizeConversation(conversation({ ...largeMapping, extra: node('extra', null, []) })));
let deep = 'leaf';
for (let index = 0; index < 10000; index += 1) deep = { nested: deep };
assert.match(hashCanonicalJson(deep), /^[0-9a-f]{64}$/, 'deep unknown metadata hashes without recursive call-stack growth');

console.log('inference history normalization test passed');
