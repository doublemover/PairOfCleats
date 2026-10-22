import assert from 'node:assert/strict';
import { MAP_MODEL_VERSION } from '../../src/map/constants.js';
import { renderIsometricHtml } from '../../src/map/isometric-viewer.js';
import { createMapCacheEnvelope } from '../../src/shared/generated-artifact.js';
import { parseSavedMap } from '../../tools/analysis/map-saved-input.js';

const model = { version: MAP_MODEL_VERSION, root: { path: '/missing checkout', id: 'repo:opaque' },
  nodes: [{ path: 'src/日本語.ts', members: [{ id: 0, name: 'zero' }] }], edges: [],
  provenance: { selectedIndex: { manifest: 'recorded-manifest' } } };
const json = parseSavedMap(JSON.stringify(model));
assert.deepEqual(json.model, model);
assert.equal(json.provenance.kind, 'saved-snapshot');
assert.equal(json.provenance.generationHealth, 'not-revalidated');
const html = renderIsometricHtml({ mapModel: model, threeUrl: '/three/three.module.js' });
const hostile = html.replace('</head>', '<script>globalThis.unsafeImportedScript=true</script></head>');
assert.deepEqual(parseSavedMap(hostile).model, model, 'HTML contributes data, never executable script');
assert.equal(globalThis.unsafeImportedScript, undefined);
assert.equal(parseSavedMap(JSON.stringify(createMapCacheEnvelope(model, 'a'.repeat(64)))).inputType, 'generated-map-cache');
assert.throws(() => parseSavedMap(JSON.stringify({ ok: true, summary: {} })), /not a map model/);
assert.throws(() => parseSavedMap(JSON.stringify({ ...model, version: '99.0.0' })), /Unsupported map model version/);
assert.throws(() => parseSavedMap(html + html), /one generated/);
assert.throws(() => parseSavedMap('{"nested":' + '['.repeat(65)), /depth/);
assert.throws(() => parseSavedMap(JSON.stringify({ ...model, nodes: [model.nodes[0], model.nodes[0]] })), /unique bounded paths/);
assert.throws(() => parseSavedMap(JSON.stringify({ ...model, nodes: [{ path: 'x', members: [{ id: 0 }, { id: '0' }] }] })), /Duplicate map member identity/);
console.log('Saved model/cache/HTML data admission preserves recorded provenance without requiring an index.');
