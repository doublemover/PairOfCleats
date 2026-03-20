#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeServerConfig } from '../../../src/index/tooling/lsp-provider/index.js';

const normalized = normalizeServerConfig({
  preset: 'yaml-language-server',
  id: 'yaml-custom',
  initializationOptions: {
    settings: {
      yaml: {
        schemas: {
          'https://example.invalid/custom.json': '.github/workflows/*.yaml'
        }
      }
    }
  },
  timeoutMs: 5000,
  definition: false
}, 0);

assert.ok(normalized, 'expected configured server to normalize');
assert.equal(normalized.id, 'yaml-custom', 'expected explicit id to win over preset id');
assert.equal(normalized.cmd, 'yaml-language-server', 'expected preset command to be retained');
assert.equal(normalized.timeoutMs, 5000, 'expected explicit timeout to override preset');
assert.equal(normalized.definitionEnabled, false, 'expected explicit definition toggle to survive normalization');
assert.equal(
  normalized.initializationOptions?.settings?.yaml?.schemas?.['https://example.invalid/custom.json'],
  '.github/workflows/*.yaml',
  'expected explicit initializationOptions to deep-merge over preset defaults'
);

console.log('configured provider normalize and merge test passed');
