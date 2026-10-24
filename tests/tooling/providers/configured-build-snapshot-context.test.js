import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { importConfiguredBuildSnapshot } from '../../../src/index/tooling/configured-build-snapshot.js';
import { createImportBuildContext } from '../../../src/index/build/import-resolution/build-context/index.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';

const generation = { baseBuildId: 'configured-fixture', semanticRevision: 0 };
const sourceHash = 'b'.repeat(64), expectedSourceHashes = new Map([['Makefile', sourceHash]]);
const encode = value => Buffer.from(JSON.stringify(value));
const importMake = dependency => {
  const files = new Map([['make-targets.json', encode({ schemaVersion: 1, kind: 'make-targets', targets: [
    { name: 'app', prerequisites: [dependency, '$(UNKNOWN)'], outputs: ['build/app'], source: { path: 'Makefile', hash: sourceHash, span: [0, 3] } }
  ] })]]);
  const receipt = { schemaVersion: 1, format: 'make-target-receipt-v1', profileHash: 'a'.repeat(64), generation,
    variant: { configuration: dependency }, sources: [{ path: 'Makefile', hash: sourceHash }],
    files: [...files].map(([path, bytes]) => ({ path, hash: createHash('sha256').update(bytes).digest('hex') })) };
  return importConfiguredBuildSnapshot({ format: receipt.format, files, indexFile: 'make-targets.json', receipt,
    expectedReceiptHash: semanticHash('tooling.configured-build-receipt.v1', receipt), generation, variant: receipt.variant, expectedSourceHashes });
};
const first = importMake('debug-library'), second = importMake('release-library');
const context = createImportBuildContext({ entries: ['Makefile'], configuredSnapshot: first });
const debug = context.configuredDependenciesFor({ targetId: 'app' })[0];
assert.equal(debug.dependencies[0].id, 'debug-library');
assert.equal(debug.provenance, 'configured-build-snapshot');
assert.equal(first.metadata.unresolved[0].reason, 'make_variable_or_pattern_unresolved');
assert.notEqual(context.fingerprint, createImportBuildContext({ entries: ['Makefile'], configuredSnapshot: second }).fingerprint);
assert.deepEqual(context.configuredDependenciesFor({ targetId: 'missing' }), []);
assert.throws(() => createImportBuildContext({ configuredSnapshot: { identity: first.identity } }), { code: 'ERR_CONFIGURED_BUILD_SNAPSHOT' });
const cmakeFiles = new Map([
  ['index.json', encode({ objects: [{ kind: 'codemodel', version: { major: 2, minor: 0 }, jsonFile: 'model.json' }] })],
  ['model.json', encode({ kind: 'codemodel', version: { major: 2, minor: 0 }, paths: { source: '/producer/source', build: '/producer/build' },
    configurations: [{ name: 'Debug', targets: [{ id: 'app-id', name: 'app', jsonFile: 'app.json' }] }] })],
  ['app.json', encode({ id: 'app-id', name: 'app', type: 'EXECUTABLE', sources: [{ path: 'input.c' }],
    artifacts: [{ path: 'app' }], dependencies: [], backtraceGraph: { nodes: [], files: [], commands: [] } })]
]);
const receipt = { schemaVersion: 1, format: 'cmake-file-api-v1', profileHash: 'a'.repeat(64), generation,
  variant: { configuration: 'Debug' }, sourceRoot: '/producer/source', buildRoot: '/producer/build', buildPrefix: 'build',
  sources: [{ path: 'input.c', hash: sourceHash }], files: [...cmakeFiles].map(([path, bytes]) => ({ path, hash: createHash('sha256').update(bytes).digest('hex') })) };
const imported = importConfiguredBuildSnapshot({ format: receipt.format, files: cmakeFiles, indexFile: 'index.json', receipt,
  expectedReceiptHash: semanticHash('tooling.configured-build-receipt.v1', receipt), generation, variant: receipt.variant,
  expectedSourceHashes: new Map([['input.c', sourceHash]]) });
assert.deepEqual(imported.metadata.targets[0].outputs, ['build/app']);
assert.equal(imported.metadata.targets[0].sources[0].path, 'input.c');
const changed = new Map(cmakeFiles); changed.set('app.json', encode({ id: 'app-id', name: 'app', artifacts: [{ path: '/outside/app' }] }));
const changedReceipt = { ...receipt, files: [...changed].map(([path, bytes]) => ({ path, hash: createHash('sha256').update(bytes).digest('hex') })) };
assert.throws(() => importConfiguredBuildSnapshot({ format: receipt.format, files: changed, indexFile: 'index.json', receipt: changedReceipt,
  expectedReceiptHash: semanticHash('tooling.configured-build-receipt.v1', changedReceipt), generation, variant: receipt.variant,
  expectedSourceHashes: new Map([['input.c', sourceHash]]) }), { code: 'ERR_CONFIGURED_BUILD_SNAPSHOT' });
console.log('supplied CMake/Make configured snapshots change dependency witnesses without build execution');
