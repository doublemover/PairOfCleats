import { selectFederationCohorts } from './cohorts.js';

export const DEFAULT_COHORT_POLICY = 'default';

export const applyCohortPolicy = ({
  repos,
  modes,
  policy = DEFAULT_COHORT_POLICY,
  cohort = [],
  allowUnsafeMix = false
} = {}) => selectFederationCohorts({
  repos,
  modes,
  policy,
  cohort,
  allowUnsafeMix
});
