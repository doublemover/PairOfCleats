#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `sourcekit-semantic-timeout-${process.pid}-${Date.now()}`);
const stubServerPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const launcherPath = path.join(tempRoot, 'stub-launcher.js');
const modePath = path.join(tempRoot, 'mode.txt');

try {
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(tempRoot, 'src', 'one.swift'), 'func alpha() -> Int { return 1 }\n', 'utf8');
  await fs.writeFile(
    launcherPath,
    `import fs from 'node:fs';\n`
    + `import { spawn } from 'node:child_process';\n`
    + `const modePath = process.argv[2];\n`
    + `const stubPath = process.argv[3];\n`
    + `const mode = fs.readFileSync(modePath, 'utf8').trim() || 'sourcekit';\n`
    + `const child = spawn(process.execPath, [stubPath, '--mode', mode], { stdio: 'inherit' });\n`
    + `child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));\n`,
    'utf8'
  );
  await fs.writeFile(modePath, 'stall-semantic-tokens', 'utf8');

  registerDefaultToolingProviders();
  const provider = getToolingProvider('sourcekit');
  assert.ok(provider, 'expected sourcekit provider');

  const output = await provider.run({
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      sourcekit: {
        cmd: process.execPath,
        args: [launcherPath, modePath, stubServerPath],
        hoverEnabled: false,
        hoverTimeoutMs: 150,
        timeoutMs: 500,
        retries: 0,
        breakerThreshold: 1,
        hostConcurrencyGate: false
      }
    },
    logger: () => {},
    strict: true
  }, {
    documents: [{
      virtualPath: 'src/one.swift',
      effectiveExt: '.swift',
      languageId: 'swift',
      text: 'func alpha() -> Int { return 1 }\n',
      docHash: 'doc-sourcekit-semantic-timeout',
      containerPath: 'src/one.swift'
    }],
    targets: [{
      virtualPath: 'src/one.swift',
      languageId: 'swift',
      chunkRef: {
        chunkUid: 'ck:test:sourcekit:semantic-timeout',
        chunkId: 'chunk_sourcekit_semantic_timeout',
        file: 'src/one.swift',
        start: 0,
        end: 32
      },
      virtualRange: {
        start: 0,
        end: 32
      },
      symbolHint: {
        name: 'alpha',
        kind: 'function'
      }
    }]
  });

  assert.equal(output?.diagnostics?.runtime?.hoverMetrics?.requested ?? 0, 0, 'expected no hover requests');
  assert.equal(output?.diagnostics?.runtime?.hoverMetrics?.hoverTimedOut ?? 0, 0, 'expected no hover timeouts');
  assert.equal(output?.diagnostics?.runtime?.hoverMetrics?.semanticTokensTimedOut ?? 0, 1, 'expected semantic token timeout to be isolated');
  assert.equal(
    Array.isArray(output?.diagnostics?.checks)
    && output.diagnostics.checks.some((check) => check?.name === 'tooling_semantic_tokens_timeout'),
    true,
    'expected semantic token timeout warning'
  );

  console.log('sourcekit semantic tokens timeout test passed');
} finally {
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}
