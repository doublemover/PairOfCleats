#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveFileCapsAndGuardrails } from '../../../src/index/build/runtime/caps.js';

const { fileCaps } = resolveFileCapsAndGuardrails({
  maxFileBytes: 5 * 1024 * 1024,
  fileCaps: {
    byExt: {
      '.m': {
        maxBytes: 123456,
        maxLines: 2345
      }
    }
  }
});

assert.equal(fileCaps.byExt['.m']?.maxBytes, 123456, 'expected explicit .m maxBytes override to win');
assert.equal(fileCaps.byExt['.m']?.maxLines, 2345, 'expected explicit .m maxLines override to win');
assert.ok(fileCaps.byExt['.mm'], 'expected .mm default cap to remain present');

console.log('objective-c cap overrides test passed');
