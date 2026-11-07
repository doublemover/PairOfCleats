import assert from 'node:assert/strict';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const filename = new URL('../../fixtures/mcp/result-envelope-types.ts', import.meta.url);
const program = ts.createProgram([fileURLToPath(filename)], {
  noEmit: true, strict: true, types: [], target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true
});
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'
}));
console.log('MCP tool response discriminants preserve success/error type narrowing');
