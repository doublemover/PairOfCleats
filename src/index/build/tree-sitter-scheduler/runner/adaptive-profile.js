import {
  loadTreeSitterSchedulerAdaptiveProfile,
  mergeTreeSitterSchedulerAdaptiveProfile,
  saveTreeSitterSchedulerAdaptiveProfile
} from '../adaptive-profile.js';

export const persistTreeSitterSchedulerAdaptiveSamples = async ({
  runtime,
  treeSitterConfig = null,
  adaptiveSamples = [],
  log = null
} = {}) => {
  if (!Array.isArray(adaptiveSamples) || adaptiveSamples.length === 0) return;
  const loaded = await loadTreeSitterSchedulerAdaptiveProfile({
    runtime,
    treeSitterConfig,
    log
  });
  const merged = mergeTreeSitterSchedulerAdaptiveProfile(loaded.entriesByGrammarKey, adaptiveSamples);
  await saveTreeSitterSchedulerAdaptiveProfile({
    profilePath: loaded.profilePath,
    entriesByGrammarKey: merged,
    log
  });
};
