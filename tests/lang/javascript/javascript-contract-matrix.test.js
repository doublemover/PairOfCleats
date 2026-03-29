#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildJsChunks, buildCodeRelations, collectImports } from '../../../src/lang/javascript.js';
import { extractDocMeta } from '../../../src/lang/javascript/docmeta.js';
import { applyCrossFileInference } from '../../../src/index/type-inference-crossfile/pipeline.js';

const cases = [
  {
    name: 'collectImports extracts static, export, require, and dynamic imports',
    async run() {
      const source = [
        "import fs from 'fs';",
        "import { join as joinPath } from 'path';",
        "export * from 'module-a';",
        "export { foo } from 'module-b';",
        "const mod = require('module-c');",
        "async function load() { return import('module-d'); }"
      ].join('\n');

      const imports = collectImports(source).slice().sort();
      const expected = ['fs', 'path', 'module-a', 'module-b', 'module-c', 'module-d'].sort();
      assert.deepEqual(imports, expected);
    }
  },
  {
    name: 'buildJsChunks discovers common function and class shapes',
    async run() {
      const source = [
        'export function alpha() {}',
        'class Foo {',
        '  method() {}',
        '  static bar() {}',
        '}',
        'const beta = () => {};',
        'export default function gamma() {}',
        'exports.qux = function() {};'
      ].join('\n');

      const chunks = buildJsChunks(source) || [];
      const names = new Set(chunks.map((chunk) => chunk.name));
      for (const name of ['alpha', 'Foo', 'Foo.method', 'Foo.bar', 'beta', 'gamma']) {
        assert.ok(names.has(name), `missing JS chunk ${name}`);
      }
      assert.ok(names.has('exports.qux') || names.has('qux'), 'missing assignment function chunk');
    }
  },
  {
    name: 'buildCodeRelations preserves imports, calls, and exports',
    async run() {
      const source = [
        "import { readFile } from 'fs';",
        'export function run(path) {',
        '  return readFile(path);',
        '}',
        'const local = () => run("x");',
        'module.exports = { run };'
      ].join('\n');

      const rel = buildCodeRelations(source, 'sample.js', { fs: ['fs.js'] }) || {};
      const calls = Array.isArray(rel.calls) ? rel.calls : [];
      const imports = Array.isArray(rel.imports) ? rel.imports : [];
      const exportsList = Array.isArray(rel.exports) ? rel.exports : [];

      assert.ok(calls.some(([from, to]) => from === 'run' && to === 'readFile'));
      assert.ok(imports.includes('fs'));
      assert.ok(exportsList.includes('run'));
      assert.ok(exportsList.includes('default'));
    }
  },
  {
    name: 'docmeta and cross-file call summaries use stable placeholder param names',
    async run() {
      const text = `function f({a,b}, x=1, ...rest) {}
 f({a:1,b:2}, 2, 3);
`;
      const relPath = 'src/sample.js';
      const relations = buildCodeRelations(text, relPath, { dataflow: false, controlFlow: false });

      const fnStart = text.indexOf('function f');
      const fnEnd = text.indexOf('}', fnStart);
      const fnChunk = { start: fnStart, end: fnEnd + 1, name: 'f' };
      const docmeta = extractDocMeta(text, fnChunk, relations);
      assert.deepEqual(docmeta.paramNames, ['arg0', 'x', 'rest']);

      const functionChunk = {
        name: 'f',
        file: relPath,
        kind: 'Function',
        chunkUid: 'uid-f',
        docmeta,
        metaV2: {
          symbol: {
            symbolId: 'sym-f',
            chunkUid: 'uid-f',
            symbolKey: 'sym:f',
            signatureKey: 'sig:f',
            kindGroup: 'function',
            qualifiedName: 'f'
          }
        }
      };

      const moduleChunk = {
        name: '(module)',
        file: relPath,
        kind: 'Module',
        chunkUid: 'uid-module',
        docmeta: {},
        codeRelations: relations
      };

      await applyCrossFileInference({
        rootDir: process.cwd(),
        buildRoot: process.cwd(),
        chunks: [moduleChunk, functionChunk],
        enabled: true,
        log: () => {},
        useTooling: false,
        enableTypeInference: false,
        enableRiskCorrelation: false,
        fileRelations: null
      });

      const summary = (moduleChunk.codeRelations?.callSummaries || []).find((entry) => entry?.name === 'f');
      assert.ok(summary, 'call summary for f missing');
      assert.deepEqual(summary.params, ['arg0', 'x', 'rest']);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('javascript contract matrix test passed');
