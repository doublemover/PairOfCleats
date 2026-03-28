#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import {
  __classifyLspDocumentPathPolicyForTests,
  resolveLspStartupDocuments
} from '../../../src/integrations/tooling/providers/lsp/path-policy.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();

const runPolicyClassificationCases = () => {
  const policyCases = [
    {
      label: 'gopls skips module manifests',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'gopls',
        virtualPath: '.poc-vfs/examples/go/go.mod'
      }),
      expected: { skipDocument: true }
    },
    {
      label: 'pyright docs are deprioritized but retained',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'pyright',
        virtualPath: '.poc-vfs/docs/conf.py'
      }),
      expected: {
        skipDocument: false,
        deprioritized: true,
        suppressInteractive: true,
        skipDocumentSymbol: true
      }
    },
    {
      label: 'clangd source remains eligible',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'clangd',
        virtualPath: '.poc-vfs/src/check_error.c'
      }),
      expected: {
        skipDocument: false,
        deprioritized: false,
        skipDocumentSymbol: false
      }
    },
    {
      label: 'clangd third_party is diagnostics-only',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'clangd',
        virtualPath: '.poc-vfs/third_party/abseil/strings/tests/ascii_test.cc'
      }),
      expected: {
        skipDocument: false,
        skipDocumentSymbol: true
      }
    },
    {
      label: 'gopls vendor is diagnostics-only',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'gopls',
        virtualPath: '.poc-vfs/vendor/example.com/demo/lib.go'
      }),
      expected: {
        skipDocument: false,
        skipDocumentSymbol: true
      }
    },
    {
      label: 'gopls tools are diagnostics-only',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'gopls',
        virtualPath: '.poc-vfs/tools/generator/main.go'
      }),
      expected: {
        skipDocument: false,
        skipDocumentSymbol: true
      }
    },
    {
      label: 'clangd docs are diagnostics-only',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'clangd',
        virtualPath: '.poc-vfs/docs/tutorial/example.cc'
      }),
      expected: {
        skipDocument: false,
        skipDocumentSymbol: true
      }
    },
    {
      label: 'clangd contrib is diagnostics-only',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'clangd',
        virtualPath: '.poc-vfs/contrib/qat/private_key_providers/source/qat.cc'
      }),
      expected: {
        skipDocument: false,
        skipDocumentSymbol: true
      }
    },
    {
      label: 'clangd platform runners are diagnostics-only',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'clangd',
        virtualPath: '.poc-vfs/pkgs/flutter_http_example/windows/runner/flutter_window.cpp'
      }),
      expected: {
        skipDocument: false,
        skipDocumentSymbol: true
      }
    },
    {
      label: 'sourcekit docs are diagnostics-only',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'sourcekit',
        virtualPath: '.poc-vfs/docs/Demo.swift'
      }),
      expected: {
        skipDocument: false,
        skipDocumentSymbol: true
      }
    },
    {
      label: 'pyright github automation suppresses interactive work',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'pyright',
        virtualPath: '.poc-vfs/.github/scripts/release.py'
      }),
      expected: {
        skipDocument: false,
        skipDocumentSymbol: true,
        suppressInteractive: true
      }
    },
    {
      label: 'gopls hack paths are diagnostics-only',
      policy: __classifyLspDocumentPathPolicyForTests({
        providerId: 'gopls',
        virtualPath: '.poc-vfs/hack/gen/main.go'
      }),
      expected: {
        skipDocument: false,
        skipDocumentSymbol: true
      }
    }
  ];

  for (const testCase of policyCases) {
    for (const [key, value] of Object.entries(testCase.expected)) {
      assert.equal(testCase.policy?.[key], value, `unexpected ${key} for ${testCase.label}`);
    }
  }

  const startupSelection = resolveLspStartupDocuments({
    providerId: 'gopls',
    captureDiagnostics: false,
    targets: [{ virtualPath: '.poc-vfs/src/main.go' }],
    documents: [{ virtualPath: '.poc-vfs/tools/generator/main.go' }, { virtualPath: '.poc-vfs/src/main.go' }]
  });
  assert.equal(startupSelection.documents.length, 1);
  assert.equal(startupSelection.skippedByDocumentSymbolPolicy, 1);
  assert.equal(startupSelection.skippedByMissingTargets, 0);

  const pyrightLowValueStartupSelection = resolveLspStartupDocuments({
    providerId: 'pyright',
    captureDiagnostics: false,
    targets: [{ virtualPath: '.poc-vfs/.github/scripts/release.py' }],
    documents: [{ virtualPath: '.poc-vfs/.github/scripts/release.py' }]
  });
  assert.equal(pyrightLowValueStartupSelection.documents.length, 0);
  assert.equal(pyrightLowValueStartupSelection.skippedByDocumentSymbolPolicy, 1);

  const untargetedSelection = resolveLspStartupDocuments({
    providerId: 'clangd',
    captureDiagnostics: false,
    targets: [],
    documents: [{ virtualPath: '.poc-vfs/src/check_error.c' }]
  });
  assert.equal(untargetedSelection.documents.length, 0);
  assert.equal(untargetedSelection.skippedByMissingTargets, 1);
};

const runSkipInitializeCases = async () => {
  const cases = [
    {
      label: 'document-symbol path policy skips initialize',
      providerId: 'clangd',
      virtualPath: '.poc-vfs/third_party/fmt/test/format-test.cc',
      docText: 'int format_test() { return 0; }\n',
      documents(tempRoot, docText, virtualPath) {
        return [{
          virtualPath,
          text: docText,
          languageId: 'cpp',
          effectiveExt: '.cc'
        }];
      },
      targets(docText, virtualPath) {
        return [{
          chunkRef: {
            docId: 0,
            chunkUid: 'ck64:v1:test:third_party/fmt/test/format-test.cc',
            chunkId: 'chunk_docsymbol_policy_skip_init',
            file: 'third_party/fmt/test/format-test.cc',
            segmentUid: null,
            segmentId: null,
            range: { start: 0, end: docText.length }
          },
          virtualPath,
          virtualRange: { start: 0, end: docText.length },
          symbolHint: { name: 'format_test', kind: 'function' }
        }];
      },
      assertResult(result, markerPath) {
        assert.equal(Object.keys(result.byChunkUid).length, 0);
        assert.equal(result.runtime?.selection?.selectedDocs, 0);
        assert.match(String(result.runtime?.selection?.reason || ''), /document-symbol-path-policy/);
        assert.equal(result.checks.some((check) => check?.name === 'tooling_initialize_failed'), false);
        return fs.stat(markerPath).then(() => false).catch(() => true);
      }
    },
    {
      label: 'no targets skips initialize',
      providerId: 'pyright',
      virtualPath: '.poc-vfs/src/no_target.py#seg:no_target.py',
      docText: 'def no_target():\n    return 0\n',
      documents(tempRoot, docText, virtualPath) {
        return [{
          virtualPath,
          text: docText,
          languageId: 'python',
          effectiveExt: '.py'
        }];
      },
      targets() {
        return [];
      },
      async assertResult(result, markerPath) {
        assert.equal(Object.keys(result.byChunkUid).length, 0);
        assert.equal(result.runtime?.selection?.selectedDocs, 0);
        assert.equal(result.runtime?.selection?.skippedByMissingTargets, 1);
        assert.match(String(result.runtime?.selection?.reason || ''), /no-targets/);
        assert.equal(result.checks.some((check) => check?.name === 'tooling_initialize_failed'), false);
        await assert.rejects(fs.stat(markerPath));
      }
    }
  ];

  for (const [index, testCase] of cases.entries()) {
    const tempRoot = resolveTestCachePath(root, `lsp-path-selection-${process.pid}-${Date.now()}-${index}`);
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
    const markerPath = path.join(tempRoot, 'server-started.txt');
    const result = await collectLspTypes({
      rootDir: tempRoot,
      vfsRoot: tempRoot,
      providerId: testCase.providerId,
      documents: testCase.documents(tempRoot, testCase.docText, testCase.virtualPath),
      targets: testCase.targets(testCase.docText, testCase.virtualPath),
      cmd: process.execPath,
      args: [
        '-e',
        "require('node:fs').writeFileSync(process.argv[1], 'started'); setTimeout(() => {}, 5000);",
        markerPath
      ],
      timeoutMs: 1000,
      retries: 0
    });
    await testCase.assertResult(result, markerPath);
  }
};

runPolicyClassificationCases();
await runSkipInitializeCases();

console.log('LSP path selection contract matrix test passed');
