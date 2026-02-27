#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-yaml-schema-merge-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const virtualPath = '.poc-vfs/.github/workflows/ci.yaml#seg:yaml-schema-merge.txt';
const docText = 'name: CI\non: [push]\n';
const chunkUid = 'ck64:v1:test:.github/workflows/ci.yaml:yaml-schema-merge';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-yaml-schema-merge'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'yaml-schema-merge',
        preset: 'yaml-language-server',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'yaml-requires-schemastore-and-schema-map'],
        languages: ['yaml'],
        initializationOptions: {
          settings: {
            yaml: {
              schemas: {
                'https://json.schemastore.org/github-workflow.json': '.github/workflows/*.yaml'
              }
            }
          }
        }
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'yaml',
    effectiveExt: '.yaml',
    docHash: 'hash-yaml-schema-merge'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_yaml_schema_merge',
      file: '.github/workflows/ci.yaml',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath,
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'name', kind: 'property' },
    languageId: 'yaml'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), true, 'expected yaml provider to enrich with merged init options');
const diagnostics = result.diagnostics?.['lsp-yaml-schema-merge'] || null;
assert.ok(diagnostics && diagnostics.runtime, 'expected runtime diagnostics for yaml provider');

console.log('configured LSP yaml schema override merge test passed');
