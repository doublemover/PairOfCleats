// DOM and CPU compiler controls, without browser/Worker qualification claims.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Window } from 'happy-dom';
import { parse, resolve, render, DARK_THEME } from 'reladraw';
const window = new Window({ url: 'http://localhost/map/workspace', settings: { disableJavaScriptFileLoading: true } });
for (const key of ['window', 'document', 'DOMParser', 'HTMLElement', 'SVGElement']) globalThis[key] = key === 'window' ? window : window[key];
globalThis.Option = function(text, value) { const option = document.createElement('option'); option.textContent = text; option.value = value; return option; };
const workers = [];
globalThis.Worker = class {
  constructor() { workers.push(this); }
  postMessage(request) { this.request = request; }
  terminate() { this.terminated = true; }
  complete() {
    const layout = resolve(parse(this.request.source));
    this.onmessage({ data: { svg: render(layout, { theme: DARK_THEME }),
      layout: { width: layout.width, height: layout.height, nodes: layout.nodes } } });
  }
};
const html = await fs.readFile(new URL('../../../src/map/workspace/index.html', import.meta.url), 'utf8');
document.write(html.replace(/<script[\s\S]*?<\/script>/g, ''));
await import('../../../src/map/workspace/app.js');
const $ = id => document.getElementById(id);
const settle = async () => { for (let n = 0; n < 6; n += 1) await Promise.resolve(); };
const blobs = [];
const createObjectURL = URL.createObjectURL, revokeObjectURL = URL.revokeObjectURL;
URL.createObjectURL = blob => { blobs.push(blob); return 'blob:fixture'; };
URL.revokeObjectURL = () => {};
try {
  const map = { options: {}, summary: {}, nodes: [{ path: 'a.js', name: 'A', members: [] }], edges: [] };
  await $('open').onchange({ target: { files: [{ name: 'fixture.json', size: 200, text: async () => JSON.stringify(map) }], value: '' } });
  workers.at(-1).complete(); await settle();
  const submitted = 'node snapshotA "accepted A"';
  $('source').value = submitted; $('compile').click();
  const pending = workers.at(-1);
  $('source').value = 'INVALID uncompiled B';
  pending.complete(); await settle();
  $('export-story').click();
  assert.equal(JSON.parse(await blobs.at(-1).text()).source, submitted);
  const svg = $('diagram').innerHTML;
  $('compile').click(); workers.at(-1).onmessage({ data: { error: 'expected invalid intervening edit' } }); await settle();
  assert.equal($('diagram').innerHTML, svg);
  $('export-story').click();
  assert.equal(JSON.parse(await blobs.at(-1).text()).source, submitted);
  $('source').value = 'node stale "stale"'; $('compile').click(); const stale = workers.at(-1);
  $('source').value = 'node latest "latest"'; $('compile').click(); workers.at(-1).complete();
  stale.onmessage({ data: { error: 'late obsolete compile error' } }); await settle();
  $('export-story').click();
  assert.equal(JSON.parse(await blobs.at(-1).text()).source, 'node latest "latest"');
  assert.doesNotMatch($('notice').textContent, /late obsolete/);
} finally {
  URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL;
  window.dispatchEvent(new window.Event('pagehide')); await window.happyDOM.close();
}
console.log('Story export retains the exact source of the successful mounted compile');
