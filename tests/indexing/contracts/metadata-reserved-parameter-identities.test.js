import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const names = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype'];
const paramTypes = JSON.parse(JSON.stringify(Object.fromEntries(names.map(name => [name, 'string']))));
const params = JSON.parse(JSON.stringify(Object.fromEntries(names.map(name => [name, [
  { type: 'number', source: 'tooling', confidence: 0.9 }, { type: 'boolean', source: 'heuristic', confidence: 0.5 }
]]))));
const metadata = buildMetaV2({ chunk: { file: 'input.js', name: 'actual', kind: 'FunctionDeclaration', start: 0, end: 10 },
  docmeta: { paramTypes, inferredTypes: { params } } });
const verify = meta => {
  for (const [category, type] of [['declared', 'string'], ['tooling', 'number'], ['inferred', 'boolean']]) {
    const map = meta.types[category].params;
    assert.equal(Object.getPrototypeOf(map), Object.prototype);
    assert.deepEqual(Object.keys(map).sort(), names.toSorted());
    for (const name of names) {
      assert.ok(Object.hasOwn(map, name), `${category}: ${name} is an own parameter key`);
      assert.equal(map[name][0].type, type);
    }
  }
};
verify(metadata); verify(JSON.parse(JSON.stringify(metadata)));
const { dir } = await prepareIsolatedTestCacheDir('metadata-reserved-parameter-identities');
try {
  const output = path.join(dir, 'metadata.json');
  await writeJsonObjectFile(output, { fields: { metaV2: metadata }, atomic: true });
  verify(JSON.parse(await fs.readFile(output, 'utf8')).metaV2);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
assert.equal(Object.getPrototypeOf({}), Object.prototype);
console.log('Declared, inferred and tooling parameter names remain own reserved keys through canonical metadata writing');
