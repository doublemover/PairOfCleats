import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { createMapSnapshotTransport } from '../../tools/analysis/map-snapshot-transport.js';
import { createSnapshotWorkerOwner } from '../../src/map/isometric/client/data/worker-owner.js';
import { createRemoteSource } from '../../src/map/isometric/client/data/remote-source.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';
import { state } from '../../src/map/isometric/client/state.js';
import { initMapData } from '../../src/map/isometric/client/map-data.js';
import { renderSelectionDetails } from '../../src/map/isometric/client/selection.js';
import { renderRemoteSourceDetails } from '../../src/map/isometric/client/remote-navigation.js';
import { scoreMember } from '../../src/map/isometric/client/layout-utils.js';
import { scoringDefaults } from '../../src/map/isometric/client/defaults.js';

const labels = ['first=input', 'second=first', 'third=second', 'fourth=third', 'fifth=fourth'];
const member = { id: 'canonical:visible', name: 'visible', file: 'src/mixed.js', kind: 'function', type: 'function',
  dataflow: { aliases: labels }, signature: 'function visible(input)', params: ['input'] };
const nodes = ['comment', 'empty', 'import-only', 'mixed', 'side-effect'].map(name =>
  ({ path: `src/${name}.js`, name: `${name}.js`, members: name === 'mixed' ? [member] : [] }));
const model = { version: MAP_MODEL_VERSION, nodes,
  edges: labels.map(label => ({ type: 'alias', from: { file: member.file, member: member.id },
    to: { file: member.file, member: member.id }, label: 'alias:' + label })), summary: { dropped: { files: 0, members: 0, edges: 0 } } };
const snapshot = 'pinned:alias-detail', transport = createMapSnapshotTransport({ model, snapshotId: snapshot });
const requests = [], responses = [], messages = [];
const worker = createSnapshotWorkerOwner({ post: message => messages.push(message), fetchPage: async (request, signal) => {
  signal.throwIfAborted(); requests.push(request);
  const response = JSON.parse(transport.respond(request)); responses.push(response); return response;
} });
let serial = 1;
const client = { async request(kind, payload, options = {}) {
  assert.equal(this, client); options.signal?.throwIfAborted();
  const request = ++serial;
  await worker.handle({ protocol: MAP_DATA_PROTOCOL, snapshot, request, revision: options.revision || 0,
    kind, payload, lane: options.lane });
  options.signal?.throwIfAborted();
  const response = messages.find(message => message.request === request);
  assert.equal(response?.event, 'result', response?.error); return response.value;
} };
const window = new Window(), previousDocument = globalThis.document, originalState = { ...state };
const { document } = window;
let remote;
const turn = async () => { for (let index = 0; index < 40; index++) await Promise.resolve(); };
try {
  globalThis.document = document;
  await worker.handle({ protocol: MAP_DATA_PROTOCOL, snapshot, request: 1, revision: 0, kind: 'init', demand: true });
  remote = createRemoteSource({ manifest: transport.manifest, snapshot, endpoint: '/unused', token: 'fixture' });
  const host = document.createElement('section'); document.body.append(host);
  Object.assign(state, { remoteSource: remote, sourceIndex: remote.index, graphWorkerReady: true, graphWorkerClient: client,
    dom: { summary: document.createElement('p'), selectionBody: host }, viewRevisions: null, cancelCameraMotion: null,
    selectionFocusAvailable: false, config: {}, map: { nodes: [], edges: [] }, rawMap: null });
  initMapData();
  let selected;
  const inspect = async candidate => {
    const outcome = await remote.navigate(candidate, info => {
      selected = info; state.selectedInfo = info;
      renderSelectionDetails(info);
      renderRemoteSourceDetails(host, info, { navigate: () => {}, openSource: () => {} });
    });
    assert.equal(outcome.ok, true); await turn();
  };
  const disclose = row => { row.open = true; row.dispatchEvent(new window.Event('toggle')); };
  const inspectAliases = async () => {
    const all = [...host.querySelectorAll(':scope > details')]
      .find(row => row.querySelector(':scope > summary').textContent === 'Source fields · load on demand');
    assert(all); disclose(all); await turn();
    const field = (container, prefix) => [...container.querySelectorAll(':scope > details')]
      .find(row => row.querySelector(':scope > summary').textContent.startsWith(prefix));
    const dataflow = field(all.querySelector(':scope > div > .evidence'), 'dataflow: ');
    assert(dataflow); disclose(dataflow); await turn();
    const aliases = field(dataflow.querySelector(':scope > .evidence'), 'aliases: ');
    assert.equal(aliases.querySelector(':scope > summary').textContent, 'aliases: 5 items');
    disclose(aliases); await turn();
    assert.deepEqual([...aliases.querySelectorAll(':scope > .evidence > details > summary')].map(row => row.textContent),
      labels.map((label, index) => `${index}: ${label}`));
  };
  const files = await remote.request('search', { query: '', entityType: 'file', limit: 80 });
  assert.equal(files.total, 5);
  assert.equal(files.rows.filter(file => file.memberCount === 0).length, 4);
  await inspect({ type: 'member', id: member.id, file: member.file });
  assert.equal(selected.id, member.id);
  assert.equal(selected.dataflow, undefined);
  assert.equal(remote.index.member(member.id).member.dataflow, undefined, 'compact resolve rows deliberately omit rich dataflow');
  assert.equal(requests.some(request => request.kind === 'detail'), false, 'selection must not preload full detail');
  await inspectAliases();
  const detail = responses.find(response => response.kind === 'detail');
  assert.deepEqual(detail.detail, member, 'server → worker → lazy DOM preserves the full pinned member');
  assert.equal(detail.snapshot, snapshot);
  assert(Math.abs(scoreMember(detail.detail, scoringDefaults)
    - scoreMember({ ...detail.detail, dataflow: { aliases: [] } }, scoringDefaults)
    - labels.length * scoringDefaults.dataflow) < 1e-9);
  assert.equal(remote.index.member(member.id).member.dataflow, undefined, 'inspecting rich evidence does not expand resident selection metadata');
  const history = { ...selected };
  await inspect({ type: 'file', file: 'src/empty.js' });
  assert.equal(remote.index.member(member.id), undefined);
  await inspect(history); await inspectAliases();
  assert.equal(requests.filter(request => request.kind === 'detail').length, 1, 're-entry uses the original generation-bound demand page');
  assert.equal(remote.index.members.size, 1);
} finally {
  document.body.replaceChildren(); await turn();
  remote?.dispose(); worker.dispose(); transport.dispose();
  for (const key of Object.keys(state)) if (!Object.hasOwn(originalState, key)) delete state[key];
  Object.assign(state, originalState); globalThis.document = previousDocument;
  await window.happyDOM.close();
}
console.log('Remote compact selection and pinned full detail preserve all five aliases through worker, lazy inspector, scoring and history re-entry.');
