#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { withLspTestPath } from '../../helpers/lsp-runtime.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'package main\nfunc Add(a int, b int) int { return a + b }\n';

const createTarget = ({ docId, chunkUid, file, virtualPath }) => ({
  chunkRef: {
    docId,
    chunkUid,
    chunkId: `chunk_${chunkUid.replace(/[^a-z0-9]+/gi, '_')}`,
    file,
    segmentUid: null,
    segmentId: null,
    range: { start: 0, end: docText.length }
  },
  virtualPath,
  virtualRange: { start: 0, end: docText.length },
  symbolHint: { name: 'Add', kind: 'function' },
  languageId: 'go'
});

const writeGoProbe = async (tempRoot, name, source) => {
  const scriptPath = path.join(tempRoot, name);
  await fs.writeFile(scriptPath, source, 'utf8');
  return scriptPath;
};

const cases = [
  {
    name: 'gopls routes ambiguous multi-root workspaces by partition',
    cacheName: 'configured-lsp-gopls-workspace-root-ambiguous',
    async setup(tempRoot) {
      await fs.mkdir(path.join(tempRoot, 'svc-a'), { recursive: true });
      await fs.mkdir(path.join(tempRoot, 'svc-b'), { recursive: true });
      await fs.writeFile(path.join(tempRoot, 'svc-a', 'go.mod'), 'module example.com/svc-a\n\ngo 1.22\n', 'utf8');
      await fs.writeFile(path.join(tempRoot, 'svc-b', 'go.mod'), 'module example.com/svc-b\n\ngo 1.22\n', 'utf8');
      const documents = [
        {
          virtualPath: '.poc-vfs/svc-a/src/sample.go#seg:gopls-workspace-root-ambiguous-a.txt',
          text: docText,
          languageId: 'go',
          effectiveExt: '.go',
          docHash: 'hash-gopls-workspace-root-ambiguous-a'
        },
        {
          virtualPath: '.poc-vfs/svc-b/src/sample.go#seg:gopls-workspace-root-ambiguous-b.txt',
          text: docText,
          languageId: 'go',
          effectiveExt: '.go',
          docHash: 'hash-gopls-workspace-root-ambiguous-b'
        }
      ];
      return {
        toolId: 'lsp-gopls',
        serverId: 'gopls',
        serverConfig: {
          preset: 'gopls',
          cmd: process.execPath,
          args: [serverPath, '--mode', 'go'],
          languages: ['go'],
          uriScheme: 'poc-vfs',
          preflightRuntimeRequirements: []
        },
        request: {
          documents,
          targets: [
            createTarget({
              docId: 0,
              chunkUid: 'ck64:v1:test:svc-a/src/sample.go:gopls-workspace-root-ambiguous:a',
              file: 'svc-a/src/sample.go',
              virtualPath: documents[0].virtualPath
            }),
            createTarget({
              docId: 1,
              chunkUid: 'ck64:v1:test:svc-b/src/sample.go:gopls-workspace-root-ambiguous:b',
              file: 'svc-b/src/sample.go',
              virtualPath: documents[1].virtualPath
            })
          ],
          kinds: ['types']
        },
        assertResult(result, diagnostics) {
          assert.equal(result.byChunkUid.has('ck64:v1:test:svc-a/src/sample.go:gopls-workspace-root-ambiguous:a'), true);
          assert.equal(result.byChunkUid.has('ck64:v1:test:svc-b/src/sample.go:gopls-workspace-root-ambiguous:b'), true);
          assert.equal(diagnostics?.preflight?.state, 'ready');
          assert.equal(diagnostics?.workspaceModel?.partitionCount, 2);
          const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
          assert.equal(checks.some((check) => check?.name === 'go_workspace_module_root_partitioned'), true);
          assert.equal(checks.some((check) => check?.name === 'lsp-gopls_workspace_partition_multi_root'), true);
        }
      };
    }
  },
  {
    name: 'gopls accepts nested module roots when selected docs resolve cleanly',
    cacheName: 'configured-lsp-gopls-workspace-root-nested',
    async setup(tempRoot) {
      await fs.mkdir(path.join(tempRoot, 'svc', 'src'), { recursive: true });
      await fs.writeFile(path.join(tempRoot, 'svc', 'go.mod'), 'module example.com/svc\n\ngo 1.22\n', 'utf8');
      const goProbeOkScriptPath = await writeGoProbe(
        tempRoot,
        'go-probe-ok.js',
        "process.stdout.write('example.com/svc\\n');\n"
      );
      const virtualPath = '.poc-vfs/svc/src/sample.go#seg:gopls-workspace-root-nested.txt';
      return {
        toolId: 'lsp-gopls',
        serverId: 'gopls',
        serverConfig: {
          preset: 'gopls',
          cmd: process.execPath,
          args: [serverPath, '--mode', 'go'],
          languages: ['go'],
          uriScheme: 'poc-vfs',
          preflightRuntimeRequirements: [],
          goWorkspaceModuleCmd: process.execPath,
          goWorkspaceModuleArgs: [goProbeOkScriptPath],
          goWorkspaceWarmup: false
        },
        request: {
          documents: [{
            virtualPath,
            text: docText,
            languageId: 'go',
            effectiveExt: '.go',
            docHash: 'hash-gopls-workspace-root-nested'
          }],
          targets: [createTarget({
            docId: 0,
            chunkUid: 'ck64:v1:test:svc/src/sample.go:gopls-workspace-root-nested',
            file: 'svc/src/sample.go',
            virtualPath
          })],
          kinds: ['types']
        },
        assertResult(result, diagnostics) {
          assert.equal(result.byChunkUid.has('ck64:v1:test:svc/src/sample.go:gopls-workspace-root-nested'), true);
          assert.equal(diagnostics?.preflight?.state, 'ready');
          const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
          assert.equal(checks.some((check) => check?.name === 'go_workspace_module_root_nested'), false);
        }
      };
    }
  },
  {
    name: 'workspace-module probe failures block the provider with a typed diagnostic',
    cacheName: 'configured-lsp-go-workspace-module-failed',
    async setup(tempRoot) {
      await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
      await fs.writeFile(path.join(tempRoot, 'go.mod'), 'module example.com/preflight\n\ngo 1.21\n', 'utf8');
      const goProbeFailScriptPath = await writeGoProbe(
        tempRoot,
        'go-probe-fail.js',
        'process.stderr.write("forced go workspace module probe failure\\n"); process.exit(17);\n'
      );
      const virtualPath = '.poc-vfs/src/main.go#seg:go-workspace-module-preflight-failed.txt';
      return {
        toolId: 'lsp-go-workspace-module-preflight',
        serverId: 'go-workspace-module-preflight',
        serverConfig: {
          preset: 'gopls',
          cmd: process.execPath,
          args: [serverPath, '--mode', 'go'],
          languages: ['go'],
          preflightRuntimeRequirements: [],
          goWorkspaceModuleCmd: process.execPath,
          goWorkspaceModuleArgs: [goProbeFailScriptPath]
        },
        request: {
          documents: [{
            virtualPath,
            text: docText,
            languageId: 'go',
            effectiveExt: '.go',
            docHash: 'hash-go-workspace-module-preflight-failed'
          }],
          targets: [createTarget({
            docId: 0,
            chunkUid: 'ck64:v1:test:src/main.go:go-workspace-module-preflight-failed',
            file: 'src/main.go',
            virtualPath
          })],
          kinds: ['types']
        },
        assertResult(result, diagnostics) {
          assert.equal(result.byChunkUid.has('ck64:v1:test:src/main.go:go-workspace-module-preflight-failed'), false);
          assert.equal(diagnostics?.preflight?.state, 'blocked');
          assert.equal(diagnostics?.preflight?.reasonCode, 'go_workspace_blocked_workspace_shape');
          const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
          assert.equal(checks.some((check) => String(check?.name || '') === 'go_workspace_module_probe_failed'), true);
        }
      };
    }
  },
  {
    name: 'workspace-module probe timeouts block fidelity and emit timeout diagnostics',
    cacheName: 'configured-lsp-go-workspace-module-timeout',
    async setup(tempRoot) {
      await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
      await fs.writeFile(path.join(tempRoot, 'go.mod'), 'module example.com/preflight\n\ngo 1.21\n', 'utf8');
      const goProbeHangScriptPath = await writeGoProbe(
        tempRoot,
        'go-probe-timeout.js',
        'setTimeout(() => process.exit(0), 5000);\n'
      );
      const virtualPath = '.poc-vfs/src/main.go#seg:go-workspace-module-preflight-timeout.txt';
      return {
        toolId: 'lsp-go-workspace-module-preflight-timeout',
        serverId: 'go-workspace-module-preflight-timeout',
        serverConfig: {
          preset: 'gopls',
          cmd: process.execPath,
          args: [serverPath, '--mode', 'go'],
          languages: ['go'],
          preflightRuntimeRequirements: [],
          goWorkspaceModuleCmd: process.execPath,
          goWorkspaceModuleArgs: [goProbeHangScriptPath],
          goWorkspaceModuleTimeoutMs: 500
        },
        request: {
          documents: [{
            virtualPath,
            text: docText,
            languageId: 'go',
            effectiveExt: '.go',
            docHash: 'hash-go-workspace-module-preflight-timeout'
          }],
          targets: [createTarget({
            docId: 0,
            chunkUid: 'ck64:v1:test:src/main.go:go-workspace-module-preflight-timeout',
            file: 'src/main.go',
            virtualPath
          })],
          kinds: ['types']
        },
        assertResult(result, diagnostics) {
          assert.equal(result.byChunkUid.has('ck64:v1:test:src/main.go:go-workspace-module-preflight-timeout'), false);
          assert.equal(diagnostics?.preflight?.state, 'blocked');
          assert.equal(diagnostics?.fidelity?.state, 'blocked');
          assert.equal(diagnostics?.fidelity?.contributes?.typeEnrichment, false);
          assert.equal(diagnostics?.fidelity?.qualityDelta?.partialSuccess, false);
          assert.equal(diagnostics?.preflight?.reasonCode, 'go_workspace_blocked_workspace_shape');
          const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
          assert.equal(checks.some((check) => String(check?.name || '') === 'go_workspace_module_probe_timeout'), true);
        }
      };
    }
  }
];

await withLspTestPath({ repoRoot: root }, async () => {
  for (const [index, entry] of cases.entries()) {
    const tempRoot = resolveTestCachePath(root, `${entry.cacheName}-${process.pid}-${Date.now()}-${index}`);
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
    const setup = await entry.setup(tempRoot);
    const result = await runToolingProviders({
      strict: true,
      repoRoot: tempRoot,
      buildRoot: tempRoot,
      toolingConfig: {
        enabledTools: [setup.toolId],
        lsp: {
          enabled: true,
          servers: [{
            id: setup.serverId,
            ...setup.serverConfig
          }]
        }
      },
      cache: {
        enabled: false
      }
    }, setup.request);
    const diagnostics = result.diagnostics?.[setup.toolId] || {};
    setup.assertResult(result, diagnostics);
  }
});

console.log('configured provider preflight matrix test passed');
