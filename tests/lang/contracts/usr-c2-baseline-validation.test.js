#!/usr/bin/env node
import { runUsrConformanceLevelBaselineValidation } from './usr-conformance-level-baseline.js';

runUsrConformanceLevelBaselineValidation({
  targetLevel: 'C2',
  lane: 'conformance-c2'
});

console.log('usr C2 baseline validation checks passed');
