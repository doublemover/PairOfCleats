#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `phpactor-provider-guard-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });

const fixturesBin = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');
const originalPath = process.env.PATH || '';
process.env.PATH = `${fixturesBin}${path.delimiter}${originalPath}`;

try {
  registerDefaultToolingProviders();
  const docText = '<?php\nfunction greet(string $name): string { return $name; }\n';
  const chunkUid = 'ck64:v1:test:src/app.php:phpactor-guard';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['phpactor'],
      phpactor: {
        enabled: true
      }
    },
    cache: {
      enabled: false
    }
  }, {
    documents: [{
      virtualPath: 'src/app.php',
      text: docText,
      languageId: 'php',
      effectiveExt: '.php',
      docHash: 'hash-phpactor-guard'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: 'chunk_phpactor_guard',
        file: 'src/app.php',
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath: 'src/app.php',
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: 'greet', kind: 'function' },
      languageId: 'php'
    }],
    kinds: ['types']
  });

  assert.equal(result.byChunkUid.has(chunkUid), false, 'expected guard to skip phpactor without composer.json');
  const checks = result.diagnostics?.phpactor?.checks || [];
  assert.equal(
    checks.some((check) => check?.name === 'phpactor_workspace_model_missing'),
    true,
    'expected workspace model missing warning'
  );

  console.log('phpactor provider workspace guard test passed');
} finally {
  process.env.PATH = originalPath;
}
