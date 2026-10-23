import { createSceneWorkPrerequisites } from './scene-work-prerequisites.js';

/** Original work is separate from the local texture/guard close proof. Walk
 * every privately produced constituent and diagnostic independently; only the
 * exact local producer's own scene closure may be delegated to that owner. */
export const createNormalMapPrerequisites = (primitive, guarded) =>
  createSceneWorkPrerequisites('Normal-map original work remains pending.', [primitive, guarded]);
