import assert from 'node:assert/strict';
import { inspectSuppliedNativeBoundary } from '../../../src/semantic/native-boundary.js';

const world = { generation: { baseBuildId: 'build', semanticRevision: 0 }, sourceSnapshotId: 'snapshot', contextKey: 'python-build' };
const runtime = { implementation: 'cpython', version: '3.13', abi: 'cp313', layoutProfile: 'supplied-cp313-x64-v1', os: 'windows', architecture: 'x64' };
const manifest = { schemaVersion: 1, world, runtime,
  producer: { id: 'supplied-registration', version: '1', optionsHash: 'a'.repeat(64) },
  observation: { mode: 'static-registration', snapshotId: 'registration-snapshot', roots: ['package.module'] },
  binaries: [{ id: 'module.pyd', byteHash: 'b'.repeat(64), buildId: 'wheel-build', symbolIdentity: 'symbols', debugIdentity: null }],
  bindings: [{ id: 'binding', pythonCallable: 'package.module.run', binaryId: 'module.pyd', symbol: 'native_run',
    imageOffset: 1024, wrapperChain: ['python-wrapper'], sourceRef: null, relation: 'registration' }],
  coverage: { discovery: 'partial', callableClasses: ['builtin-function'], unsupportedLayouts: [], failures: [],
    callbacks: 'unavailable', lateRegistration: 'unavailable', dlopen: 'unavailable', ctypes: 'unavailable' } };
const args = { manifest, expectedWorld: world, expectedRuntime: runtime,
  artifacts: new Map([['module.pyd', { byteHash: 'b'.repeat(64), buildId: 'wheel-build' }]]),
  supportedLayouts: [runtime.layoutProfile], target: { binaryId: 'module.pyd', symbol: 'native_run' } };
const found = inspectSuppliedNativeBoundary(args);
assert.equal(found.target.observability, 'observable');
assert.equal(found.target.reachability, 'unknown');
assert.equal(found.execution, 'none');
assert.equal(found.target.claim, 'registered-binding');
assert.equal(inspectSuppliedNativeBoundary({ ...args, supportedLayouts: [] }).target.observability, 'unknown');
assert.equal(inspectSuppliedNativeBoundary({ ...args, target: { binaryId: 'module.pyd', symbol: 'late_registered' } }).target.reachability, 'unknown');
const stripped = structuredClone(manifest); stripped.binaries[0].symbolIdentity = null; stripped.bindings = [];
assert.equal(inspectSuppliedNativeBoundary({ ...args, manifest: stripped }).target.observability, 'targetNotObservable');
assert.throws(() => inspectSuppliedNativeBoundary({ ...args, expectedRuntime: { ...runtime, abi: 'cp312' } }), /mismatch/);
assert.throws(() => inspectSuppliedNativeBoundary({ ...args, artifacts: new Map() }), /artifact/);
const rawAddress = structuredClone(manifest); rawAddress.bindings[0].processAddress = 12345;
assert.throws(() => inspectSuppliedNativeBoundary({ ...args, manifest: rawAddress }), /descriptor/);
const unknownField = { ...manifest, runImport: true };
assert.throws(() => inspectSuppliedNativeBoundary({ ...args, manifest: unknownField }), /extended/);
assert.throws(() => inspectSuppliedNativeBoundary({ ...args, expectedWorld: { ...world, contextKey: 'other-build' } }), /Stale/);
console.log('data-only native bridge observability contract passed');
