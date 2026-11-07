import assert from 'node:assert/strict';
import { inspectSuppliedNativeBoundary } from '../../../src/semantic/native-boundary.js';

import { createNativeBridgeManifestFixture } from '../../helpers/native-bridge-manifest.js';

const { world, runtime, manifest, args } = createNativeBridgeManifestFixture();
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
