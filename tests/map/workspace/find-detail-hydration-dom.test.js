/** Actual workspace event handlers with DOM emulation and inert transport. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
const window = new Window({ url: 'http://localhost/map/workspace', settings: { disableJavaScriptFileLoading: true } });
for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'SVGElement']) globalThis[key] = key === 'window' ? window : window[key];
globalThis.Option = function(text, value) { const option = document.createElement('option'); option.textContent = text; option.value = value; return option; };
globalThis.Worker = class { constructor() { throw new Error('inert optional compiler unavailable'); } };
const originalFetch = globalThis.fetch, pending = [];
globalThis.fetch = (url, options) => new Promise(resolve => { pending.push({ url, options, resolve }); });
const generation = { baseBuildId: 'canonical-find-build', semanticRevision: 0 };
const ref = localId => ({ partitionId: `sy1:${'c'.repeat(64)}`, localId });
const row = (localId, operation) => ({ id: localId, kind: 'expression', ref: ref(localId), data: { operation } });
const result = (records, extra = {}) => ({ generation, records, coverage: {}, ...extra });
const html = await fs.readFile(new URL('../../../src/map/workspace/index.html', import.meta.url), 'utf8');
document.write(html.replace(/<script[\s\S]*?<\/script>/g, ''));
await import('../../../src/map/workspace/app.js');
const $ = id => document.getElementById(id);
try {
  $('operation').value = 'find'; $('request').value = JSON.stringify({ repoRoot: '/selected/source-repo', request: { generation, operation: 'send' } });
  const finding = $('run').onclick();
  assert.equal(pending.at(-1).url, '/analysis/semantic-find');
  pending.at(-1).resolve(new Response(JSON.stringify({ result: result([row(0, 'send'), row(2, 'other candidate')]) })));
  await finding; $('tree').querySelector('button').click();
  let detailButton = [...$('detail').querySelectorAll('button')].find(button => button.textContent === 'Load semantic detail');
  assert(detailButton, 'canonical find row without a row generation hydrates from its pinned envelope');
  const originalButton = detailButton, before = pending.length;
  [...$('tree').querySelectorAll('button')].find(button => button.textContent.startsWith('other candidate')).click();
  assert.equal((await originalButton.onclick()).reason, 'superseded'); assert.equal(pending.length, before, 'a removed picker action cannot hydrate after another selection in the same generation');
  [...$('tree').querySelectorAll('button')].find(button => button.textContent.startsWith('send')).click();
  assert.equal((await originalButton.onclick()).reason, 'superseded'); assert.equal(pending.length, before, 'reselecting identical source fields does not restore an old action publication');
  detailButton = [...$('detail').querySelectorAll('button')].find(button => button.textContent === 'Load semantic detail');
  const detailing = detailButton.onclick();
  const detailRequest = pending.at(-1);
  assert.equal(detailRequest.url, '/analysis/semantic-detail');
  const input = JSON.parse(detailRequest.options.body);
  assert.equal(input.repoRoot, '/selected/source-repo'); assert.deepEqual(input.generation, generation); assert.deepEqual(input.refs, [ref(0)]);
  detailRequest.resolve(new Response(JSON.stringify({ result: result([row(0, 'send'), row(1, 'argument')], {
    operands: [{ parent: ref(0), child: ref(1), slot: 'argument', ordinal: 0 }]
  }) })));
  await detailing;
  [...$('tree').querySelectorAll('button')].find(button => button.textContent.startsWith('send')).click();
  assert([...$('detail').querySelectorAll('button')].some(button => button.textContent.includes('operand:argument')));
  const currentNotice = $('notice').textContent;
  const mismatch = [...$('detail').querySelectorAll('button')].find(button => button.textContent === 'Load semantic detail').onclick();
  pending.at(-1).resolve(new Response(JSON.stringify({ result: { ...result([row(0, 'wrong generation')]), generation: { ...generation, baseBuildId: 'sibling-build' } } })));
  const failure = await mismatch;
  assert.equal(failure.ok, false); assert.match($('notice').textContent, /Generation mismatch/);
  assert.notEqual($('notice').textContent, currentNotice); assert.match($('tree').textContent, /argument/); assert.doesNotMatch($('tree').textContent, /wrong generation/);
} finally { window.dispatchEvent(new window.Event('pagehide')); globalThis.fetch = originalFetch; await window.happyDOM.close(); }
console.log('Canonical find results hydrate exact selected-repository detail and original operands.');
