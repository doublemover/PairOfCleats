#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createLspProviderTempRepo,
  runDedicatedProviderFixture
} from '../../helpers/lsp-provider-fixture.js';
import { withLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = await createLspProviderTempRepo({
  repoRoot: root,
  name: 'csharp-provider-workspace-partition',
  directories: ['svc-a/src', 'svc-b/src'],
  files: [
    { path: 'svc-a/app.csproj', content: '<Project />\n' },
    { path: 'svc-b/app.csproj', content: '<Project />\n' }
  ]
});
const docText = 'class App { string Greet(string name) => name; }\n';
const inputs = {
  kinds: ['types'],
  documents: [
    {
      virtualPath: 'svc-a/src/App.cs',
      text: docText,
      languageId: 'csharp',
      effectiveExt: '.cs',
      docHash: 'hash-csharp-partition-a'
    },
    {
      virtualPath: 'svc-b/src/App.cs',
      text: docText,
      languageId: 'csharp',
      effectiveExt: '.cs',
      docHash: 'hash-csharp-partition-b'
    }
  ],
  targets: [
    {
      chunkRef: {
        docId: 0,
        chunkUid: 'ck64:v1:test:svc-a/src/App.cs:csharp-partition-a',
        chunkId: 'chunk_csharp_partition_a',
        file: 'svc-a/src/App.cs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: 'svc-a/src/App.cs',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Greet', kind: 'function' },
      languageId: 'csharp'
    },
    {
      chunkRef: {
        docId: 1,
        chunkUid: 'ck64:v1:test:svc-b/src/App.cs:csharp-partition-b',
        chunkId: 'chunk_csharp_partition_b',
        file: 'svc-b/src/App.cs',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: 'svc-b/src/App.cs',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'Greet', kind: 'function' },
      languageId: 'csharp'
    }
  ]
};

await withLspTestPath({ repoRoot: root }, async () => {
  const result = await runDedicatedProviderFixture({
    tempRoot,
    providerId: 'csharp-ls',
    providerConfigKey: 'csharp',
    inputs
  });

  assert.equal(result.byChunkUid.has(inputs.targets[0].chunkRef.chunkUid), true, 'expected first C# workspace partition to contribute');
  assert.equal(result.byChunkUid.has(inputs.targets[1].chunkRef.chunkUid), true, 'expected second C# workspace partition to contribute');
  assert.equal(
    result.diagnostics?.['csharp-ls']?.workspaceModel?.partitionCount,
    2,
    'expected dedicated provider workspace summary to expose both partitions'
  );
  const checks = Array.isArray(result.diagnostics?.['csharp-ls']?.checks) ? result.diagnostics['csharp-ls'].checks : [];
  assert.equal(
    checks.some((check) => check?.name === 'csharp-ls_workspace_partition_multi_root'),
    true,
    'expected dedicated provider multi-root routing check'
  );

  console.log('csharp provider workspace partition test passed');
});
