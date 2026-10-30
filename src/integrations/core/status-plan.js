import path from 'node:path';
import { captureSelectedModeRoots, readSelectedModeRootCapture } from '../../shared/indexing/selected-mode-roots.js';
import { readJsonFile } from '../../shared/artifact-io/json.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';
import { captureValidationSelection } from '../../index/validate/selection.js';

const plans = new WeakMap();
const rootIdentity = root => process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
const required = state => Boolean(state && !['disabled', 'not-built', 'skipped', 'off'].includes(state.status));
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** One operation captures publication roots and backend intent before any
 * asynchronous status collection. Display receipts cannot replace this owner. */
export const captureIndexStatusPlan = ({ root, userConfig }) => {
  const capturedModes = captureSelectedModeRoots({ root, userConfig });
  const selected = readSelectedModeRootCapture(capturedModes, { root, userConfig });
  const states = {}, stateErrors = {}, backendRequirements = { sqlite: {}, lmdb: {} };
  for (const mode of selected.modes) {
    const dir = path.join(selected.roots[mode], `index-${mode}`);
    try { states[mode] = readJsonFile(path.join(dir, 'index_state.json'), { maxBytes: 8 * 1024 * 1024, containedRoot: dir }); }
    catch (error) {
      observeStorageResource(error, { phase: 'index-status-plan' }).requireSettled();
      states[mode] = null; stateErrors[mode] = error;
    }
    for (const backend of ['sqlite', 'lmdb']) backendRequirements[backend][mode] = required(states[mode]?.[backend]);
  }
  const validationSelection = selected.modes.length ? captureValidationSelection({ root, userConfig,
    modes: selected.modes, capturedModes, backendRequirements }) : null;
  const plan = Object.freeze({ selected: freeze(selected), states: freeze(states), stateErrors: Object.freeze(stateErrors), validationSelection });
  plans.set(plan, { root: rootIdentity(root), userConfig });
  return plan;
};

export const readIndexStatusPlan = (plan, { root, userConfig }) => {
  const owner = plans.get(plan);
  if (!owner || owner.root !== rootIdentity(root) || owner.userConfig !== userConfig) {
    throw new TypeError('Index status requires its original repository/configuration plan.');
  }
  return plan;
};
