import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateConfig } from '../../../src/config/validate.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const generatedPaths = ['docs/config/inventory.json', 'docs/config/inventory.md'];
const beforeImport = await Promise.all(generatedPaths.map(file => fs.stat(path.join(root, file))));
const { buildInventory } = await import('../../../tools/config/inventory.js');
const afterImport = await Promise.all(generatedPaths.map(file => fs.stat(path.join(root, file))));
assert.deepEqual(afterImport.map(stat => stat.mtimeMs), beforeImport.map(stat => stat.mtimeMs),
  'importing inventory helpers must not rewrite reports and mask freshness drift');

const { dir } = await prepareIsolatedTestCacheDir('config-schema-authority', { clean: false });
const positiveInteger = { type: 'integer', minimum: 1 };
const schema = {
  type: 'object', additionalProperties: false,
  properties: {
    fixtureNewSetting: positiveInteger,
    fixtureModes: { type: 'array', items: {
      type: 'object', additionalProperties: false, properties: { count: positiveInteger }
    } },
    fixtureProviders: { type: 'object', additionalProperties: {
      type: 'object', additionalProperties: false, properties: { mode: { enum: ['fast', 'full'] } }
    } }
  }
};
const schemaPath = path.join(dir, 'schema.json');
const outputJsonPath = path.join(dir, 'inventory.json');
const outputMdPath = path.join(dir, 'inventory.md');
const generate = async () => {
  await fs.writeFile(schemaPath, JSON.stringify(schema));
  await buildInventory({ root, schemaPath, outputJsonPath, outputMdPath, sourceFiles: [], check: true });
  return JSON.parse(await fs.readFile(outputJsonPath, 'utf8'));
};
const inventory = await generate();
for (const key of ['fixtureNewSetting', 'fixtureModes[].count', 'fixtureProviders.*.mode']) {
  assert.ok(inventory.allowlists.knownConfigKeys.includes(key), key + ' must derive from the schema alone');
}
assert.deepEqual(inventory.budgets, { configKeys: 2, envVars: 1, cliFlags: 72 });
assert.equal(validateConfig(schema, {
  fixtureNewSetting: 8, fixtureModes: [{ count: 2 }], fixtureProviders: { local: { mode: 'fast' } }
}).ok, true);
for (const config of [
  { fixtureNewSetting: 0 }, { fixtureNewSetting: 1.5 }, { fixtureNewSetting: '8' },
  { fixtureTypo: 8 }, { fixtureModes: [{ typo: 2 }] },
  { fixtureProviders: { local: { mode: 'invalid' } } }
]) assert.equal(validateConfig(schema, config).ok, false, JSON.stringify(config));
delete schema.properties.fixtureNewSetting;
const revised = await generate();
assert.ok(!revised.allowlists.knownConfigKeys.includes('fixtureNewSetting'),
  'removed schema settings must not survive in a stale manual allowlist');
assert.equal(validateConfig(structuredClone(schema), { fixtureNewSetting: 8 }).ok, false);
console.log('Schema-only config declarations, nested inventories, validation boundaries and import purity passed');
