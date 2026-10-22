import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { state } from '../../src/map/isometric/client/state.js';
import { initMapData } from '../../src/map/isometric/client/map-data.js';
import { setSelection, setSemanticSelection, openSelection } from '../../src/map/isometric/client/selection.js';

const browser = new Window({ url: 'https://example.invalid/' });
globalThis.window = browser;
globalThis.document = browser.document;
const rawMap = { root: { path: '/fixture' }, nodes: [
  { path: 'a.ts', members: [] },
  { path: 'b.ts', members: [{ id: 0, name: 'zero', range: { startLine: 7, endLine: 8 } }] }
], edges: [{ from: { file: 'a.ts' }, to: { member: 0 }, type: 'call' }] };
Object.assign(state, {
  rawMap, map: { ...rawMap, nodes: rawMap.nodes.slice(0, 1), edges: [] },
  config: { openUriTemplate: 'https://example.invalid/open?file={file}&line={line}' },
  dom: { selectionBody: document.createElement('div') }, THREE: null
});
initMapData();
const oldHit = { object: { userData: { type: 'file', file: 'a.ts' } } };
setSelection(oldHit);
assert.equal(state.selected, oldHit);
setSemanticSelection({ type: 'member', file: 'b.ts', id: 0 });
assert.equal(state.selected, null, 'selecting undrawn B clears the old A hit');
assert.equal(state.selectedInfo.id, 0);
assert.equal(state.selectedInfo.range.startLine, 7);
assert.equal(state.selectionFocusAvailable, false);
assert.match(state.dom.selectionBody.textContent, /b.ts/);
assert.equal(state.sourceIndex.relationships(state.selectedInfo).length, 1);
openSelection();
assert.equal(new URL(window.location.href).searchParams.get('file'), '/fixture/b.ts');
assert.equal(new URL(window.location.href).searchParams.get('line'), '7');
setSemanticSelection(state.selectedInfo);
assert.equal(state.selectedInfo.file, 'b.ts', 'reconciliation retains available undrawn evidence');
state.rawMap = { ...rawMap, nodes: rawMap.nodes.slice(0, 1) };
initMapData();
const priorUrl = window.location.href;
openSelection();
assert.equal(window.location.href, priorUrl, 'a different snapshot invalidates the old source action');
setSemanticSelection(state.selectedInfo);
assert.equal(state.selectedInfo, null);
assert.equal(state.selected, null);
assert.equal(state.dom.selectionBody.textContent, 'None');
browser.happyDOM.abort();
console.log('Semantic selection and source opening stay coherent without a drawn instance.');
