import { checkFiniteMayCapsule, createFiniteMayCheckState, assertFiniteMayCheckLimits } from '../index/semantic/capsules/finite-may-check.js';
import { canonicalSemanticJson } from '../index/semantic/identity.js';

/** Read-only checked summary consumer; unsupported or partial checks expose no accepted state. */
export const readCheckedMaySummary = ({ system, capsule, node, ...limits }) => {
  // Read accepted facts from the exact owned bytes checked below. A caller's
  // signal/progress object cannot retarget the original certificate mid-check.
  const maxBytes = limits.maxBytes === undefined ? 8 * 1024 * 1024 : limits.maxBytes;
  assertFiniteMayCheckLimits(limits.maxObligations === undefined ? 100000 : limits.maxObligations, maxBytes);
  const encoded = canonicalSemanticJson({ system, capsule });
  if (!Array.isArray(system?.nodes) || !Array.prototype.includes.call(system.nodes, node)) {
    throw new TypeError('Requested summary node is outside the admitted system.');
  }
  if (Number.isSafeInteger(maxBytes) && maxBytes > 0 && Buffer.byteLength(encoded) > maxBytes) {
    return { check: { ...createFiniteMayCheckState(), frontier: [{ reason: 'encoded-byte-allowance' }] },
      node, facts: null, negativeMeaning: 'unknown' };
  }
  ({ system, capsule } = JSON.parse(encoded));
  if (!system?.nodes?.includes(node)) throw new TypeError('Requested summary node is outside the admitted system.');
  const check = checkFiniteMayCapsule({ system, capsule, ...limits });
  if (check.status !== 'checked-in-model') return { check, node, facts: null, negativeMeaning: 'unknown' };
  return { check, node, facts: [...capsule.states.find(state => state.node === node).facts].sort(),
    negativeMeaning: 'absent-from-checked-upper-model', sourceLanguageCompleteness: 'not-implied',
    precision: check.precision };
};
