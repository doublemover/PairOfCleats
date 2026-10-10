import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { createVirtualCompilerHost } from '../../src/index/tooling/typescript/host.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ts-host-'));
try {
  const key = file => ts.sys.useCaseSensitiveFileNames ? path.resolve(file) : path.resolve(file).toLowerCase();
  const input = path.join(root, '.vfs/a/input.ts'), library = path.join(root, '.vfs/b/lib.ts');
  const sourcePaths = new Map([[key(input), path.join(root, 'input.ts')], [key(library), path.join(root, 'lib.ts')]]);
  const map = new Map([[key(input), 'import {renamed as use} from "./lib"; export const result = use(1);'],
    [key(library), 'export function original(x: number) { return x + 1; } export {original as renamed};']]);
  const options = { noLib: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Node10 };
  const host = createVirtualCompilerHost(ts, options, map, sourcePaths);
  const program = ts.createProgram([input, library], options, host), checker = program.getTypeChecker();
  const source = program.getSourceFile(input), call = source.statements[1].declarationList.declarations[0].initializer;
  const signature = checker.getResolvedSignature(call);
  assert.equal(key(signature.declaration.getSourceFile().fileName), key(library));
  assert.equal(signature.declaration.name.text, 'original');
  assert.equal(program.getSourceFiles().length, 2, 'mapped imports reuse existing virtual SourceFiles');
  const symbol = checker.getSymbolAtLocation(call.expression);
  assert.equal(checker.getAliasedSymbol(symbol).declarations[0].name.text, 'original');
  console.log('Virtual imports resolve from original source directory and reuse exact virtual source snapshots.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
