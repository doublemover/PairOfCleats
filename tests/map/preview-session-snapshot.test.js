import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { runMapPreview } from '../../tools/analysis/map-iso-preview.js';

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
  assert.match(before, /first.ts/);
  await fs.writeFile(inputPath, JSON.stringify(model('second.ts')));
  second = await runMapPreview({ input: inputPath, 'no-open': true }, { stdout: sink, stderr: sink });
  assert.equal(await fetch(first.ready.url).then(response => response.text()), before, 'earlier listener retains its committed document');
  assert.match(await fetch(second.ready.url).then(response => response.text()), /second.ts/);
  assert.notEqual(first.ready.snapshotSha256, second.ready.snapshotSha256);
  const moduleUrl = new URL('/isomap/source-index.js', first.ready.url);
  const asset = first.session.assets.get(moduleUrl.pathname);
  assert.equal(await fetch(moduleUrl).then(response => response.text()), asset.bytes.toString('utf8'));
  await assert.rejects(runMapPreview({ input: inputPath, out: path.join(root, 'x') }, { stdout: sink, stderr: sink }), /separate commands/);
  await assert.rejects(runMapPreview({ input: inputPath, port: new URL(first.ready.url).port * 1, 'no-open': true }, { stdout: sink, stderr: sink }), /EADDRINUSE/);
} finally {
  await first?.close(); await second?.close();
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Saved preview sessions pin independent documents and module bytes without a current index.');
