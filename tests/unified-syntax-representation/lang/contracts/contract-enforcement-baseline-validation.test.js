#!/usr/bin/env node
import { runUsrConformanceLevelBaselineValidation } from './conformance-level-baseline.js';

runUsrConformanceLevelBaselineValidation({
  targetLevel: 'C1',
  requireAllProfiles: true
});

console.log('usr C1 baseline validation checks passed');
