import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { state } from '../../src/map/isometric/client/state.js';
import { renderRemoteMembers, renderRemoteSourceDetails } from '../../src/map/isometric/client/remote-navigation.js';

const window = new Window({ url: 'http://127.0.0.1:12345' }), { document } = window;
globalThis.document = document;
const turn = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const calls = [], navigated = [];
const source = { request(kind, payload, options) {
  assert.equal(this, source);
  return new Promise((resolve, reject) => calls.push({ kind, payload, options, resolve, reject }));
} };
Object.assign(state, { remoteSource: source, sourceIndex: {}, config: { openUriTemplate: 'fixture://source' }, selectionFocusAvailable: false });
let reveals = 0, opens = 0;
state.revealSourceSelection = () => { reveals++; };
const host = document.createElement('section'); document.body.append(host);
renderRemoteSourceDetails(host, { type: 'file', file: 'original.ts' }, { navigate: value => navigated.push(value), openSource: () => { opens++; } });
state.revealSourceSelection = () => assert.fail('a later reveal callback cannot acquire this disclosure');
[...host.querySelectorAll('button')].find(button => button.textContent === 'Reveal in bounded render working set').click();
assert.equal(reveals, 1);
const summary = calls.find(call => call.kind === 'adjacency-summary'), adjacency = calls.find(call => call.kind === 'adjacency');
summary.resolve({ incoming: 0, outgoing: 1, total: 1 });
const endpoint = { type: 'member', file: 'target.ts', id: 0 };
adjacency.resolve({ rows: [{ evidence: { type: 'calls', from: { file: 'original.ts' }, to: { file: 'target.ts' } }, endpoints: { to: endpoint } }], total: 1, next: null });
await turn();
const relation = [...host.querySelectorAll('button')].find(button => button.textContent.startsWith('calls'));
relation.click();
const target = [...host.querySelectorAll('button')].find(button => button.textContent === 'Inspect target');
target.click(); assert.equal(navigated[0], endpoint);
const retainedTarget = target.onclick, retainedOpen = [...host.querySelectorAll('button')].find(button => button.textContent === 'Open inspected source').onclick;
const before = host.textContent;
state.remoteSource = { request() { assert.fail('a stale disclosure must not dispatch to a replacement source'); } };
retainedTarget.call(target); retainedOpen(); assert.equal(navigated.length, 1); assert.equal(opens, 0); assert.equal(host.textContent, before);

// Keep old disclosures connected while replacing their source. A late original
// failure must be rejected before any message/name/ownership getter is visited.
Object.assign(state, { remoteSource: source, sourceIndex: {} });
const group = document.createElement('details'); group.open = true; document.body.append(group);
renderRemoteMembers(group, { address: { fileRow: 0 } }, value => navigated.push(value));
const member = calls.at(-1); let reads = 0;
const diagnostic = Object.freeze(Object.defineProperties({}, {
  message: { get() { reads++; throw new Error('obsolete diagnostic must not run'); } },
  name: { get() { reads++; throw undefined; } }
}));
const pendingText = group.textContent;
state.remoteSource = { request() { assert.fail('old toggle cannot adopt new requester'); } };
member.reject(diagnostic); await turn();
assert.equal(reads, 0); assert.equal(group.textContent, pendingText);
group.open = false; group.dispatchEvent(new window.Event('toggle'));
group.open = true; group.dispatchEvent(new window.Event('toggle')); await turn();
assert.equal(calls.at(-1), member);

// Original current failures use the shared inspection snapshot, so falsey
// failures and a throwing diagnostic cannot reject the asynchronous DOM task.
Object.assign(state, { remoteSource: source, sourceIndex: {} });
const currentGroup = document.createElement('details'); currentGroup.open = true; document.body.append(currentGroup);
renderRemoteMembers(currentGroup, { address: { fileRow: 2 } }, value => navigated.push(value));
const currentCall = calls.at(-1); let currentReads = 0;
const currentFailure = Object.freeze(Object.defineProperties({}, { name: { value: 'Error' }, message: { get() { currentReads++; throw null; } } }));
currentCall.reject(currentFailure); await turn();
assert.equal(currentReads, 1); assert.match(currentGroup.textContent, /Retry member page/);
const retry = currentGroup.querySelector('button'); retry.click(); calls.at(-1).reject(undefined); await turn();
assert.match(currentGroup.textContent, /Retry member page/);

// A source-index replacement alone revokes the disclosure, even when the source
// object and attached host remain the same and a successful page arrives late.
const lateGroup = document.createElement('details'); document.body.append(lateGroup);
renderRemoteMembers(lateGroup, { address: { fileRow: 3 } }, value => navigated.push(value));
const late = calls.at(-1), lateText = lateGroup.textContent; state.sourceIndex = {};
late.resolve({ rows: [{ id: 'stale', name: 'stale success' }], total: 1, next: null }); await turn();
assert.equal(lateGroup.textContent, lateText);
document.body.replaceChildren(); await turn(); await window.happyDOM.close();
console.log('Actual remote disclosures retain original source/index/request/callback authority through late completion.');
