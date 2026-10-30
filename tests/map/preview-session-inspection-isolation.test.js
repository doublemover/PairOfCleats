import assert from 'node:assert/strict';
import { createMapPreviewSessionView, freezeMapPreviewMetadata } from '../../tools/analysis/map-preview-session-view.js';
const original = Buffer.from('original module'), html = Buffer.from('original document');
const identity = { repo: { id: 'original-repo' }, selectedIndex: { buildId: 'original-build' }, options: { include: ['original/**'] } };
const session = { assets: new Map([['/module.js', { bytes: original, sha256: 'original-hash', contentType: 'text/javascript' }]]),
  html, identity, totalBytes: original.length, unavailable: [{ route: '/missing.jpg', reason: 'not installed' }],
  documentSha256: 'original-document-hash', snapshotSha256: 'original-snapshot-hash' };
const view = createMapPreviewSessionView(session);
assert.equal(view.assets.size, 1); assert.deepEqual([...view.assets.keys()], ['/module.js']);
assert(view.assets.has('/module.js')); assert.equal(view.assets.get('/missing.js'), undefined);
assert.equal(view.assets.clear, undefined); assert.equal(view.assets.delete, undefined); assert.equal(view.assets.set, undefined);
for (const asset of [view.assets.get('/module.js'), ...view.assets.values(), ...[...view.assets.entries()].map(([, value]) => value), ...[...view.assets].map(([, value]) => value)]) {
  asset.bytes.fill(0); assert.throws(() => { asset.sha256 = 'sibling'; }, TypeError);
}
view.html.fill(0);
assert.equal(original.toString(), 'original module'); assert.equal(html.toString(), 'original document');
assert.throws(() => { view.identity.repo.id = 'sibling'; }, TypeError);
assert.throws(() => { view.identity.options.include.push('sibling/**'); }, TypeError);
assert.throws(() => { view.unavailable[0].reason = 'invented success'; }, TypeError);
assert.equal(session.identity.selectedIndex.buildId, 'original-build');
session.assets.clear(); session.html = Buffer.alloc(0);
assert.equal(view.assets.size, 0); assert.equal(view.html.length, 0);
const metadata = {}; metadata.self = metadata; freezeMapPreviewMetadata(metadata);
assert.equal(metadata.self, metadata); assert(Object.isFrozen(metadata), 'metadata traversal is cycle safe without serializing graph data');
console.log('Preview inspection retains original metadata and privately served document/module bytes.');
