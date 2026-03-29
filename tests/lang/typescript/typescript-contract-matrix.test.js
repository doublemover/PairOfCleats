#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { smartChunk } from '../../../src/index/chunking.js';
import { buildJsChunks, collectImports } from '../../../src/lang/javascript.js';
import { buildTypeScriptChunks, collectTypeScriptImports } from '../../../src/lang/typescript.js';

const fixtureRoot = path.join(process.cwd(), 'tests', 'fixtures', 'languages', 'src');

const readFixture = (name) => {
  const filePath = path.join(fixtureRoot, name);
  assert.ok(fs.existsSync(filePath), `missing fixture file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
};

const cases = [
  {
    name: 'importsOnly still extracts imports and produces chunks',
    run() {
      const text = "import type { Foo } from 'foo';\nexport = ???";
      const imports = collectTypeScriptImports(text, {
        parser: 'babel',
        typescript: { importsOnly: true }
      });
      assert.ok(imports.includes('foo'));

      const chunks = smartChunk({
        text: 'export interface Foo { bar: string }',
        ext: '.ts',
        relPath: 'foo.ts',
        mode: 'code',
        context: { typescript: { importsOnly: true } }
      });
      assert.ok(Array.isArray(chunks) && chunks.length > 0);
    }
  },
  {
    name: 'parser selection supports heuristic, babel, and typescript backends',
    run() {
      const sample = 'export function foo(a: number): string { return String(a); }';
      const heuristicChunks = buildTypeScriptChunks(sample, { parser: 'heuristic' });
      const babelChunks = buildTypeScriptChunks(sample, { parser: 'babel' });
      const tsChunks = buildTypeScriptChunks(sample, { parser: 'typescript', rootDir: process.cwd() });

      assert.ok(Array.isArray(heuristicChunks) && heuristicChunks.length > 0);
      assert.ok(Array.isArray(babelChunks) && babelChunks.length > 0);
      assert.ok(Array.isArray(tsChunks) && tsChunks.length > 0);
    }
  },
  {
    name: 'tsx, mts, cts, jsx, and flow fixtures remain parseable',
    run() {
      const tsxText = readFixture('typescript_component.tsx');
      const tsxChunks = buildTypeScriptChunks(tsxText) || [];
      assert.ok(tsxChunks.some((chunk) => chunk.name === 'FancyWidget'));

      const mtsImports = collectTypeScriptImports(readFixture('typescript_imports.mts'));
      for (const mod of ['lib-alpha', 'lib-beta', 'lib-gamma', 'lib-delta']) {
        assert.ok(mtsImports.includes(mod), `missing mts import ${mod}`);
      }

      const ctsImports = collectTypeScriptImports(readFixture('typescript_commonjs.cts'));
      assert.ok(ctsImports.includes('legacy-lib'));

      const jsxText = readFixture('javascript_component.jsx');
      const jsxChunks = buildJsChunks(jsxText) || [];
      assert.ok(jsxChunks.some((chunk) => chunk.name === 'App'));
      assert.ok(jsxChunks.some((chunk) => chunk.name === 'Button'));

      const flowText = readFixture('javascript_flow.js');
      const flowChunks = buildJsChunks(flowText, {
        ext: '.js',
        javascript: { parser: 'babel', flow: 'auto' },
        flowMode: 'auto'
      }) || [];
      assert.ok(flowChunks.some((chunk) => chunk.name === 'greet'));

      const flowImports = collectImports(flowText, {
        ext: '.js',
        javascript: { parser: 'babel', flow: 'auto' },
        flowMode: 'auto'
      });
      assert.ok(flowImports.includes('flow-parser'));
      assert.ok(flowImports.includes('./types'));
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('TypeScript contract matrix test passed');
