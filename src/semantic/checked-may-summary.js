import { checkFiniteMayCapsule } from '../index/semantic/capsules/finite-may-check.js';

/** Read-only checked summary consumer; unsupported or partial checks expose no accepted state. */
export const readCheckedMaySummary = ({ system, capsule, node, ...limits }) => {
  if (!system?.nodes?.includes(node)) throw new TypeError('Requested summary node is outside the admitted system.');
  const check = checkFiniteMayCapsule({ system, capsule, ...limits });
  if (check.status !== 'checked-in-model') return { check, node, facts: null, negativeMeaning: 'unknown' };
  return { check, node, facts: [...capsule.states.find(state => state.node === node).facts].sort(),
    negativeMeaning: 'absent-from-checked-upper-model', sourceLanguageCompleteness: 'not-implied',
    precision: check.precision };
};
