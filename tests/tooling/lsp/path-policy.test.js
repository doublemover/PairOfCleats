#!/usr/bin/env node
import assert from 'node:assert/strict';

import { __classifyLspDocumentPathPolicyForTests } from '../../../src/integrations/tooling/providers/lsp/path-policy.js';

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

console.log('LSP path policy test passed');
