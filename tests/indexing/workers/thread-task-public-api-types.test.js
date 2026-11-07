import assert from 'node:assert/strict';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const filename = fileURLToPath(new URL('../../fixtures/workers/piscina-public-association-types.ts', import.meta.url));
const program = ts.createProgram([filename], { noEmit: true, strict: true, types: ['node'],
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true });
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n'
}));
console.log('Locked Piscina public loadBalancer/task queue metadata/Worker lifecycle APIs typecheck without private WorkerInfo access.');
