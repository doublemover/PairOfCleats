import assert from 'node:assert/strict';
import { createResponseFindController, FIND_PREVIEW_LIMIT, entityFindText } from '../../../src/map/workspace/find.js';
import { projectOutput, VIEW_LIMITS } from '../../../src/map/workspace/projection.js';

let detailCopies = 0, yields = 0;
const rows = Array.from({ length: 10000 }, (_, index) => ({
  name: index % 200 === 0 ? 'needle' : `name-${index}`, file: `src/${index}.js`,
  get evidence() { detailCopies++; return { original: index }; }
}));
const input = { code: rows, prose: [{ name: 'needle', file: 'README.md' }], pagination: { nextCursor: 'server-page-unloaded' } };
const finder = createResponseFindController({ yieldTask: async () => { yields++; } });
assert.equal(finder.replace(input, 'response-A'), 10001);
assert.equal(detailCopies, 0, 'indexing stores scalar labels/locators without hydrating any rich row');
const all = await finder.find('needle', { scope: 'loaded' });
assert.equal(all.responseIdentity, 'response-A');
assert.equal(all.count, 51);
assert.equal(all.preview.length, FIND_PREVIEW_LIMIT);
assert.equal(all.visited, 10001);
assert.ok(yields > 0, 'loaded response scanning yields bounded cooperative tasks');
assert.equal(detailCopies, 0, 'find never rehydrates response details');
for (const position of [0, 25, 49, 50]) {
  const match = all.at(position);
  const before = detailCopies;
  const projection = projectOutput(input, { page: match.page });
  const node = projection.nodes.find(node => node.id === match.id);
  assert.ok(node, 'locator selects the exact admitted identity on its original page');
  assert.ok(entityFindText(node).includes('needle'));
  assert.equal(node.detail.mode, match.mode);
  assert.equal(node.detail.file, match.file);
  assert.equal(node.detail.originalRank, match.originalRank);
  assert.ok(detailCopies - before <= VIEW_LIMITS.nodes);
  assert.equal(projection.cursor, 'server-page-unloaded');
}
const page = await finder.find('needle', { scope: 'page', page: 25 });
assert.equal(page.count, 1);
assert.equal(page.visited, 200);
assert.equal(page.at(0).originalRank, 5001);
assert.equal(all.at(0), null, 'new find work invalidates earlier navigation authority');
const none = await finder.find('not-present-anywhere', { scope: 'loaded' });
assert.equal(none.count, 0);
assert.equal(none.scope, 'loaded', 'zero matches describes loaded response only');

const pendingYields = [];
const pendingFinder = createResponseFindController({ yieldTask: () => new Promise(resolve => pendingYields.push(resolve)) });
pendingFinder.replace(input, 'response-old');
const pending = pendingFinder.find('needle', { scope: 'loaded' });
assert.equal(pendingYields.length, 1);
pendingFinder.replace({ code: [{ name: 'replacement', file: 'new.js' }] }, 'response-new');
pendingYields.shift()();
assert.equal(await pending, null, 'response replacement fences a running scan even with identical backend generation');
const replacement = await pendingFinder.find('replacement', { scope: 'loaded' });
assert.equal(replacement.responseIdentity, 'response-new');
pendingFinder.cancel();
assert.equal(replacement.at(0), null);
pendingFinder.dispose();
assert.equal(await pendingFinder.find('replacement'), null);

const map = { options: {}, summary: {}, generation: 'map-generation', nodes: [
  { path: 'parent.js', name: 'parent', members: Array.from({ length: 450 }, (_, index) => ({ id: `member-${index}`, name: 'duplicate label', kind: 'function' })) }
], edges: [] };
finder.replace(map, 'map-response');
const lateMember = await finder.find('member-449', { scope: 'loaded' });
assert.equal(lateMember.at(0).parentId, 'file:parent.js');
assert.equal(lateMember.at(0).file, 'parent.js');
assert.equal(lateMember.at(0).page, 2);
assert.equal(projectOutput(map, { page: 2 }).nodes[0].parentId, 'file:parent.js', 'paged-out parents stay explicit');

const catalog = { kind: 'artifact-catalog', generation: 'catalog-generation', artifacts: Array.from({ length: 503 }, (_, index) => ({ name: `artifact-${index}`, family: 'rows' })) };
finder.replace(catalog, 'artifact-response');
const last = await finder.find('artifact-502', { scope: 'loaded' });
assert.equal(last.at(0).page, 2);
assert.equal(last.at(0).id, 'artifact:artifact-502');
assert.equal(projectOutput(catalog, { page: last.at(0).page }).nodes.find(node => node.id === last.at(0).id).detail, catalog.artifacts[502]);
finder.replace({ code: [] }, 'empty-response');
assert.equal((await finder.find('anything', { scope: 'loaded' })).count, 0);
finder.dispose();
console.log('Loaded response find preserves page/rank/identity, lazy details, bounded previews and stale-work fencing.');
