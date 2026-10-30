import { mapExactLineagePoint } from '../index/semantic/lineage/exact-points.js';

/** One supplied observation remains one observation even when its origins are ambiguous. */
export const inspectSuppliedObservationLineage = ({ lineage, observationId, mass = 1, ...query }) => {
  if (typeof observationId !== 'string' || !observationId || Buffer.byteLength(observationId) > 4096
    || !Number.isFinite(mass) || mass < 0) throw new TypeError('Qualified observation identity and finite mass required.');
  const derivation = mapExactLineagePoint(lineage, query);
  return { observationId, mass, allocatedMass: 0, unallocatedMass: mass,
    allocationPolicy: 'unallocated-alternatives', derivation, execution: 'none',
    targetQuality: 'mapping-evidence-only', codeLifetimeAuthority: 'caller-must-admit-before-mapping' };
};
