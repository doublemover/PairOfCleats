#!/usr/bin/env node
import assert from 'node:assert/strict';
import { collectLanguageImports } from '../src/index/language-registry.js';

const text = [
  "import type { Foo } from 'flow-lib';",
  'type Foo = { value: string };'
].join('\n');

const withFlow = collectLanguageImports({
  ext: '.js',
  relPath: 'src/flow.js',
  text,
  mode: 'code',
  options: { flowMode: 'on' }
});

assert.ok(withFlow.includes('flow-lib'), 'expected flow import with flowMode=on');

const withoutFlow = collectLanguageImports({
  ext: '.js',
  relPath: 'src/flow.js',
  text,
  mode: 'code'
});

assert.ok(!withoutFlow.includes('flow-lib'), 'expected no flow imports without flowMode');

console.log('imports options forwarding flowmode test passed');
