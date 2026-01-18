#!/usr/bin/env node
import { collectTypeScriptImports } from '../src/lang/typescript.js';
import { smartChunk } from '../src/index/chunking.js';

const text = "import type { Foo } from 'foo';\nexport = ???";
let imports = [];
try {
  imports = collectTypeScriptImports(text, {
    parser: 'babel',
    typescript: { importsOnly: true }
  });
} catch (err) {
  console.error(`typescript imports-only test failed: ${err?.message || err}`);
  process.exit(1);
}

if (!imports.includes('foo')) {
  console.error('typescript imports-only test failed: missing import');
  process.exit(1);
}

const chunks = smartChunk({
  text: 'export interface Foo { bar: string }',
  ext: '.ts',
  relPath: 'foo.ts',
  mode: 'code',
  context: { typescript: { importsOnly: true } }
});

if (!Array.isArray(chunks) || chunks.length === 0) {
  console.error('typescript imports-only test failed: chunker returned empty.');
  process.exit(1);
}

console.log('typescript imports-only test passed');
