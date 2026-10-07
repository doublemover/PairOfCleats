import assert from 'node:assert/strict';
import { createLspConfigurationHandler } from '../../../src/integrations/tooling/lsp/configuration.js';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';

assert.equal(createLspConfigurationHandler(null), null);
assert.equal(createLspConfigurationHandler({ settings: [] }), null);
const preset = resolveLspServerPresetByKey('yaml');
const handler = createLspConfigurationHandler(preset.initializationOptions);
const request = (items) => handler({ method: 'workspace/configuration', params: { items } });
assert.deepEqual(await request([
  { section: 'yaml', scopeUri: 'file:///untrusted/ignored/path' },
  { section: 'yaml.schemaStore.enable' },
  { section: 'yaml.kubernetesCRDStore.enable' },
  { section: 'absent' }
]), [preset.initializationOptions.settings.yaml, false, false, null]);
assert.deepEqual(await request([
  { section: '__proto__' }, { section: 'constructor' }, { section: 'yaml.__proto__' }, { section: 'toString' }
]), [null, null, null, null]);
assert.deepEqual(await request(null), []);
assert.equal((await request(Array.from({ length: 64 }, () => ({ section: 'yaml' })))).length, 64);
await assert.rejects(request(Array.from({ length: 65 }, () => ({}))), { code: -32602 });
assert.equal(await handler({ method: 'workspace/unrelated' }), null);
const custom = createLspConfigurationHandler({ settings: { '[yaml]': { tabSize: 2 }, 'http.proxy': '' } });
assert.deepEqual(await custom({ method: 'workspace/configuration', params: { items: [
  { section: '[yaml]' }, { section: 'http.proxy' }, { section: '' }
] } }), [{ tabSize: 2 }, '', { '[yaml]': { tabSize: 2 }, 'http.proxy': '' }]);
console.log('LSP configured settings requests are bounded and workspace-independent');
