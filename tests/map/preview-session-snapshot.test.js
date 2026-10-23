import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { runMapPreview } from '../../tools/analysis/map-iso-preview.js';
import { MAP_DATA_PROTOCOL } from '../../src/map/isometric/client/data/protocol.js';
import { parseSavedMap } from '../../tools/analysis/map-saved-input.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-preview-snapshot-'));
const inputPath = path.join(root, 'saved 日本語.json');
const model = name => ({ version: MAP_MODEL_VERSION, root: { path: '/unavailable-source', id: 'recorded-repo' },
  nodes: [{ path: name, members: [] }], edges: [], generatedAt: '2026-10-22T00:00:00Z' });
let first, second;
const sink = { write() {} };
try {
  await fs.writeFile(inputPath, JSON.stringify(model('first.ts')));
  first = await runMapPreview({ input: inputPath, 'no-open': true }, { stdout: sink, stderr: sink });
  const before = await fetch(first.ready.url).then(response => response.text());
  assert.match(first.ready.url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(first.ready.identity.kind, 'saved-snapshot');
  assert.equal(first.ready.sourceNavigation.available, false);
  const bootstrap=JSON.parse(before.match(/<script type="application\/json" id="map-data">([\s\S]*?)<\/script>/)[1]);
  assert.equal(bootstrap.nodes.length,0,'default document contains no eager compatibility graph');
  assert.throws(()=>parseSavedMap(before),/session manifest/,'session bootstrap cannot be admitted as an empty offline graph');
  const snapshotConfig=JSON.parse(before.match(/<script type="application\/json" id="viewer-config">([\s\S]*?)<\/script>/)[1]).snapshotData;
  assert.equal(snapshotConfig.demand,true);assert.equal(snapshotConfig.manifest.counts.files,1);
  assert.match(await fetch(new URL('/map.compat.html',first.ready.url)).then(response=>response.text()),/first.ts/);
  const snapshotRequest={protocol:MAP_DATA_PROTOCOL,snapshot:snapshotConfig.snapshot,request:1,revision:0,kind:'files',cursor:0,limit:80};
  const snapshotUrl=new URL(snapshotConfig.endpoint,first.ready.url);
  assert.equal((await fetch(snapshotUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshotRequest)})).status,403);
  const firstPage=await fetch(snapshotUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Map-Session':snapshotConfig.token},body:JSON.stringify(snapshotRequest)}).then(response=>response.json());
  assert.equal(firstPage.snapshot,first.ready.snapshotSha256);assert.equal(firstPage.rows[0].path,'first.ts');assert.equal(firstPage.total,1);
  const searchRequest={...snapshotRequest,request:2,kind:'search',query:'first',entityType:'file'};
  const searchPage=await fetch(snapshotUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Map-Session':snapshotConfig.token},body:JSON.stringify(searchRequest)}).then(response=>response.json());
  assert.equal(searchPage.rows[0].file,'first.ts');assert.equal(searchPage.total,1);assert.equal(searchPage.complete,true);
  await fs.writeFile(inputPath, JSON.stringify(model('second.ts')));
  second = await runMapPreview({ input: inputPath, 'no-open': true }, { stdout: sink, stderr: sink });
  assert.equal(await fetch(first.ready.url).then(response => response.text()), before, 'earlier listener retains its committed document');
  const retainedSearch=await fetch(snapshotUrl,{method:'POST',headers:{'Content-Type':'application/json','X-Map-Session':snapshotConfig.token},body:JSON.stringify({...searchRequest,request:3})}).then(response=>response.json());
  assert.equal(retainedSearch.rows[0].file,'first.ts','cooperative source search remains pinned after saved input replacement');
  assert.match(await fetch(new URL('/map.compat.html',second.ready.url)).then(response => response.text()), /second.ts/);
  assert.notEqual(first.ready.snapshotSha256, second.ready.snapshotSha256);
  const moduleUrl = new URL('/isomap/source-index.js', first.ready.url);
  const asset = first.session.assets.get(moduleUrl.pathname);
  assert.equal(await fetch(moduleUrl).then(response => response.text()), asset.bytes.toString('utf8'));
  await assert.rejects(runMapPreview({ input: inputPath, out: path.join(root, 'x') }, { stdout: sink, stderr: sink }), /separate commands/);
  await assert.rejects(runMapPreview({ input: inputPath, port: new URL(first.ready.url).port * 1, 'no-open': true }, { stdout: sink, stderr: sink }), /EADDRINUSE/);
  const originalClose = first.close();
  assert.equal(first.close(), originalClose, 'actual preview callers share the original shutdown flight');
  await originalClose;
  assert.equal(first.resourceOwner.pending, false, 'actual listener and accepted handlers have returned before pins retire');
} finally {
  await first?.close(); await second?.close();
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Saved preview sessions pin independent documents and module bytes without a current index.');
