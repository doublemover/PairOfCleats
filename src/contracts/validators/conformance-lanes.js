const asStringArray = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string')
    : []
);

export const CONFORMANCE_LEVELS = Object.freeze(['C0', 'C1', 'C2', 'C3', 'C4']);

export const resolveConformanceLaneId = (knownLanes = []) => {
  const lanes = asStringArray(knownLanes);
  const gateLane = lanes.find((laneId) => /(^|-)gate($|-)/.test(laneId));
  if (gateLane) return gateLane;
  const conformanceLane = lanes.find((laneId) => laneId.startsWith('conformance-'));
  return conformanceLane || null;
};

export const buildConformanceLaneByLevel = (knownLanes = []) => {
  const laneId = resolveConformanceLaneId(knownLanes);
  return Object.freeze(
    Object.fromEntries(CONFORMANCE_LEVELS.map((level) => [level, laneId]))
  );
};

