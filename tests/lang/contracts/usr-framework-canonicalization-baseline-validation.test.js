#!/usr/bin/env node
import { runUsrConformanceLevelBaselineValidation } from './usr-conformance-level-baseline.js';

runUsrConformanceLevelBaselineValidation({
  targetLevel: 'C4'
});

console.log('usr C4 baseline validation checks passed');
