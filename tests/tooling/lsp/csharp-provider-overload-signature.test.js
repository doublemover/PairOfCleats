#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `csharp-provider-overload-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(path.join(tempRoot, 'sample.sln'), 'Microsoft Visual Studio Solution File\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
registerDefaultToolingProviders();
const docText = 'public class App { string Greet(string name, int count = 1) => name; }\n';
const chunkUid = 'ck64:v1:test:src/App.cs:csharp-overload';
const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['csharp-ls'],
    csharp: {
      enabled: true,
      cmd: process.execPath,
      args: [serverPath, '--mode', 'csharp-overload']
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: 'src/App.cs',
    text: docText,
    languageId: 'csharp',
    effectiveExt: '.cs',
    docHash: 'hash-csharp-overload'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_csharp_overload',
      file: 'src/App.cs',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: 'src/App.cs',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'Greet', kind: 'function' },
    languageId: 'csharp'
  }],
  kinds: ['types']
});

const hit = result.byChunkUid.get(chunkUid);
assert.ok(hit, 'expected csharp dedicated provider hit');
assert.equal(hit.payload?.returnType, 'string', 'expected C# return type from overload signature');
assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'string', 'expected C# first param type');
assert.equal(hit.payload?.paramTypes?.count?.[0]?.type, 'int', 'expected C# overload/default param type');

console.log('csharp provider overload signature test passed');
