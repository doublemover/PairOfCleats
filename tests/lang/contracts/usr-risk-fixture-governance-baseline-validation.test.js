#!/usr/bin/env node
import { runUsrConformanceLevelBaselineValidation } from './usr-conformance-level-baseline.js';

runUsrConformanceLevelBaselineValidation({
  targetLevel: 'C3',
  lane: 'conformance-risk-fixture-governance'
});

console.log('usr C3 baseline validation checks passed');
