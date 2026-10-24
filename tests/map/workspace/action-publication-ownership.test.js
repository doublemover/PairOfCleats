/** DOM emulation and inert fetch/worker boundaries; no browser qualification. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { captureWorkspaceFailure } from '../../../src/map/workspace/request.js';
const window = new Window({ url: 'http://localhost/map/workspace', settings: { disableJavaScriptFileLoading: true } });
for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'SVGElement']) globalThis[key] = key === 'window' ? window : window[key];
globalThis.Option = function(text, value) { const option = document.createElement('option'); option.textContent = text; option.value = value; return option; };
globalThis.Worker = class { constructor() { throw new Error('inert optional compiler unavailable'); } };
const originalFetch = globalThis.fetch, pending = [];
globalThis.fetch = (url, options) => new Promise((resolve, reject) => { pending.push({ url, options, resolve, reject }); });
const response = data => {
  const bytes = new TextEncoder().encode(JSON.stringify(data)); let read = false;
  return { ok: true, body: { getReader: () => ({ async read() {
    if (read) return { done: true }; read = true; return { done: false, value: bytes };
  }, async cancel() {}, releaseLock() {} }) } };
};
const html = await fs.readFile(new URL('../../../src/map/workspace/index.html', import.meta.url), 'utf8');
document.write(html.replace(/<script[\s\S]*?<\/script>/g, ''));
await import('../../../src/map/workspace/app.js');
const $ = id => document.getElementById(id);
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const source = label => ({ code: [{ name: label, file: `${label}.js` }] });
const load = data => $('open').onchange({ target: { files: [{ name: 'saved.json', size: 100, text: async () => JSON.stringify(data) }], value: '' } });
const query = () => { $('operation').value = 'search'; $('request').value = '{}'; return $('run').onclick(); };
try {
  await load(source('initial'));
  let rejectOlder;
  const older = $('open').onchange({ target: { files: [{ name: 'older.json', size: 100, text: () => new Promise((_resolve, reject) => { rejectOlder = reject; }) }], value: '' } });
  await load(source('newer')); const currentNotice = $('notice').textContent;
  rejectOlder(undefined); const oldFailure = await older;
  assert.equal(oldFailure.reason, 'superseded'); assert.equal(oldFailure.primaryError, undefined);
  assert.equal($('notice').textContent, currentNotice); assert.match($('diagram').textContent, /newer/);

  // A later query intent owns publication even before its fetch completes.
  let releaseFile;
  const file = $('open').onchange({ target: { files: [{ name: 'slow-file.json', size: 100,
    text: () => new Promise(resolve => { releaseFile = resolve; }) }], value: '' } });
  const fetching = query(); releaseFile(JSON.stringify(source('obsolete file'))); await file;
  assert.doesNotMatch($('diagram').textContent, /obsolete file/);
  pending.at(-1).resolve(response(source('query winner'))); await fetching;
  assert.match($('diagram').textContent, /query winner/);

  // A newer saved file suppresses an obsolete failed request's UI. Its exact
  // frozen primary remains in the obsolete handler's returned evidence.
  let reads = 0;
  const hostile = Object.freeze(Object.defineProperty({}, 'message', { get() { reads++; throw false; } }));
  const oldQuery = query(), request = pending.at(-1);
  await load(source('saved winner')); assert.equal(request.options.signal.aborted, true);
  const savedNotice = $('notice').textContent; request.reject(hostile);
  const oldQueryFailure = await oldQuery;
  assert.equal(oldQueryFailure.primaryError, hostile); assert.equal(oldQueryFailure.reason, 'superseded');
  assert.equal(reads, 0); assert.equal($('notice').textContent, savedNotice); assert.match($('diagram').textContent, /saved winner/);

  let completeCancelled;
  const cancelled = $('open').onchange({ target: { files: [{ name: 'cancelled.json', size: 100,
    text: () => new Promise(resolve => { completeCancelled = resolve; }) }], value: '' } });
  $('cancel').onclick(); const cancelledNotice = $('notice').textContent;
  completeCancelled(JSON.stringify(source('cancelled file'))); assert.equal((await cancelled).reason, 'superseded');
  assert.equal($('notice').textContent, cancelledNotice); assert.match($('diagram').textContent, /saved winner/);

  // Removed original semantic buttons cannot submit a request in a new page or
  // generation merely because its original identity fields happen to match.
  const semantic = { records: [{ id: 0, kind: 'function', ref: { partitionId: `sy1:${'a'.repeat(64)}`, localId: 0 }, data: { operation: 'original operation' } }],
    generation: { baseBuildId: 'original-build', semanticRevision: 0 }, coverage: {} };
  await load(semantic); await settle(); $('tree').querySelector('button').click();
  const oldButton = [...$('detail').querySelectorAll('button')].find(button => button.textContent === 'Load semantic detail');
  assert(oldButton); await load(source('replacement response')); const count = pending.length;
  assert.equal((await oldButton.onclick()).reason, 'superseded'); assert.equal(pending.length, count);

  // Current falsey failures have passive, stable diagnostics and exact causes.
  const currentFailure = await $('open').onchange({ target: { files: [{ name: 'failed.json', size: 100, text: async () => { throw false; } }], value: '' } });
  assert.equal(currentFailure.primaryError, false); assert.match($('notice').textContent, /Workspace action failed/);
  const captured = captureWorkspaceFailure(hostile); assert.equal(reads, 0); assert.equal(captured.primary, hostile);
  assert.equal(captureWorkspaceFailure(hostile), captured);
} finally { window.dispatchEvent(new window.Event('pagehide')); globalThis.fetch = originalFetch; await window.happyDOM.close(); }
console.log('Workspace file/query/semantic actions preserve original publication and stale failure ownership.');
