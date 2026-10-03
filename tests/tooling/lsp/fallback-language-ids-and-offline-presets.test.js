import assert from 'node:assert/strict';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';
import { languageIdForFileExt } from '../../../src/integrations/tooling/lsp/client.js';

for (const ext of ['.yaml', '.yml', '.YAML', '.YML']) {
  assert.equal(languageIdForFileExt(ext), 'yaml', `${ext}: document without an explicit language ID`);
}
for (const ext of ['.sh', '.bash', '.SH', '.BASH']) {
  assert.equal(languageIdForFileExt(ext), 'shellscript', `${ext}: shell LSP identifier`);
}
assert.equal(languageIdForFileExt('.ts'), 'typescript');
assert.equal(languageIdForFileExt('.lua'), 'lua');
assert.equal(languageIdForFileExt('.unknown'), 'plaintext');
for (const key of ['yaml', 'yamlls', 'yaml-language-server']) {
  const preset = resolveLspServerPresetByKey(key);
  assert.deepEqual(preset.args, ['--stdio']);
  assert.deepEqual(preset.kinds, ['diagnostics']);
  assert.equal(preset.initializationOptions.settings.yaml.schemaStore.enable, false);
  assert.equal(preset.initializationOptions.settings.yaml.kubernetesCRDStore.enable, false);
}
console.log('YAML/shell language IDs and offline YAML auto-preset defaults passed');
