#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getRepoCacheRoot } from '../../tools/dict-utils/paths/repo.js';
import { queryNavigationData } from '../../tools/tooling/navigation.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-navigation-query-'));
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const srcDir = path.join(repoRoot, 'src');
await fs.mkdir(srcDir, { recursive: true });
await fs.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({
    cache: {
      root: cacheRoot
    }
  }, null, 2)
);

const defsSource = 'export function WidgetBuilder() {\n  return 1;\n}\nWidgetBuilder();\n';
const refsSource = 'import { WidgetBuilder } from "./defs.js";\nWidgetBuilder();\n';
await fs.writeFile(path.join(srcDir, 'defs.js'), defsSource);
await fs.writeFile(path.join(srcDir, 'refs.js'), refsSource);

const repoCacheRoot = getRepoCacheRoot(repoRoot);
const indexDir = path.join(repoCacheRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });

const secondRefStart = refsSource.lastIndexOf('WidgetBuilder');
const secondRefEnd = secondRefStart + 'WidgetBuilder'.length;

await fs.writeFile(
  path.join(indexDir, 'chunk_meta.json'),
  JSON.stringify([
    {
      id: 1,
      start: 0,
      end: defsSource.length,
      file: path.join(srcDir, 'defs.js'),
      virtualPath: 'src/defs.js',
      startLine: 1,
      endLine: 3,
      kind: 'FunctionDeclaration',
      name: 'WidgetBuilder',
      chunkUid: 'chunk-defs'
    },
    {
      id: 2,
      start: 0,
      end: refsSource.length,
      file: path.join(srcDir, 'refs.js'),
      virtualPath: 'src/refs.js',
      startLine: 1,
      endLine: 2,
      kind: 'CallExpression',
      name: 'WidgetBuilder',
      chunkUid: 'chunk-refs'
    }
  ], null, 2)
);

await fs.writeFile(
  path.join(indexDir, 'symbols.json'),
  JSON.stringify([
    {
      v: 1,
      symbolId: 'sym:WidgetBuilder',
      scopedId: 'scope:WidgetBuilder',
      symbolKey: 'WidgetBuilder',
      qualifiedName: 'demo.WidgetBuilder',
      kindGroup: 'function',
      file: path.join(srcDir, 'defs.js'),
      virtualPath: 'src/defs.js',
      chunkUid: 'chunk-defs',
      kind: 'FunctionDeclaration',
      name: 'WidgetBuilder'
    },
    {
      v: 1,
      symbolId: 'sym:helper',
      scopedId: 'scope:helper',
      symbolKey: 'helper',
      qualifiedName: 'demo.helper',
      kindGroup: 'function',
      file: path.join(srcDir, 'refs.js'),
      virtualPath: 'src/refs.js',
      chunkUid: 'chunk-refs',
      kind: 'FunctionDeclaration',
      name: 'helper'
    }
  ], null, 2)
);

await fs.writeFile(
  path.join(indexDir, 'symbol_occurrences.json'),
  JSON.stringify([
    {
      v: 1,
      host: {
        file: path.join(srcDir, 'refs.js'),
        chunkUid: 'chunk-refs'
      },
      role: 'call',
      ref: {
        status: 'resolved',
        resolved: {
          symbolId: 'sym:WidgetBuilder',
          scopedId: 'scope:WidgetBuilder',
          symbolKey: 'WidgetBuilder'
        }
      },
      range: {
        start: secondRefStart,
        end: secondRefEnd
      }
    }
  ], null, 2)
);

const definitions = await queryNavigationData({
  repoRoot,
  kind: 'definitions',
  query: 'WidgetBuilder',
  filePath: path.join(srcDir, 'refs.js'),
  limit: 10
});
assert.equal(definitions.ok, true);
assert.equal(definitions.results.length, 1);
assert.equal(definitions.results[0].virtualPath, 'src/defs.js');
assert.equal(definitions.results[0].startLine, 1);

const references = await queryNavigationData({
  repoRoot,
  kind: 'references',
  query: 'WidgetBuilder',
  filePath: path.join(srcDir, 'refs.js'),
  limit: 10
});
assert.equal(references.ok, true);
assert.equal(references.results.length, 1);
assert.equal(references.results[0].virtualPath, 'src/refs.js');
assert.equal(references.results[0].startLine, 2);
assert.equal(references.results[0].startCol, 1);

const documentSymbols = await queryNavigationData({
  repoRoot,
  kind: 'document-symbols',
  filePath: path.join(srcDir, 'defs.js'),
  limit: 10
});
assert.equal(documentSymbols.ok, true);
assert.equal(documentSymbols.results.length, 1);
assert.equal(documentSymbols.results[0].name, 'WidgetBuilder');
assert.equal(documentSymbols.results[0].virtualPath, 'src/defs.js');

const completions = await queryNavigationData({
  repoRoot,
  kind: 'completions',
  query: 'Wid',
  filePath: path.join(srcDir, 'refs.js'),
  limit: 10
});
assert.equal(completions.ok, true);
assert.equal(completions.results.length, 1);
assert.equal(completions.results[0].name, 'WidgetBuilder');
assert.equal(completions.results[0].virtualPath, 'src/defs.js');

console.log('navigation query test passed');
