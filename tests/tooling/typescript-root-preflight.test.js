#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectCompilerDependencyInventory, verifyCompilerDependencyInventory } from '../../src/index/semantic/compiler-dependencies.js';
import { createTypeScriptProvider } from '../../src/index/tooling/typescript-provider.js';
import { createVirtualCompilerHost } from '../../src/index/tooling/typescript/host.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ts-root-preflight-'));
const put = async (file, value) => {
  const target = path.join(root, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, typeof value === 'string' ? value : JSON.stringify(value));
  return target;
};
const hash = value => createHash('sha256').update(value).digest('hex');
try {
  await put('package.json', { type: 'module' });
  await put('tsconfig.json', { files: [], references: [{ path: './app' }, { path: './referenced' }] });
  const appConfig = await put('app/tsconfig.json', {
    compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', customConditions: ['development'],
      moduleDetection: 'force', noLib: true, types: [], noEmit: true },
    files: ['main.ts'], references: [{ path: '../referenced' }]
  });
  const referencedConfig = await put('referenced/tsconfig.json', {
    compilerOptions: { composite: true, declaration: true, module: 'NodeNext', moduleResolution: 'NodeNext',
      moduleDetection: 'force', noLib: true, types: [] }, files: ['context.ts']
  });
  await put('referenced/context.ts', 'export interface ReferencedContext { ready: boolean; }');
  await put('node_modules/conditional/package.json', {
    name: 'conditional', type: 'module', exports: { '.': { development: './development.d.ts', default: './default.d.ts' } }
  });
  const development = await put('node_modules/conditional/development.d.ts', 'export declare function selected(): "development";');
  await put('node_modules/conditional/default.d.ts', 'export declare function selected(): "default";');
  const text = 'import { selected } from "conditional"; export function run() { return selected(); }';
  const physical = await put('app/main.ts', text);
  const virtualPath = '.poc-vfs/app/main.ts';
  const document = { virtualPath, containerPath: 'app/main.ts', effectiveExt: '.ts', languageId: 'typescript',
    text, docHash: hash(text), segmentUid: null };
  document.authority = { virtualPath, containerPath: document.containerPath, segmentUid: null,
    sourceUnitId: null, sourceHash: null, textHash: hash(text), parentSourceUnitId: null,
    parentByteHash: null, mappingIdentity: null, mappingQuality: 'unmapped' };
  const toolingConfig = { typescript: {} };
  const inventory = await collectCompilerDependencyInventory({ repoRoot: root, toolingConfig,
    files: [document.containerPath], documents: [document] });
  assert.equal(inventory.groups.length, 1);
  const group = inventory.groups[0];
  assert.equal(group.configPath, appConfig);
  assert.deepEqual(group.rootNames, [path.join(root, virtualPath)], 'sealed roots must use the same canonical VFS identity as execution');
  assert.equal(group.projectReferences[0].path, path.dirname(referencedConfig), 'reference configuration stays unchanged');
  assert.ok(inventory.closure.files.some(file => file.path === development), 'development conditional export remains in the closure');
  assert.ok(inventory.closure.files.some(file => file.path === referencedConfig), 'referenced project configuration remains in the closure');
  assert.ok(!inventory.closure.files.some(file => file.path === physical), 'ordinary aliased root must not inflate the sealed closure');
  const { ts, system } = await verifyCompilerDependencyInventory({ inventory, repoRoot: root, toolingConfig });
  const virtual = path.join(root, virtualPath), key = file => ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase();
  const aliases = new Map([[key(virtual), physical]]);
  const host = createVirtualCompilerHost(ts, group.options, new Map([[key(virtual), text]]), aliases, aliases, system);
  const program = ts.createProgram({ rootNames: group.rootNames, options: group.options,
    projectReferences: group.projectReferences, host });
  const checker = program.getTypeChecker();
  const declaration = program.getSourceFile(virtual).statements.find(node => ts.isFunctionDeclaration(node));
  assert.equal(checker.typeToString(checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(declaration))), '"development"',
    'the exact sealed host must admit canonical Program construction and type queries');
  for (const source of program.getSourceFiles()) {
    assert.ok(inventory.closure.files.some(file => key(file.path) === key(source.fileName) && file.hash === hash(source.text)),
      'every execution source must retain an admitted closure identity');
  }
  const messages = [];
  const result = await createTypeScriptProvider().run({ repoRoot: root, strict: true, toolingConfig,
    logger: event => messages.push(event.message) }, { documents: [document], targets: [{
    virtualPath, virtualRange: { start: text.indexOf('export function'), end: text.length },
    chunkRef: { chunkUid: 'ck:root-preflight', file: document.containerPath },
    symbolHint: { name: 'run', kind: 'function' }
  }] });
  assert.equal(result.byChunkUid['ck:root-preflight'].payload.returnType, '"development"');
  for (const phase of ['create-program:start', 'create-program:done', 'checker:start', 'checker:done', 'complete']) {
    assert.ok(messages.some(message => message.includes('phase=' + phase) && message.includes('heapUsedBytes=') && message.includes('rssBytes=')),
      'execution must expose bounded phase evidence for ' + phase);
  }
  console.log('TypeScript canonical roots preserve sealed closure, project references, conditional exports and phase evidence.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
