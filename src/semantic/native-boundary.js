import { admitNativeBridgeManifest, observeNativeBoundaryTarget }
  from '../index/semantic/boundaries/native-manifest.js';

/** Existing artifact/source admission is passed in; this consumer performs no filesystem/network reads. */
export const inspectSuppliedNativeBoundary = ({ target, ...admission }) => {
  const admitted = admitNativeBridgeManifest(admission);
  return { manifestId: admitted.manifestId,
    target: observeNativeBoundaryTarget(admitted, target),
    coverage: structuredClone(admitted.manifest.coverage),
    missingEvidence: ['invocation', 'transfer-effects', 'global-boundary-closure'],
    execution: 'none' };
};
