#!/usr/bin/env node
import { runUsrConformanceLevelBaselineValidation } from './usr-conformance-level-baseline.js';

runUsrConformanceLevelBaselineValidation({
  targetLevel: 'C0',
  lane: 'conformance-c0'
});

console.log('usr C0 baseline validation checks passed');
