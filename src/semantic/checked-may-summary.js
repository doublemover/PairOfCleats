import { readFiniteMayCheckedSummary } from '../index/semantic/capsules/finite-may-check.js';

/** Read-only checked summary consumer; unsupported or partial checks expose no accepted state. */
export const readCheckedMaySummary = options => readFiniteMayCheckedSummary(options);
