import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { emitCompilerTypeFacts } from '../../../src/index/semantic/compiler-type-facts.js';
import { createCompilerBoundaryAuthority } from '../../../src/index/semantic/compiler-boundary-authority.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';

// UNVALIDATED: actual Program/checker and compiler consumers; no child provider.
const rejected = async action => {
  let present = false, failure;
  try { await action(); } catch (error) { present = true; failure = error; }
  assert.equal(present, true, 'original pending work cannot become partial output');
  return failure;
};
const contains = (failure, expected) => {
  const work = [failure], seen = new Set();
  while (work.length) {
    const value = work.pop();
    if (value === expected) return true;
    if (value === null || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value);
    if (Object.hasOwn(value, 'cause')) work.push(value.cause);
    if (Array.isArray(value.errors)) work.push(...value.errors);
  }
  return false;
};
const fixture = await createRecoveryFixture('original compiler dependency resource');
const originalOpen = fs.open, disposal = new Map();
try {
  const filename = path.join(fixture.root, 'authority.ts');
  const text = 'import { readFileSync } from "node:fs";\nfunction typed(value: number): number { return value; }\nconst result: number = typed(1);\nreadFileSync("unused");';
  await fs.writeFile(filename, text);
  const program = ts.createProgram([filename], { target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noLib: true, types: ['node'], typeRoots: [path.resolve('node_modules/@types')], skipLibCheck: true });
  const checker = program.getTypeChecker(), sourceFile = program.getSourceFile(filename), nodes = [], owners = new WeakMap();
  assert.ok(sourceFile); assert.equal(sourceFile.parseDiagnostics.length, 0);
  const syntaxId = 'sy1:' + 'a'.repeat(64), partitionId = 'sa1:' + 'b'.repeat(64);
  const visit = node => {
    owners.set(node, { partitionId: syntaxId, localId: nodes.length });
    nodes.push(node); ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const ref = localId => ({ partitionId, localId });
  const emit = async ({ method = null, failure, allocationFailure = false } = {}) => {
    let nextId = 1, injections = 0;
    const actualChecker = new Proxy(checker, { get(target, key) {
      if (key === method) return () => { injections++; throw failure; };
      const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    } });
    const result = await emitCompilerTypeFacts({ ts, checker: actualChecker, sourceFile, nodes,
      declarationFor: node => owners.get(node), expressionFor: node => owners.get(node),
      context: { contextKey: 'compiler-resource-fixture' }, ref, evidence: ref(0), allocate() {
        if (allocationFailure && nextId === 2) { injections++; throw failure; }
        return ref(nextId++);
      } });
    if (method || allocationFailure) assert.ok(injections > 0, 'fault reaches the actual selected compiler operation');
    return result;
  };
  const ordinary = await emit();
  assert.deepEqual(ordinary.reasons, []);
  assert.equal(ordinary.completedCount, ordinary.observedCount);
  for (const failure of [new Error('settled checker unavailable'), undefined, null, false, 0, '']) {
    const partial = await emit({ method: 'typeToString', failure });
    assert.ok(partial.reasons.includes('checker_type_failure'));
    assert.ok(partial.rows.some(entry => entry.family === 'node' && entry.row.data.origin === 'declared'));
    assert.ok(partial.completedCount < partial.observedCount);
  }

  const call = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(sourceFile) === 'readFileSync');
  const declaration = checker.getResolvedSignature(call)?.declaration;
  assert.ok(declaration, 'boundary authority uses the actual imported Node declaration');
  assert.ok(declaration.getSourceFile().fileName.replaceAll('\\', '/').includes('/node_modules/@types/node/'));
  const authority = compilerReadFile => createCompilerBoundaryAuthority({ compilerReadFile,
    context: { compilerVersion: ts.version }, isDefaultLibrary: file => program.isSourceFileDefaultLibrary(file) });
  let packageReads = 0;
  const admitted = authority(async file => { packageReads++; return fs.readFile(file, 'utf8'); });
  const metadata = await admitted.declaration(declaration);
  assert.equal(metadata.family, 'node-type-package'); assert.equal(metadata.packageName, '@types/node');
  assert.match(metadata.packageMetadataHash, /^[a-f0-9]{64}$/);
  assert.strictEqual(await admitted.declaration(declaration), metadata); assert.equal(packageReads, 1);
  for (const code of ['ENOENT', 'ENOTDIR']) {
    assert.equal(await authority(async () => { throw Object.assign(new Error('ordinary missing metadata'), { code }); })
      .declaration(declaration), null);
  }
  for (const failure of [undefined, null, false, 0, '', Object.freeze(new Error('ordinary package failure'))]) {
    assert.strictEqual(await rejected(() => authority(async () => { throw failure; }).declaration(declaration)), failure);
  }

  let denyClose = true, state;
  const closeError = Object.freeze(Object.assign(new Error('compiler descriptor close failed'), { code: 'ENOENT' }));
  fs.open = async (file, ...args) => {
    const handle = await originalOpen(file, ...args);
    if (path.resolve(String(file)) !== path.resolve(fixture.original)) return handle;
    const nativeRead = handle.read, nativeClose = handle.close;
    state = { handle, reads: 0, closes: 0 }; disposal.set(handle, () => nativeClose.call(handle));
    handle.read = function (...readArgs) { assert.equal(this, handle); state.reads++; return nativeRead.call(handle, ...readArgs); };
    handle.close = function () {
      assert.equal(this, handle); state.closes++;
      if (denyClose) throw closeError;
      return nativeClose.call(handle).then(value => { disposal.delete(handle); return value; });
    };
    return handle;
  };
  const pending = await rejected(() => readVerifiedContainedFile(fixture.root, fixture.original, { maxBytes: 4096 }));
  const session = getContainedFileSession(pending); assert.ok(session); assert.equal(pending.cacheOwnershipReleased(), false);
  const actions = [
    ...['getSignatureFromDeclaration', 'getReturnTypeOfSignature', 'getTypeAtLocation', 'typeToString']
      .map(method => () => emit({ method, failure: pending })),
    () => emit({ allocationFailure: true, failure: pending }),
    () => authority(async () => { throw pending; }).declaration(declaration)
  ];
  for (const action of actions) {
    const failure = await rejected(action);
    assert.equal(contains(failure, pending), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
  }
  assert.equal(state.closes, 1, 'classification never retries the original close');
  const reads = state.reads; denyClose = false;
  const receipt = await session.releaseAfterClose();
  assert.equal(receipt.pending, false); assert.equal(receipt.settled, true);
  assert.equal(state.reads, reads); assert.equal(state.closes, 2); assert.equal(state.handle.fd, -1);
  fs.open = originalOpen;

  // Capture before code inspection and retain that callback even if the getter
  // replaces it. A falsey independent throw must remain in the failure graph.
  for (const inspection of ['return-code', undefined, null, false, 0, '', 'pending-inspection']) {
    let settled = true, inspectionSettled = false;
    const secondary = inspection === 'pending-inspection'
      ? Object.freeze(Object.assign(new Error('compiler metadata inspection owns work'), { cacheOwnershipReleased: () => inspectionSettled }))
      : inspection;
    const primary = Object.defineProperties(new Error('compiler metadata classification failed'), {
      cacheOwnershipReleased: { value() { assert.strictEqual(this, primary); return settled; }, writable: true },
      code: { get() {
        primary.cacheOwnershipReleased = () => true; settled = false;
        if (inspection !== 'return-code') throw secondary;
        return 'ENOENT';
      } }
    });
    const failure = await rejected(() => authority(async () => { throw primary; }).declaration(declaration));
    assert.equal(contains(failure, primary), true);
    if (inspection !== 'return-code') assert.equal(contains(failure, secondary), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
    settled = true;
    assert.equal(failure.cacheOwnershipReleased(), inspection !== 'pending-inspection');
    inspectionSettled = true; assert.equal(failure.cacheOwnershipReleased(), true);
  }
  for (const property of ['cacheOwnershipReleased', 'cacheOwnershipPending']) {
    const unreadable = Object.defineProperty(new Error('unreadable compiler resource'), property, { get() { throw null; } });
    const failure = await rejected(() => emit({ method: 'typeToString', failure: unreadable }));
    assert.equal(contains(failure, unreadable), true); assert.equal(contains(failure, null), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
  }
  console.log('Compiler advisory diagnostics preserve original resource settlement and ordinary partial coverage.');
} finally {
  fs.open = originalOpen;
  for (const dispose of disposal.values()) await dispose();
  await fixture.cleanup();
}
