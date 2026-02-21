#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';

applyTestEnv();

const CASES = [
  { id: 'ini', ext: '.ini', text: '[server]\nport=8080\n' },
  {
    id: 'json',
    ext: '.json',
    text: '{"schema":"./schema.json","server":{"configPath":"./server.json"}}\n',
    expectedImports: ['keypath:schema', 'keypath:server', 'keypath:server.configPath', './schema.json', './server.json']
  },
  {
    id: 'toml',
    ext: '.toml',
    text: '[dependencies]\nserde = "1.0"\nlocal = { path = "../local" }\n',
    expectedImports: ['dependency:serde', 'dependency:local', '../local']
  },
  { id: 'xml', ext: '.xml', text: '<config><server port="8080"/></config>\n' },
  {
    id: 'yaml',
    ext: '.yaml',
    text: 'defaults: &base\nservice:\n  <<: *base\ninclude:\n  - ./base.yml\n',
    expectedImports: ['anchor:base', 'alias:base', './base.yml']
  }
];

for (const testCase of CASES) {
  const adapter = LANGUAGE_REGISTRY.find((entry) => entry.id === testCase.id);
  assert.ok(adapter, `missing language adapter for ${testCase.id}`);

  const relations = adapter.buildRelations({ text: testCase.text, options: {} }) || {};
  assert.ok(Array.isArray(relations.imports), `${testCase.id} buildRelations should return imports array`);
  assert.ok(Array.isArray(relations.exports), `${testCase.id} buildRelations should return exports array`);
  assert.ok(Array.isArray(relations.calls), `${testCase.id} buildRelations should return calls array`);
  assert.ok(Array.isArray(relations.usages), `${testCase.id} buildRelations should return usages array`);
  if (Array.isArray(testCase.expectedImports)) {
    assert.deepEqual(
      new Set(relations.imports),
      new Set(testCase.expectedImports),
      `${testCase.id} buildRelations imports mismatch`
    );
  }

  const docmeta = adapter.extractDocMeta({
    chunk: {
      start: 0,
      end: testCase.text.length,
      name: 'root'
    },
    text: testCase.text,
    options: { ext: testCase.ext }
  });

  assert.ok(docmeta && typeof docmeta === 'object' && !Array.isArray(docmeta), `${testCase.id} docmeta must be object`);
}

console.log('config-data adapters contract test passed');
