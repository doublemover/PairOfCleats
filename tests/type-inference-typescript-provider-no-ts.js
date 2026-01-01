#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectTypeScriptTypes } from '../src/indexer/tooling/typescript-provider.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'typescript-provider-no-ts');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(
  path.join(srcDir, 'sample.ts'),
  'export function greet(name: string) { return `hi ${name}`; }\n'
);

const chunksByFile = new Map([
  ['src/sample.ts', [{ file: 'src/sample.ts', name: 'greet', start: 0, end: 10, docmeta: {} }]]
]);

const logs = [];
const log = (msg) => logs.push(String(msg));
const toolingConfig = {
  dir: path.join(repoRoot, '.tooling'),
  typescript: {
    enabled: true,
    resolveOrder: ['repo'],
    useTsconfig: true
  }
};

const result = await collectTypeScriptTypes({
  rootDir: repoRoot,
  chunksByFile,
  log,
  toolingConfig
});

if (!result || !(result.typesByChunk instanceof Map)) {
  console.error('TypeScript provider did not return a types map.');
  process.exit(1);
}

if (result.typesByChunk.size !== 0) {
  console.error('TypeScript provider should return empty map when module is missing.');
  process.exit(1);
}

if (!logs.some((entry) => entry.includes('TypeScript tooling not detected'))) {
  console.error('TypeScript provider missing expected fallback log message.');
  process.exit(1);
}

console.log('TypeScript provider fallback test passed');
