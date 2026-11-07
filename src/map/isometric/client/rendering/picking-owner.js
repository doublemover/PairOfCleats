import { state } from '../state.js';
import { createPickFence } from './spatial-pick.js';
import { createInstancePickIndex } from './instance-picking.js';
import { createPickingResourceOwner } from './picking-resource-owner.js';

const owner = createPickingResourceOwner({ state, createIndex: createInstancePickIndex, createFence: createPickFence,
  readDevicePixelRatio: () => window.devicePixelRatio || 1 });

export const createControlsPickingOwner = isCurrent => createPickingResourceOwner({ state, createIndex: createInstancePickIndex,
  createFence: createPickFence, readDevicePixelRatio: () => window.devicePixelRatio || 1, isCurrent });

export const pickResidentScene = owner.pick;
export const retirePicking = owner.retire;
