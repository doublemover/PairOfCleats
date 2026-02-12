#!/usr/bin/env node
import { runUsrConformanceLevelBaselineValidation } from './usr-conformance-level-baseline.js';

runUsrConformanceLevelBaselineValidation({
  targetLevel: 'C3',
  lane: 'conformance-c3'
});

console.log('usr C3 baseline validation checks passed');
