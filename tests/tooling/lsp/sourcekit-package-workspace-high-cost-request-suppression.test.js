#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { createSourcekitPreflightFixture } from '../../helpers/sourcekit-preflight-fixture.js';
import { parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = await createSourcekitPreflightFixture({
  root,
  name: 'sourcekit-package-workspace-high-cost-request-suppression',
  includeDependencies: true,
  dependencyVersion: '1.0.0',
  resolveExitCode: 0
});
const logs = [];
const { ctx } = fixture.contextFor(logs);
const stubServerPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const launcherPath = path.join(fixture.tempRoot, 'stub-launcher.js');
const modePath = path.join(fixture.tempRoot, 'mode.txt');
const tracePath = path.join(fixture.tempRoot, 'trace.jsonl');

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

const document = {
  virtualPath: 'src/one.swift',
  effectiveExt: '.swift',
  languageId: 'swift',
  text: 'func add(a: Int, b: Int) -> Int { return a + b }\n',
  docHash: 'doc-sourcekit-package-workspace',
  containerPath: 'src/one.swift'
};
const target = {
  virtualPath: 'src/one.swift',
  languageId: 'swift',
  chunkRef: {
    chunkUid: 'ck:test:sourcekit:package-workspace-high-cost',
    chunkId: 'chunk_sourcekit_package_workspace_high_cost',
    file: 'src/one.swift',
    start: 0,
    end: document.text.length
  },
  virtualRange: {
    start: 0,
    end: document.text.length
  },
  symbolHint: {
    name: 'add',
    kind: 'function'
  }
};

try {
  await withTemporaryEnv({ POC_SWIFT_PREFLIGHT_COUNTER: fixture.counterPath, POC_LSP_TRACE: tracePath }, async () => {
    registerDefaultToolingProviders();
    const provider = getToolingProvider('sourcekit');
    assert.ok(provider, 'expected sourcekit provider');

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
          hostConcurrencyGate: false,
          packageWorkspaceHighCostRequestMinTargets: 1
        }
      }
    }, {
      documents: [document],
      targets: [target]
    });

    assert.equal(output?.diagnostics?.preflight?.workspaceKind, 'package_managed_workspace');
    assert.equal(output?.diagnostics?.preflight?.dependencyState, 'required');
    assert.equal(
      Array.isArray(output?.diagnostics?.checks)
      && output.diagnostics.checks.some((check) => check?.name === 'sourcekit_package_workspace_high_cost_request_suppression'),
      true,
      'expected explicit package-workspace suppression check'
    );
    assert.equal(
      Array.isArray(output?.diagnostics?.fidelity?.runtimeIssues)
      && output.diagnostics.fidelity.runtimeIssues.includes('package_workspace_high_cost_requests_suppressed'),
      true,
      'expected fidelity runtime issue for package-workspace suppression'
    );
    assert.equal(
      Array.isArray(output?.diagnostics?.fidelity?.requestSuppression?.suppressedRequestClasses)
      && output.diagnostics.fidelity.requestSuppression.suppressedRequestClasses.includes('semanticTokens')
      && output.diagnostics.fidelity.requestSuppression.suppressedRequestClasses.includes('inlayHints'),
      true,
      'expected package-workspace suppression to record the skipped request classes'
    );

    const events = await parseJsonLinesFile(tracePath);
    const semanticTokenRequests = events.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/semanticTokens/full').length;
    const inlayHintRequests = events.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/inlayHint').length;
    assert.equal(semanticTokenRequests, 0, 'expected semantic tokens to be suppressed for package-managed high-cost workspaces');
    assert.equal(inlayHintRequests, 0, 'expected inlay hints to be suppressed for package-managed high-cost workspaces');
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

console.log('sourcekit package workspace high-cost request suppression test passed');
