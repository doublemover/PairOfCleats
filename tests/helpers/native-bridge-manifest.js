/** Tiny data-only fixture. This supplies no runtime/native qualification. */
export const createNativeBridgeManifestFixture = () => {
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
  return {world,runtime,manifest,args};
};
