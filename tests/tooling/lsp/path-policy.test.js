#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  __classifyLspDocumentPathPolicyForTests,
  resolveLspStartupDocuments
} from '../../../src/integrations/tooling/providers/lsp/path-policy.js';

const goplsModulePolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'gopls',
  virtualPath: '.poc-vfs/examples/go/go.mod'
});
assert.equal(goplsModulePolicy.skipDocument, true, 'expected gopls to skip non-.go module manifests');

const pyrightDocsPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'pyright',
  virtualPath: '.poc-vfs/docs/conf.py'
});
assert.equal(pyrightDocsPolicy.skipDocument, false, 'expected pyright to keep .py documents');
assert.equal(pyrightDocsPolicy.deprioritized, true, 'expected docs path to be deprioritized');
assert.equal(pyrightDocsPolicy.suppressInteractive, true, 'expected docs path to suppress interactive LSP stages');
assert.equal(pyrightDocsPolicy.skipDocumentSymbol, true, 'expected docs path to skip low-value documentSymbol work');

const clangdSourcePolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'clangd',
  virtualPath: '.poc-vfs/src/check_error.c'
});
assert.equal(clangdSourcePolicy.skipDocument, false, 'expected clangd to keep source file');
assert.equal(clangdSourcePolicy.deprioritized, false, 'expected regular source file to stay preferred');
assert.equal(clangdSourcePolicy.skipDocumentSymbol, false, 'expected regular source file to remain documentSymbol-eligible');

const clangdVendorPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'clangd',
  virtualPath: '.poc-vfs/third_party/abseil/strings/tests/ascii_test.cc'
});
assert.equal(clangdVendorPolicy.skipDocument, false, 'expected clangd to keep third_party source file for diagnostics');
assert.equal(clangdVendorPolicy.skipDocumentSymbol, true, 'expected clangd to skip low-value documentSymbol work in third_party trees');

const goplsVendorPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'gopls',
  virtualPath: '.poc-vfs/vendor/example.com/demo/lib.go'
});
assert.equal(goplsVendorPolicy.skipDocument, false, 'expected gopls to keep vendored Go source for diagnostics');
assert.equal(goplsVendorPolicy.skipDocumentSymbol, true, 'expected gopls to skip vendored documentSymbol work');

const goplsToolsPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'gopls',
  virtualPath: '.poc-vfs/tools/generator/main.go'
});
assert.equal(goplsToolsPolicy.skipDocument, false, 'expected gopls to keep tool Go source for diagnostics');
assert.equal(goplsToolsPolicy.skipDocumentSymbol, true, 'expected gopls tools path to skip documentSymbol work');

const clangdDocsPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'clangd',
  virtualPath: '.poc-vfs/docs/tutorial/example.cc'
});
assert.equal(clangdDocsPolicy.skipDocument, false, 'expected clangd to keep docs C++ source for diagnostics');
assert.equal(clangdDocsPolicy.skipDocumentSymbol, true, 'expected clangd docs path to skip low-value documentSymbol work');

const clangdContribPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'clangd',
  virtualPath: '.poc-vfs/contrib/qat/private_key_providers/source/qat.cc'
});
assert.equal(clangdContribPolicy.skipDocument, false, 'expected clangd to keep contrib source for diagnostics');
assert.equal(clangdContribPolicy.skipDocumentSymbol, true, 'expected clangd contrib path to skip documentSymbol work');

const clangdRunnerPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'clangd',
  virtualPath: '.poc-vfs/pkgs/flutter_http_example/windows/runner/flutter_window.cpp'
});
assert.equal(clangdRunnerPolicy.skipDocument, false, 'expected clangd to keep platform runner source for diagnostics');
assert.equal(clangdRunnerPolicy.skipDocumentSymbol, true, 'expected clangd platform runner path to skip documentSymbol work');

const sourcekitDocsPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'sourcekit',
  virtualPath: '.poc-vfs/docs/Demo.swift'
});
assert.equal(sourcekitDocsPolicy.skipDocument, false, 'expected sourcekit to keep Swift docs for diagnostics');
assert.equal(sourcekitDocsPolicy.skipDocumentSymbol, true, 'expected sourcekit docs path to skip low-value documentSymbol work');

const pyrightGithubPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'pyright',
  virtualPath: '.poc-vfs/.github/scripts/release.py'
});
assert.equal(pyrightGithubPolicy.skipDocument, false, 'expected pyright to keep GitHub automation source for diagnostics');
assert.equal(pyrightGithubPolicy.skipDocumentSymbol, true, 'expected pyright GitHub automation path to skip documentSymbol work');
assert.equal(pyrightGithubPolicy.suppressInteractive, true, 'expected pyright GitHub automation path to suppress interactive work');

const goplsHackPolicy = __classifyLspDocumentPathPolicyForTests({
  providerId: 'gopls',
  virtualPath: '.poc-vfs/hack/gen/main.go'
});
assert.equal(goplsHackPolicy.skipDocument, false, 'expected gopls to keep hack Go source for diagnostics');
assert.equal(goplsHackPolicy.skipDocumentSymbol, true, 'expected gopls hack path to skip documentSymbol work');

const startupSelection = resolveLspStartupDocuments({
  providerId: 'gopls',
  captureDiagnostics: false,
  targets: [
    { virtualPath: '.poc-vfs/src/main.go' }
  ],
  documents: [
    { virtualPath: '.poc-vfs/tools/generator/main.go' },
    { virtualPath: '.poc-vfs/src/main.go' }
  ]
});
assert.equal(startupSelection.documents.length, 1, 'expected startup filter to keep only actionable docs for gopls');
assert.equal(startupSelection.skippedByDocumentSymbolPolicy, 1, 'expected startup filter to count low-value skips');
assert.equal(startupSelection.skippedByMissingTargets, 0, 'expected startup filter to avoid counting targeted source docs as missing targets');

const pyrightLowValueStartupSelection = resolveLspStartupDocuments({
  providerId: 'pyright',
  captureDiagnostics: false,
  targets: [
    { virtualPath: '.poc-vfs/.github/scripts/release.py' }
  ],
  documents: [
    { virtualPath: '.poc-vfs/.github/scripts/release.py' }
  ]
});
assert.equal(pyrightLowValueStartupSelection.documents.length, 0, 'expected low-value pyright docs to be skipped before startup');
assert.equal(pyrightLowValueStartupSelection.skippedByDocumentSymbolPolicy, 1, 'expected low-value pyright docs to count as documentSymbol-policy skips');

const untargetedSelection = resolveLspStartupDocuments({
  providerId: 'clangd',
  captureDiagnostics: false,
  targets: [],
  documents: [
    { virtualPath: '.poc-vfs/src/check_error.c' }
  ]
});
assert.equal(untargetedSelection.documents.length, 0, 'expected untargeted docs to be skipped before startup');
assert.equal(untargetedSelection.skippedByMissingTargets, 1, 'expected startup filter to count untargeted docs');

console.log('LSP path policy test passed');
