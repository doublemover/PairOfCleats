#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-yaml-remote-schema-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const virtualPath = '.poc-vfs/.github/workflows/ci.yaml#seg:yaml-remote-schema.txt';
const docText = 'name: CI\non: [push]\n';
const chunkUid = 'ck64:v1:test:.github/workflows/ci.yaml:yaml-remote-schema';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-yaml-remote-schema'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'yaml-remote-schema',
        preset: 'yaml-language-server',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'yaml-requires-schemastore-off'],
        languages: ['yaml'],
        initializationOptions: {
          settings: {
            yaml: {
              schemaStore: {
                enable: true
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
    docHash: 'hash-yaml-remote-schema'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_yaml_remote_schema',
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

const checks = Array.isArray(result.diagnostics?.['lsp-yaml-remote-schema']?.checks)
  ? result.diagnostics['lsp-yaml-remote-schema'].checks
  : [];
assert.equal(
  checks.some((check) => check?.name === 'yaml_schema_store_remote_enabled'),
  true,
  'expected yaml schema store remote-enabled preflight warning check'
);
assert.equal(
  result.diagnostics?.['lsp-yaml-remote-schema']?.preflight?.reasonCode,
  'yaml_schema_store_remote_enabled',
  'expected preflight reasonCode for yaml schema store remote mode'
);

console.log('configured LSP yaml schema-store remote warning preflight test passed');
