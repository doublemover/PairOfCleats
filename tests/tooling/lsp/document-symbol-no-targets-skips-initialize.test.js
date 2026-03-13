#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-no-targets-skip-init-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const markerPath = path.join(tempRoot, 'server-started.txt');
const virtualPath = '.poc-vfs/src/no_target.py#seg:no_target.py';
const docText = 'def no_target():\n    return 0\n';

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  providerId: 'pyright',
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'python',
    effectiveExt: '.py'
  }],
  targets: [],
  cmd: process.execPath,
  args: [
    '-e',
    "require('node:fs').writeFileSync(process.argv[1], 'started'); setTimeout(() => {}, 5000);",
    markerPath
  ],
  timeoutMs: 1000,
  retries: 0
});

assert.equal(Object.keys(result.byChunkUid).length, 0, 'expected no enrichment when there are no selected targets');
assert.equal(result.runtime?.selection?.selectedDocs, 0, 'expected no docs to be selected without targets');
assert.equal(result.runtime?.selection?.skippedByMissingTargets, 1, 'expected untargeted doc count in runtime selection');
assert.match(String(result.runtime?.selection?.reason || ''), /no-targets/, 'expected no-targets no-work reason');
assert.equal(result.checks.some((check) => check?.name === 'tooling_initialize_failed'), false, 'expected provider startup to be skipped entirely');
assert.equal(await fs.stat(markerPath).then(() => true).catch(() => false), false, 'expected no-target scope to avoid starting the LSP process');

console.log('LSP documentSymbol no-targets skips initialize test passed');
