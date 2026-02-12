#!/usr/bin/env node
import { runUsrConformanceLevelBaselineValidation } from './usr-conformance-level-baseline.js';

runUsrConformanceLevelBaselineValidation({
  targetLevel: 'C1',
  lane: 'conformance-c1'
});

console.log('usr C1 baseline validation checks passed');
