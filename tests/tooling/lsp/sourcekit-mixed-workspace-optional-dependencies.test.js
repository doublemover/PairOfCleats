#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { countNonEmptyLines, parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import {
  createSourcekitPreflightFixture,
  withSourcekitPreflightProvider
} from '../../helpers/sourcekit-preflight-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = await createSourcekitPreflightFixture({
  root,
  name: 'sourcekit-mixed-workspace-optional-dependencies',
  includeDependencies: true,
  dependencyVersion: '1.0.0',
  resolveExitCode: 7,
  resolveStderr: 'forced mixed-workspace resolve failure'
});
const logs = [];
const { ctx, document, target } = fixture.contextFor(logs);
const stubServerPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const launcherPath = path.join(fixture.tempRoot, 'stub-launcher.js');
const modePath = path.join(fixture.tempRoot, 'mode.txt');
const tracePath = path.join(fixture.tempRoot, 'trace.jsonl');

await fs.mkdir(path.join(fixture.tempRoot, 'Demo.xcodeproj'), { recursive: true });
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
await fs.writeFile(modePath, 'all-capabilities', 'utf8');

try {
  await withSourcekitPreflightProvider({
    fixture,
    logs,
    env: { POC_LSP_TRACE: tracePath },
    context: { ctx, document, target }
  }, async ({ provider }) => {
    const output = await provider.run({
      ...ctx,
      toolingConfig: {
        sourcekit: {
          cmd: process.execPath,
          args: [launcherPath, modePath, stubServerPath],
          hoverEnabled: true,
          hoverTimeoutMs: 150,
          timeoutMs: 500,
          retries: 0,
          breakerThreshold: 1,
          hostConcurrencyGate: false
        }
      }
    }, {
      documents: [document],
      targets: [target]
    });

    assert.equal(output?.diagnostics?.preflight?.workspaceKind, 'mixed_workspace');
    assert.equal(output?.diagnostics?.preflight?.dependencyState, 'optional');
    assert.equal(output?.diagnostics?.preflight?.preflightState, 'ready');
    assert.equal(output?.diagnostics?.preflight?.reasonCode, 'sourcekit_mixed_workspace_dependencies_optional');
    assert.equal(
      Array.isArray(output?.diagnostics?.checks)
      && output.diagnostics.checks.some((check) => check?.name === 'sourcekit_package_preflight_failed'),
      false,
      'expected mixed workspace not to fail closed on skipped SwiftPM dependency resolution'
    );

    const count = await countNonEmptyLines(fixture.counterPath);
    assert.equal(count, 0, 'expected no swift package resolve invocation for mixed workspaces');
    const events = await parseJsonLinesFile(tracePath);
    const runtimeRequests = events.filter((entry) => entry.kind === 'request' && entry.method !== 'initialize');
    assert.equal(runtimeRequests.length > 0, true, 'expected mixed Swift workspace to continue issuing SourceKit requests after optional dependency preflight');
    assert.equal(
      logs.some((line) => line.includes('sourcekit package preflight: running')),
      false,
      'expected mixed workspace dependencies to remain optional and skip package resolve'
    );
  });
} finally {
  await fixture.restorePath();
  const cleanup = await removePathWithRetry(fixture.tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}

console.log('sourcekit mixed workspace optional dependencies test passed');
