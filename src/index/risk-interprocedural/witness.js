const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

/** One admitted hop, with no copied path prefixes or process-wide node arena. */
export const createRiskWitness = ({ parent = null, chunkUid, callSiteIds = [], watch = null }) => Object.freeze({
  parent, chunkUid, chunkKey: JSON.stringify(chunkUid),
  callSiteIds: Object.isFrozen(callSiteIds) ? callSiteIds : Object.freeze(callSiteIds.slice()),
  callSiteKey: JSON.stringify(callSiteIds), watch,
  depth: parent ? parent.depth + 1 : 0
});

// Queue priority already compares depth, so both chains have equal lengths.
// Compare encoded scalar tokens to retain JSON's escaping/lexical tie policy.
const compareChain = (left, right, field) => {
  if (left === right) return 0;
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  return compareChain(left.parent, right.parent, field) || compareText(left[field], right[field]);
};

export const compareRiskWitnesses = (left, right) => (
  compareChain(left, right, 'chunkKey') || compareChain(left, right, 'callSiteKey')
);

export const matchesRiskWitnessExtension = (candidate, parent, callSiteKey) => (
  candidate.callSiteKey === callSiteKey && compareRiskWitnesses(candidate.parent, parent) === 0
);

/** Fresh output arrays are created only at complete/partial emission. */
export const materializeRiskWitness = witness => {
  const chunkUids = new Array(witness.depth + 1);
  const callSiteIdsByStep = new Array(witness.depth), watchByStep = new Array(witness.depth);
  for (let node = witness; node; node = node.parent) {
    chunkUids[node.depth] = node.chunkUid;
    if (node.parent) {
      callSiteIdsByStep[node.depth - 1] = node.callSiteIds.slice();
      watchByStep[node.depth - 1] = { ...node.watch };
    }
  }
  return { chunkUids, callSiteIdsByStep, watchByStep };
};
